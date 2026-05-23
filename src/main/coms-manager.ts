/**
 * ComsManager — bridges NekoCode to the Pi coms (inter-agent messaging) system.
 *
 * Reads the coms registry filesystem (~/.pi/coms/) to discover peer agents,
 * sends messages via named pipes (Windows) / Unix domain sockets (POSIX),
 * and forwards inbound messages to the renderer.
 *
 * The coms registry is maintained by the Pi coms extension running inside
 * each agent session. This manager provides a read-only view of the pool
 * plus the ability to send messages to peers.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as net from 'net'
import * as crypto from 'crypto'
import { createLogger } from './logger'
import type {
  ComsPeer,
  ComsListPayload,
  ComsListResult,
  ComsSendPayload,
  ComsSendResult,
  ComsGetPayload,
  ComsGetResult,
  ComsAwaitPayload,
  ComsAwaitResult,
  ComsInboundEvent,
} from '../shared/ipc-types'

const logger = createLogger('coms-manager')

/** Base directory for coms registry and sockets */
const COMS_DIR = path.join(os.homedir(), '.pi', 'coms')

/** Maximum line size for socket communication (1 MiB) */
const LINE_CAP_BYTES = 1024 * 1024

/** How long to wait for a response from a peer before timing out (default 30 min) */
const DEFAULT_AWAIT_TIMEOUT_MS = 30 * 60 * 1000

/** Crockford Base32 alphabet for ULID generation */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Fallback color palette for NekoCode's coms identity */
const NEKOCODE_COLORS = [
  '#7C3AED', // violet
  '#EC4899', // pink
  '#F59E0B', // amber
  '#10B981', // emerald
  '#3B82F6', // blue
  '#EF4444', // red
  '#8B5CF6', // purple
  '#06B6D4', // cyan
]

/** Registry entry version */
const REGISTRY_VERSION = 1

/** Interface for the registry entry written by the coms extension */
interface RegistryEntry {
  session_id: string
  name: string
  purpose: string
  model: string
  color: string
  pid: number
  endpoint: string
  cwd: string
  started_at: string
  explicit: boolean
  version: number
  /** Optional context window usage added by keepalive refresh */
  context_used_pct?: number
}

/** Pending reply tracker — maps msg_id to its resolution */
interface PendingReply {
  resolve: (value: ComsGetResult) => void
  timer?: ReturnType<typeof setTimeout>
}

/**
 * Manages coms (inter-agent messaging) integration for NekoCode.
 *
 * Lifecycle:
 *   - Constructed once at app startup
 *   - start() begins registry watching and ping cycles
 *   - stop() cleans up timers and listeners
 */
export class ComsManager {
  private alive = false
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pendingReplies = new Map<string, PendingReply>()
  private inboundHandler: ((event: ComsInboundEvent) => void) | null = null
  private selfSessionId: string | null = null
  private selfName: string | null = null
  private selfEndpoint: string | null = null
  private selfProject: string | null = null
  private server: net.Server | null = null
  private registryFilePath: string | null = null

  /**
   * Set the handler for inbound coms messages from other agents.
   * Called by IPC handler setup to bridge inbound events to the renderer.
   */
  setInboundHandler(handler: (event: ComsInboundEvent) => void): void {
    this.inboundHandler = handler
  }

  /**
   * Start the coms manager. Reads registry, starts ping cycle.
   * If no identity is provided (SDK mode), auto-generates one and registers
   * NekoCode as a peer in the coms registry so other agents can discover it.
   * If identity IS provided, uses it directly.
   */
  start(identity?: { sessionId: string; name: string; endpoint: string; project?: string }): void {
    if (this.alive) return
    this.alive = true

    if (identity) {
      // Explicit identity provided — use it as-is
      this.selfSessionId = identity.sessionId
      this.selfName = identity.name
      this.selfEndpoint = identity.endpoint
      this.selfProject = identity.project || 'default'
      this.bindListener(identity.endpoint)
      this.registerSelf()
    } else {
      // SDK mode — no identity provided, auto-generate one so NekoCode
      // registers as a discoverable peer in the coms registry.
      // Without this, NekoCode is invisible to other Pi agents.
      this.autoRegisterAsPeer()
    }

    // Start periodic registry refresh to detect new/departed agents
    this.pingTimer = setInterval(() => {
      // Just a no-op for now — the list() call reads live from disk each time
    }, 30_000)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node.js Timer.unref not in standard types
    try { (this.pingTimer as any).unref?.() } catch { /* ignore */ }

    logger.info(`ComsManager started (sessionId=${this.selfSessionId}, name=${this.selfName})`)
  }

  /**
   * Stop the coms manager, cleaning up all timers and connections.
   */
  stop(): void {
    if (!this.alive) return
    this.alive = false

    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }

    // Reject all pending replies
    for (const [_msgId, pending] of this.pendingReplies) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.resolve({ status: 'error', error: 'ComsManager shutting down' })
    }
    this.pendingReplies.clear()

    // Unregister from the coms registry so other agents don't try to reach a dead instance
    this.unregisterSelf()

    // Close the listener server
    if (this.server) {
      try { this.server.close() } catch { /* ignore */ }
      this.server = null
    }

    logger.info('ComsManager stopped')
  }

  /**
   * List peer agents discoverable via the coms registry.
   * Reads live from disk to ensure fresh data.
   */
  async list(payload?: ComsListPayload): Promise<ComsListResult> {
    const project = payload?.project || 'default'
    const includeExplicit = payload?.includeExplicit ?? false
    const agents: ComsPeer[] = []

    // Determine which projects to scan
    const projectsDir = path.join(COMS_DIR, 'projects')
    let projectsToScan: string[]
    if (project === '*') {
      try {
        projectsToScan = fs.readdirSync(projectsDir)
      } catch {
        projectsToScan = []
      }
    } else {
      projectsToScan = [project]
    }

    for (const proj of projectsToScan) {
      const agentsDir = path.join(projectsDir, proj, 'agents')
      let files: string[]
      try {
        files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.json'))
      } catch {
        continue
      }

      for (const file of files) {
        const filePath = path.join(agentsDir, file)
        try {
          const raw = fs.readFileSync(filePath, 'utf-8')
          const entry: RegistryEntry = JSON.parse(raw)

          // Skip explicit agents unless requested
          if (entry.explicit && !includeExplicit) continue
          // Skip self
          if (this.selfSessionId && entry.session_id === this.selfSessionId) continue

          // Check if the agent process is still alive
          let isAlive = false
          try {
            // Sending signal 0 checks process existence without killing it
            if (process.platform === 'win32') {
              // On Windows, try to connect to the endpoint to check liveness
              isAlive = await this.checkLiveness(entry.endpoint)
            } else {
              process.kill(entry.pid, 0)
              isAlive = true
            }
          } catch {
            isAlive = false
          }

          // Clean up stale registry entries (agent process is dead)
          if (!isAlive) {
            try { fs.unlinkSync(filePath) } catch { /* ignore */ }
            continue
          }

          agents.push({
            sessionId: entry.session_id,
            name: entry.name,
            purpose: entry.purpose,
            model: entry.model,
            cwd: entry.cwd,
            project: proj,
            alive: isAlive,
            contextUsedPct: entry.context_used_pct ?? null,
            color: entry.color,
            explicit: entry.explicit,
          })
        } catch {
          // Skip malformed registry entries
          continue
        }
      }
    }

    return { agents, project }
  }

  /**
   * Send a prompt to a peer agent via its endpoint (named pipe / Unix socket).
   * Returns a msg_id that can be used to track the reply.
   */
  async send(payload: ComsSendPayload): Promise<ComsSendResult> {
    // First, resolve the target to an endpoint by reading the registry
    const { endpoint, sessionId, name } = await this.resolveTarget(payload.target)

    // Generate a unique message ID
    const msgId = this.generateMsgId()

    // Build the envelope matching the coms extension wire format
    const envelope = {
      type: 'prompt' as const,
      msg_id: msgId,
      sender_session: this.selfSessionId || 'nekocode-standalone',
      sender_endpoint: this.selfEndpoint || '',
      sender_name: this.selfName || 'NekoCode',
      prompt: payload.prompt,
      conversation_id: payload.conversationId || null,
      response_schema: payload.responseSchema || null,
      hops: 0,
    }

    // Send the envelope to the peer's endpoint
    await this.sendToEndpoint(endpoint, JSON.stringify(envelope))

    logger.info(`Sent coms message msgId=${msgId} target=${name}`)

    return {
      msgId,
      target: name,
      targetSession: sessionId,
      hops: 0,
    }
  }

  /**
   * Non-blocking poll of a pending coms_send reply.
   * For now, this checks the pending replies map.
   */
  async get(payload: ComsGetPayload): Promise<ComsGetResult> {
    const pending = this.pendingReplies.get(payload.msgId)
    if (!pending) {
      // If we don't have a pending reply, it might have already been resolved
      // or never existed. Return an error.
      return { status: 'error', error: `No pending reply for msg_id=${payload.msgId}` }
    }
    // The pending reply is still waiting — it's pending
    return { status: 'pending' }
  }

  /**
   * Block until a pending coms_send reply lands or the timeout fires.
   * Returns a promise that resolves with the response or an error.
   */
  async awaitReply(payload: ComsAwaitPayload): Promise<ComsAwaitResult> {
    const timeoutMs = payload.timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS

    return new Promise<ComsAwaitResult>((resolve) => {
      const pending = this.pendingReplies.get(payload.msgId)
      if (!pending) {
        // Check if already resolved — for simplicity, if not in pending map,
        // return an error
        resolve({ error: `No pending reply for msg_id=${payload.msgId}` })
        return
      }

      // Set up timeout
      const timer = setTimeout(() => {
        this.pendingReplies.delete(payload.msgId)
        resolve({ error: `Await timed out after ${timeoutMs}ms` })
      }, timeoutMs)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node.js Timer.unref not in standard types
      try { (timer as any).unref?.() } catch { /* ignore */ }

      // Replace the resolve function so the pending reply resolves this await
      pending.timer = timer
      pending.resolve = (result: ComsGetResult) => {
        clearTimeout(timer)
        this.pendingReplies.delete(payload.msgId)
        if (result.status === 'complete') {
          resolve({ response: result.response })
        } else {
          resolve({ error: result.error || 'Unknown error' })
        }
      }
    })
  }

  // ━━ Private helpers ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Resolve a target name or session ID to an endpoint + session info.
   */
  private async resolveTarget(target: string): Promise<{ endpoint: string; sessionId: string; name: string }> {
    const projectsDir = path.join(COMS_DIR, 'projects')
    let projects: string[]
    try {
      projects = fs.readdirSync(projectsDir)
    } catch {
      throw new Error(`coms: no agents found — registry directory missing`)
    }

    for (const proj of projects) {
      const agentsDir = path.join(projectsDir, proj, 'agents')
      let files: string[]
      try {
        files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.json'))
      } catch {
        continue
      }

      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(agentsDir, file), 'utf-8')
          const entry: RegistryEntry = JSON.parse(raw)
          // Match by session_id (exact) or name (scoped to project)
          if (entry.session_id === target || entry.name === target) {
            return { endpoint: entry.endpoint, sessionId: entry.session_id, name: entry.name }
          }
        } catch {
          continue
        }
      }
    }

    throw new Error(`coms: agent "${target}" not found in registry`)
  }

  /**
   * Send a JSON line to a named pipe / Unix domain socket endpoint.
   */
  private sendToEndpoint(endpoint: string, jsonLine: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket()
      const timeout = setTimeout(() => {
        socket.destroy()
        reject(new Error(`Connection to ${endpoint} timed out`))
      }, 10_000)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node.js Timer.unref not in standard types
      try { (timeout as any).unref?.() } catch { /* ignore */ }

      socket.connect(endpoint, () => {
        clearTimeout(timeout)
        socket.write(jsonLine + '\n', 'utf-8', (err) => {
          if (err) {
            socket.destroy()
            reject(err)
          } else {
            // Wait briefly for the ACK/NACK before closing
            setTimeout(() => {
              socket.end()
              resolve()
            }, 500)
          }
        })
      })

      socket.on('error', (err) => {
        clearTimeout(timeout)
        reject(new Error(`Socket error connecting to ${endpoint}: ${err.message}`))
      })

      socket.on('close', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  /**
   * Check if an endpoint is alive by attempting a ping.
   */
  private checkLiveness(endpoint: string): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket()
      const timeout = setTimeout(() => {
        socket.destroy()
        resolve(false)
      }, 3_000)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node.js Timer.unref not in standard types
      try { (timeout as any).unref?.() } catch { /* ignore */ }

      socket.connect(endpoint, () => {
        // Connected — endpoint is alive. Send a ping.
        const ping = {
          type: 'ping' as const,
          msg_id: this.generateMsgId(),
          sender_session: this.selfSessionId || 'nekocode-liveness',
          sender_endpoint: this.selfEndpoint || '',
          hops: 0,
        }
        socket.write(JSON.stringify(ping) + '\n', 'utf-8')
        // Don't wait for pong — connection success is enough
        setTimeout(() => {
          socket.end()
          resolve(true)
        }, 200)
      })

      socket.on('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })
  }

  /**
   * Bind a listener server on the given endpoint for inbound messages.
   * This allows other agents to send messages directly to NekoCode.
   */
  private bindListener(endpoint: string): void {
    // Clean up any stale socket/pipe file
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(endpoint) } catch { /* ignore */ }
    }

    this.server = net.createServer((socket) => {
      let buf = ''
      let handled = false

      const onData = (chunk: Buffer) => {
        if (handled) return
        buf += chunk.toString('utf-8')
        if (buf.length > LINE_CAP_BYTES) {
          handled = true
          socket.removeListener('data', onData)
          socket.end()
          return
        }
        const nl = buf.indexOf('\n')
        if (nl < 0) return
        handled = true
        socket.removeListener('data', onData)

        const line = buf.slice(0, nl)
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(line) as Record<string, unknown>
        } catch {
          socket.end()
          return
        }

        const pType = parsed.type as string | undefined
        const pMsgId = parsed.msg_id as string | undefined
        const pHops = (parsed.hops as number) ?? 0

        if (pType === 'prompt' && this.inboundHandler) {
          // Forward to the renderer as an inbound event
          const event: ComsInboundEvent = {
            msgId: pMsgId ?? '',
            senderName: (parsed.sender_name as string) || 'unknown',
            senderSession: parsed.sender_session as string,
            prompt: parsed.prompt as string,
            conversationId: parsed.conversation_id as string | null,
            hops: pHops,
            timestamp: new Date().toISOString(),
          }
          this.inboundHandler(event)

          // ACK the receipt
          const ack = { type: 'ack', msg_id: pMsgId, hops: pHops }
          try { socket.write(JSON.stringify(ack) + '\n') } catch { /* ignore */ }
          try { socket.end() } catch { /* ignore */ }
        } else if (pType === 'response') {
          // Handle a response to a previously sent message
          const replyMsgId = pMsgId ?? ''
          const pending = this.pendingReplies.get(replyMsgId)
          if (pending) {
            if (pending.timer) clearTimeout(pending.timer)
            pending.resolve({ status: 'complete', response: parsed.response })
            this.pendingReplies.delete(replyMsgId)
          }
          // ACK the response
          const ack = { type: 'ack', msg_id: pMsgId, hops: pHops }
          try { socket.write(JSON.stringify(ack) + '\n') } catch { /* ignore */ }
          try { socket.end() } catch { /* ignore */ }
        } else if (pType === 'ping') {
          // Respond with pong
          const pong = {
            type: 'pong' as const,
            msg_id: pMsgId,
            sender_session: this.selfSessionId || 'nekocode',
            sender_endpoint: this.selfEndpoint || '',
            hops: pHops + 1,
          }
          try { socket.write(JSON.stringify(pong) + '\n') } catch { /* ignore */ }
          try { socket.end() } catch { /* ignore */ }
        } else {
          // NACK unknown types
          const nack = { type: 'nack', msg_id: pMsgId || '', reason: 'unknown type' }
          try { socket.write(JSON.stringify(nack) + '\n') } catch { /* ignore */ }
          try { socket.end() } catch { /* ignore */ }
        }
      }

      socket.on('data', onData)
      socket.on('error', () => { try { socket.destroy() } catch { /* ignore */ } })
    })

    // Ensure parent directory exists for the socket file (POSIX)
    if (process.platform !== 'win32') {
      const socketDir = path.dirname(endpoint)
      try { fs.mkdirSync(socketDir, { recursive: true }) } catch { /* ignore */ }
    }

    this.server.listen(endpoint, () => {
      logger.info(`Coms listener bound on ${endpoint}`)
    })

    this.server.on('error', (err) => {
      logger.error(`Coms listener error: ${err.message}`)
    })
  }

  /**
   * Generate a unique message ID using timestamp + random hex.
   */
  private generateMsgId(): string {
    const ts = Date.now().toString(36)
    const rand = Math.random().toString(36).slice(2, 10)
    return `neko-${ts}-${rand}`
  }

  /**
   * Generate a ULID (Universally Unique Lexicographically Sortable Identifier).
   * Compatible with the coms extension's ULID format so session IDs are
   * consistent across the Pi ecosystem.
   */
  private generateUlid(): string {
    const time = Date.now()
    const rand = crypto.randomBytes(10)
    let timeStr = ''
    let t = time
    for (let i = 9; i >= 0; i--) {
      timeStr = CROCKFORD[t % 32] + timeStr
      t = Math.floor(t / 32)
    }
    let randStr = ''
    let bits = 0
    let value = 0
    for (const byte of rand) {
      value = (value << 8) | byte
      bits += 8
      while (bits >= 5) {
        bits -= 5
        randStr += CROCKFORD[(value >> bits) & 31]
      }
    }
    return (timeStr + randStr).slice(0, 26)
  }

  /**
   * Generate a named pipe / Unix socket endpoint for this NekoCode instance.
   * Matches the coms extension's makeEndpoint() format.
   */
  private makeEndpoint(sessionId: string): string {
    if (process.platform === 'win32') {
      // Windows named pipe path: \\.\pipe\pi-coms-<sessionId>
      // eslint-disable-next-line no-useless-escape -- backslash-p is intentional for Windows named pipe path
      return `\\.\pipe\pi-coms-${sessionId}`
    }
    return path.join(COMS_DIR, 'sockets', `${sessionId}.sock`)
  }

  /**
   * Pick a fallback color for NekoCode's coms identity, deterministically
   * based on the session ID so it's consistent across restarts with the same ID.
   */
  private pickColor(sessionId: string): string {
    const hash = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 8)
    return NEKOCODE_COLORS[Number(BigInt('0x' + hash)) % NEKOCODE_COLORS.length]
  }

  /**
   * Auto-register NekoCode as a peer in the coms registry.
   * This is called in SDK mode when no explicit identity is provided.
   *
   * BUG FIX: Previously, comsManager.start() was called without an identity,
   * which meant NekoCode never wrote a registry entry and was invisible to
   * other Pi agents. Other agents could not discover or send messages to
   * NekoCode via the coms system.
   */
  private autoRegisterAsPeer(): void {
    // Generate a stable identity for this NekoCode instance
    const sessionId = this.generateUlid()
    const name = `nekocode-${sessionId.slice(-6)}`
    const endpoint = this.makeEndpoint(sessionId)
    const project = 'default'

    this.selfSessionId = sessionId
    this.selfName = name
    this.selfEndpoint = endpoint
    this.selfProject = project

    // Bind the listener so other agents can reach us
    this.bindListener(endpoint)

    // Write the registry entry so other agents can discover us
    this.registerSelf()

    logger.info(`Auto-registered NekoCode as coms peer: name=${name}, project=${project}`)
  }

  /**
   * Write this NekoCode instance's registry entry to the coms registry filesystem.
   * This allows other Pi agents to discover NekoCode via coms_list / coms discover.
   *
   * The registry format matches the coms extension's RegistryEntry schema
   * so it's fully interoperable with the Pi CLI coms system.
   */
  private registerSelf(): void {
    if (!this.selfSessionId || !this.selfName || !this.selfEndpoint || !this.selfProject) {
      logger.warn('Cannot register self: missing identity fields')
      return
    }

    const entry: RegistryEntry = {
      session_id: this.selfSessionId,
      name: this.selfName,
      purpose: 'NekoCode AI coding assistant',
      model: 'NekoCode',
      color: this.pickColor(this.selfSessionId),
      pid: process.pid,
      endpoint: this.selfEndpoint,
      cwd: process.cwd(),
      started_at: new Date().toISOString(),
      explicit: false,
      version: REGISTRY_VERSION,
    }

    // Write atomically: write to .tmp then rename, matching the coms extension pattern
    const agentsDir = path.join(COMS_DIR, 'projects', this.selfProject, 'agents')
    try {
      fs.mkdirSync(agentsDir, { recursive: true })
    } catch {
      logger.error(`Failed to create coms registry directory: ${agentsDir}`)
      return
    }

    const finalPath = path.join(agentsDir, `${this.selfName}.json`)
    const tmpPath = `${finalPath}.tmp`

    try {
      fs.writeFileSync(tmpPath, JSON.stringify(entry, null, 2))
      fs.renameSync(tmpPath, finalPath)
      this.registryFilePath = finalPath
      logger.info(`Registered coms peer entry: ${finalPath}`)
    } catch (err) {
      logger.error(`Failed to write coms registry entry: ${err}`)
      try { fs.unlinkSync(tmpPath) } catch { /* cleanup */ }
    }
  }

  /**
   * Remove this NekoCode instance's registry entry from the coms registry.
   * Called during shutdown so stale entries don't linger.
   */
  private unregisterSelf(): void {
    if (!this.registryFilePath) return

    try {
      fs.unlinkSync(this.registryFilePath)
      logger.info(`Unregistered coms peer entry: ${this.registryFilePath}`)
    } catch {
      // Best-effort — the file might already be gone or inaccessible
    }
    this.registryFilePath = null
  }
}
