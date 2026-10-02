/** Offline integration smoke test of the actual bundled worker and SDK. */
const { Worker } = require('node:worker_threads')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neko-worker-smoke-'))
  const cwd = path.join(root, 'project')
  const agentDir = path.join(root, 'agent')
  fs.mkdirSync(path.join(cwd, '.pi/extensions'), { recursive: true })
  fs.mkdirSync(agentDir)
  fs.writeFileSync(path.join(cwd, '.pi/extensions/smoke.ts'), `
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat';
import { Type } from 'typebox';
export default function(pi) {
  if (!Type.String()) throw new Error('TypeBox unavailable');
  pi.registerProvider('neko-smoke', {
    baseUrl: 'http://offline.invalid', apiKey: 'offline', api: 'neko-smoke-api',
    models: [{ id: 'offline', name: 'Offline', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 128 }],
    streamSimple(model) {
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message = { role: 'assistant', content: [{ type: 'text', text: 'smoke-ok' }],
          api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: 'stop',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: 'start', partial: message });
        stream.push({ type: 'text_start', contentIndex: 0, partial: message });
        stream.push({ type: 'text_delta', contentIndex: 0, delta: 'smoke-ok', partial: message });
        stream.push({ type: 'text_end', contentIndex: 0, content: 'smoke-ok', partial: message });
        stream.push({ type: 'done', reason: 'stop', message }); stream.end();
      });
      return stream;
    }
  });
  pi.registerCommand('smoke-ui', { description: 'Offline UI check', handler: async (_, ctx) => {
    const value = await ctx.ui.select('Smoke UI', ['ok']);
    if (value !== 'ok') throw new Error('UI response mismatch');
    pi.appendEntry('smoke-ui-result', { value });
  }});
}
`)
  const worker = new Worker(path.resolve(__dirname, '../workers/worker-bootstrap.mjs'), {
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
  })
  let nextId = 0
  const pending = new Map()
  const events = []
  const call = (type, input = {}) => new Promise((resolve, reject) => {
    const id = String(++nextId)
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${type}`)) }, 30000)
    pending.set(id, { resolve, reject, timer })
    worker.postMessage({ id, type, input })
  })
  worker.on('message', message => {
    if (message.type === 'session_event') {
      events.push(message.event)
      if (message.event.type === 'ui_request') {
        const request = message.event.request
        call('session:ui-respond', { sessionId: message.sessionId, response: {
          sessionId: message.sessionId, requestId: request.id, confirmed: true, selectedValue: 'ok',
        } }).catch(error => console.error(error))
      }
      return
    }
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.success) request.resolve(message.result)
    else request.reject(new Error(message.error))
  })
  worker.on('error', error => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error) }
    pending.clear()
  })
  const waitFor = async predicate => {
    const deadline = Date.now() + 30000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for worker events')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  try {
    const created = await call('session:create', { cwd })
    assert.deepEqual(created.extensionErrors, [])
    assert.equal(created.extensionsDisabled, false)
    const sessionId = created.sessionId
    await call('session:set-model', { sessionId, provider: 'neko-smoke', modelId: 'offline' })
    assert.equal((await call('session:get-model', { sessionId })).id, 'offline')
    await call('session:list-models')
    const commands = await call('session:get-commands', { sessionId })
    assert.ok(commands.commands.some(command => command.name === 'smoke-ui'))
    await call('session:prompt', { sessionId, text: '/smoke-ui' })
    await waitFor(() => events.some(event => event.type === 'ui_request'))
    await call('session:prompt', { sessionId, text: 'offline smoke' })
    await waitFor(() => events.some(event => event.type === 'done'))
    assert.ok(events.some(event => event.type === 'text_delta' && event.delta === 'smoke-ok'))
    assert.ok(!events.some(event => event.type === 'error'), JSON.stringify(events))
    await call('session:dispose', { sessionId })
    const resumed = await call('session:reconnect', { sessionId, cwd })
    assert.deepEqual(resumed.extensionErrors, [])
    assert.ok(resumed.history.some(message => message.content === 'smoke-ok'))
    await call('session:dispose-all')
    console.log('Worker smoke passed: startup, extensions, create/reconnect, streaming, models, extension UI.')
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer)
    await worker.terminate()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
