var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/main/logger.ts
import { join } from "path";
import { tmpdir } from "os";
import { isMainThread } from "worker_threads";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
function getLogDir() {
  if (_logDir === null) {
    if (isMainThread) {
      try {
        const { app } = __require("electron");
        _logDir = app ? join(app.getPath("userData"), "logs") : join(tmpdir(), "nekocode-logs");
      } catch {
        _logDir = join(tmpdir(), "nekocode-logs");
      }
    } else {
      _logDir = join(tmpdir(), "nekocode-worker-logs");
    }
  }
  return _logDir;
}
function getIsDev() {
  if (_isDev === null) {
    if (isMainThread) {
      try {
        const { app } = __require("electron");
        _isDev = app ? !app.isPackaged : true;
      } catch {
        _isDev = true;
      }
    } else {
      _isDev = true;
    }
  }
  return _isDev;
}
function createLogger(moduleLabel) {
  return rootLogger.child({ label: moduleLabel });
}
var combine, timestamp, printf, colorize, json, _logDir, consoleFormat, fileFormat, _isDev, transports, rootLogger;
var init_logger = __esm({
  "src/main/logger.ts"() {
    "use strict";
    ({ combine, timestamp, printf, colorize, json } = winston.format);
    _logDir = null;
    consoleFormat = combine(
      colorize(),
      timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      printf(({ timestamp: timestamp2, level, message, label, ...meta }) => {
        const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
        return `${timestamp2} [${label}] ${level}: ${message}${metaStr}`;
      })
    );
    fileFormat = combine(
      timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
      json()
    );
    _isDev = null;
    transports = [
      new winston.transports.Console({
        level: getIsDev() ? "debug" : "warn",
        format: consoleFormat
      }),
      new winston.transports.File({
        dirname: getLogDir(),
        filename: "combined.log",
        level: "info",
        format: fileFormat,
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5
      }),
      new winston.transports.File({
        dirname: getLogDir(),
        filename: "error.log",
        level: "error",
        format: fileFormat,
        maxsize: 5 * 1024 * 1024,
        maxFiles: 5
      }),
      new DailyRotateFile({
        dirname: getLogDir(),
        filename: "nekocode-%DATE%.log",
        datePattern: "YYYY-MM-DD",
        level: "info",
        format: fileFormat,
        maxFiles: "14d"
      })
    ];
    rootLogger = winston.createLogger({
      level: "debug",
      transports,
      exitOnError: false
    });
  }
});

// src/main/extension-loader.ts
var extension_loader_exports = {};
__export(extension_loader_exports, {
  createResourceLoader: () => createResourceLoader,
  createSdkSession: () => createSdkSession,
  loadWithFallback: () => loadWithFallback,
  logExtensionErrors: () => logExtensionErrors,
  normalizeExtensionErrors: () => normalizeExtensionErrors,
  shouldRetryWithoutExtensions: () => shouldRetryWithoutExtensions
});
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager
} from "@mariozechner/pi-coding-agent";
async function createSdkSession(sessionManager, cwd, mode, loaderOptions) {
  const loader = createResourceLoader(cwd, loaderOptions);
  logger.debug(`[${mode}] createSdkSession loaderCwd=${cwd} processCwd=${process.cwd()} NODE_PATH=${process.env.NODE_PATH ?? ""}`);
  await loader.reload();
  const result = await createAgentSession({
    cwd,
    resourceLoader: loader,
    sessionManager
  });
  return { session: result.session, extensionsResult: result.extensionsResult };
}
function createResourceLoader(cwd, options) {
  return new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    settingsManager: SettingsManager.create(),
    noExtensions: options?.noExtensions
  });
}
function shouldRetryWithoutExtensions(errors, loadedExtensionsCount) {
  if (loadedExtensionsCount > 0 || errors.length === 0) return false;
  const uniqueMessages = new Set(errors.map((error) => error.message));
  if (uniqueMessages.size !== 1) return false;
  const onlyMessage = errors[0]?.message ?? "";
  return onlyMessage.includes("(void 0) is not a function");
}
function normalizeExtensionErrors(errors) {
  return errors.map((error, index) => {
    if (typeof error === "string") {
      return { path: `unknown:${index}`, message: error };
    }
    if (error && typeof error === "object") {
      const path = "path" in error && typeof error.path === "string" ? error.path : `unknown:${index}`;
      const message = "error" in error && typeof error.error === "string" ? error.error : "message" in error && typeof error.message === "string" ? error.message : String(error);
      const stack = "stack" in error && typeof error.stack === "string" ? error.stack : void 0;
      return { path, message, stack };
    }
    return { path: `unknown:${index}`, message: String(error) };
  });
}
function logExtensionErrors(mode, errors) {
  if (errors.length === 0) return;
  const markerOnly = errors.every((error) => error.path === "__reconnect__" || error.path === "__create__");
  if (markerOnly) {
    for (const extensionError of errors) {
      logger.warn(`[${mode}] ${extensionError.message}`);
    }
    return;
  }
  logger.error(`[${mode}] Extension load errors (${errors.length})`);
  const uniqueMessages = new Set(errors.map((error) => error.message));
  if (uniqueMessages.size === 1) {
    logger.error(`[${mode}] Extension error fingerprint: uniform-message across all failures -> ${errors[0].message}`);
  }
  const stackCount = errors.filter((error) => !!error.stack).length;
  if (stackCount === 0) {
    logger.error(`[${mode}] Extension diagnostics: no stack traces provided by SDK error payload`);
  }
  for (const extensionError of errors) {
    logger.error(`[${mode}] Extension load error path=${extensionError.path} message=${extensionError.message}`);
    if (extensionError.stack) {
      logger.error(`[${mode}] Extension load stack path=${extensionError.path}
${extensionError.stack}`);
    }
  }
}
async function loadWithFallback(mode, getSdkSessionManager, cwd, allowExtensionFallback) {
  const sdkSessionManager = await getSdkSessionManager();
  const primaryAttempt = await createSdkSession(sdkSessionManager, cwd, mode);
  const primaryErrors = normalizeExtensionErrors(primaryAttempt.extensionsResult.errors);
  let session = primaryAttempt.session;
  let extensionsResult = primaryAttempt.extensionsResult;
  let extensionErrors = primaryErrors;
  let extensionsDisabled = false;
  if (shouldRetryWithoutExtensions(primaryErrors, primaryAttempt.extensionsResult.extensions.length)) {
    if (!allowExtensionFallback) {
      logExtensionErrors(mode, primaryErrors);
      throw new Error(`[${mode}] Systemic extension loader failure (${primaryErrors.length}) - set NEKOCODE_ALLOW_EXTENSION_FALLBACK=1 to allow degraded reconnect/create without extensions`);
    }
    logger.warn(`[${mode}] Detected systemic extension loader failure signature, retrying with extensions disabled`);
    const retrySdkSessionManager = await getSdkSessionManager();
    const retryAttempt = await createSdkSession(retrySdkSessionManager, cwd, `${mode}-noext`, { noExtensions: true });
    session = retryAttempt.session;
    extensionsResult = retryAttempt.extensionsResult;
    extensionsDisabled = retryAttempt.extensionsResult.errors.length === 0;
    if (extensionsDisabled) {
      logger.warn(`[${mode}] Primary extension load failed (${primaryErrors.length}); fallback without extensions succeeded`);
      extensionErrors = [
        {
          path: `__${mode}__`,
          message: `${mode.charAt(0).toUpperCase() + mode.slice(1)} fallback engaged: extensions disabled for this session due to systemic extension loader failure (primaryErrors=${primaryErrors.length})`
        }
      ];
    } else {
      extensionErrors = [
        ...primaryErrors,
        ...normalizeExtensionErrors(retryAttempt.extensionsResult.errors),
        {
          path: `__${mode}__`,
          message: `${mode.charAt(0).toUpperCase() + mode.slice(1)} fallback attempted with extensions disabled but still encountered extension load errors`
        }
      ];
    }
  }
  logExtensionErrors(mode, extensionErrors);
  logger.info(`[${mode}] Extensions loaded: ${extensionsResult.extensions.length}, errors: ${extensionsResult.errors.length}`);
  for (const ext of extensionsResult.extensions) {
    logger.info(`[${mode}] Extension: ${ext.path}`);
  }
  return { session, extensionsResult, extensionErrors, extensionsDisabled };
}
var logger;
var init_extension_loader = __esm({
  "src/main/extension-loader.ts"() {
    "use strict";
    init_logger();
    logger = createLogger("extension-loader");
  }
});

// src/main/text-extractor.ts
function extractTextContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content.filter((block) => block.type === "text").map((block) => block.text).join("");
}
var init_text_extractor = __esm({
  "src/main/text-extractor.ts"() {
    "use strict";
  }
});

// src/main/message-store.ts
var message_store_exports = {};
__export(message_store_exports, {
  extractHistoryFromSdkMessages: () => extractHistoryFromSdkMessages,
  loadHistoryFromDisk: () => loadHistoryFromDisk,
  tryRefreshFromDisk: () => tryRefreshFromDisk
});
import { SessionManager as SdkSessionManager } from "@mariozechner/pi-coding-agent";
function extractHistoryFromSdkMessages(sdkMessages) {
  logger2.debug(`extractHistoryFromSdkMessages: ${sdkMessages.length} raw SDK message(s)`);
  const result = [];
  const toolResults = /* @__PURE__ */ new Map();
  for (const msg of sdkMessages) {
    if (!("role" in msg)) continue;
    const m = msg;
    if (m.role === "toolResult") {
      const content = extractTextContent(m.content);
      toolResults.set(m.toolCallId, { result: content, isError: !!m.isError });
    }
  }
  for (const msg of sdkMessages) {
    if (!("role" in msg)) continue;
    const m = msg;
    const role = m.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = extractTextContent(m.content);
    let toolCalls;
    if (role === "assistant" && Array.isArray(m.content)) {
      const tcBlocks = m.content.filter((block) => block.type === "toolCall");
      if (tcBlocks.length > 0) {
        toolCalls = tcBlocks.map((tc) => {
          const tcResult = toolResults.get(tc.id);
          return {
            id: tc.id,
            name: tc.name,
            args: tc.arguments,
            result: tcResult?.result,
            isError: tcResult?.isError
          };
        });
      }
    }
    let usage;
    if (role === "assistant" && "usage" in m && m.usage) {
      const sdkUsage = m.usage;
      usage = {
        inputTokens: sdkUsage.input,
        outputTokens: sdkUsage.output,
        totalCost: sdkUsage.cost.total
      };
    }
    result.push({
      id: crypto.randomUUID(),
      role,
      content,
      toolCalls,
      timestamp: "timestamp" in m ? m.timestamp : Date.now(),
      usage
    });
  }
  logger2.debug(`extractHistoryFromSdkMessages: produced ${result.length} ChatMessageIPC(s)`);
  return result;
}
async function loadHistoryFromDisk(sessionId, cwd, limit = 0) {
  logger2.info(`loadHistoryFromDisk ${sessionId} cwd=${cwd} limit=${limit}`);
  const infos = await SdkSessionManager.list(cwd);
  const match = infos.find((info) => info.id === sessionId);
  if (!match?.path) {
    logger2.debug(`loadHistoryFromDisk ${sessionId} - not found on disk, returning empty`);
    return [];
  }
  const sdkSessionMgr = SdkSessionManager.open(match.path);
  const allMessages = extractHistoryFromSdkMessages(
    sdkSessionMgr.getEntries().filter((e) => e.type === "message").map((e) => e.message)
  );
  const diskMessages = limit > 0 && allMessages.length > limit ? allMessages.slice(-limit) : allMessages;
  logger2.debug(`loadHistoryFromDisk ${sessionId} - ${diskMessages.length}/${allMessages.length} message(s) returned`);
  return diskMessages;
}
async function tryRefreshFromDisk(sessionId, cwd, currentMessages, currentAssistantId) {
  try {
    if (currentAssistantId) return null;
    const infos = await SdkSessionManager.list(cwd);
    const match = infos.find((info) => info.id === sessionId);
    if (!match?.path) return null;
    const sdkSessionMgr = SdkSessionManager.open(match.path);
    const diskMessages = extractHistoryFromSdkMessages(
      sdkSessionMgr.getEntries().filter((e) => e.type === "message").map((e) => e.message)
    );
    if (diskMessages.length > currentMessages.length) {
      logger2.info(`Background refresh ${sessionId} - updated ${currentMessages.length} -> ${diskMessages.length} messages`);
      return diskMessages;
    }
    return null;
  } catch (err) {
    logger2.debug(`Background refresh failed for ${sessionId}: ${err}`);
    return null;
  }
}
var logger2;
var init_message_store = __esm({
  "src/main/message-store.ts"() {
    "use strict";
    init_text_extractor();
    init_logger();
    logger2 = createLogger("message-store");
  }
});

// src/main/threading/worker-bootstrap.ts
init_logger();
import { parentPort } from "worker_threads";
var logger3 = createLogger("worker");
var sessions = /* @__PURE__ */ new Map();
function emitEvent(sessionId, event) {
  const message = {
    type: "session_event",
    sessionId,
    event
  };
  parentPort?.postMessage(message);
}
function handleAgentEvent(sessionId, event, managed) {
  logger3.debug(`handleAgentEvent: type=${event.type}`);
  switch (event.type) {
    case "message_update": {
      const sub = event.assistantMessageEvent;
      if (sub.type === "text_delta") {
        if (!managed.currentAssistantId) {
          managed.currentAssistantId = crypto.randomUUID();
          managed.currentAssistantContent = "";
        }
        managed.currentAssistantContent += sub.delta;
        emitEvent(sessionId, { type: "text_delta", delta: sub.delta });
      }
      break;
    }
    case "message_start": {
      logger3.debug(`message_start: role=${event.message?.role ?? "unknown"}`);
      if (event.message?.role === "user") {
        finalizeAssistantMessage(managed);
        let content = "";
        if (typeof event.message.content === "string") {
          content = event.message.content;
        } else if (Array.isArray(event.message.content)) {
          content = event.message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
        }
        managed.messages.push({
          id: crypto.randomUUID(),
          role: "user",
          content,
          timestamp: Date.now()
        });
        emitEvent(sessionId, { type: "user_message", text: content });
      }
      break;
    }
    case "message_end": {
      logger3.debug(`message_end: role=${event.message?.role ?? "unknown"}`);
      if (managed.currentAssistantId) {
        finalizeAssistantMessage(managed);
      }
      if (event.message?.role === "assistant" && "usage" in event.message && event.message.usage) {
        const usage = event.message.usage;
        managed.usageTotals.input += usage.input;
        managed.usageTotals.output += usage.output;
        managed.usageTotals.totalCost += usage.cost.total;
        const lastMsg = managed.messages[managed.messages.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          lastMsg.usage = {
            inputTokens: usage.input,
            outputTokens: usage.output,
            totalCost: usage.cost.total
          };
        }
        const ctxUsage = managed.session.getContextUsage();
        const usageData = {
          inputTokens: managed.usageTotals.input,
          outputTokens: managed.usageTotals.output,
          totalCost: managed.usageTotals.totalCost,
          contextPercent: ctxUsage?.percent ?? 0,
          contextWindow: ctxUsage?.contextWindow ?? 0
        };
        emitEvent(sessionId, { type: "usage_update", usage: usageData });
      }
      break;
    }
    case "tool_execution_start": {
      logger3.debug(`tool_execution_start: name=${event.toolName}`);
      emitEvent(sessionId, {
        type: "tool_call",
        toolCallId: event.toolCallId ?? managed.currentToolCallId ?? crypto.randomUUID(),
        toolName: event.toolName,
        args: event.args
      });
      finalizeAssistantMessage(managed);
      managed.currentToolCallId = event.toolCallId ?? crypto.randomUUID();
      const lastMsg = managed.messages[managed.messages.length - 1];
      if (lastMsg && lastMsg.role === "assistant") {
        if (!lastMsg.toolCalls) lastMsg.toolCalls = [];
        lastMsg.toolCalls.push({
          id: managed.currentToolCallId,
          name: event.toolName,
          args: event.args
        });
      } else {
        managed.messages.push({
          id: crypto.randomUUID(),
          role: "assistant",
          content: "",
          toolCalls: [{
            id: managed.currentToolCallId,
            name: event.toolName,
            args: event.args
          }],
          timestamp: Date.now()
        });
      }
      break;
    }
    case "tool_execution_end": {
      logger3.debug(`tool_execution_end: name=${event.toolName}`);
      emitEvent(sessionId, {
        type: "tool_result",
        toolCallId: event.toolCallId ?? managed.currentToolCallId ?? "",
        toolName: event.toolName,
        result: event.result,
        isError: event.isError
      });
      if (managed.currentToolCallId) {
        const lastMsg = managed.messages[managed.messages.length - 1];
        if (lastMsg?.toolCalls) {
          const tc = lastMsg.toolCalls.find((t) => t.id === managed.currentToolCallId);
          if (tc) {
            tc.result = event.result;
            tc.isError = event.isError;
          }
        }
        managed.currentToolCallId = null;
      }
      break;
    }
    case "agent_end": {
      finalizeAssistantMessage(managed);
      logger3.debug(`agent_end: total messages=${managed.messages.length}`);
      emitEvent(sessionId, { type: "done" });
      break;
    }
    default: {
      logger3.debug(`Unhandled event type: ${event.type}`);
    }
  }
}
function finalizeAssistantMessage(managed) {
  if (managed.currentAssistantId && managed.currentAssistantContent) {
    const assistantMsg = {
      id: managed.currentAssistantId,
      role: "assistant",
      content: managed.currentAssistantContent,
      timestamp: Date.now()
    };
    managed.messages.push(assistantMsg);
    managed.currentAssistantId = null;
    managed.currentAssistantContent = "";
  }
}
async function dispatchOperation(type, input) {
  switch (type) {
    // Session operations - CPU intensive SDK operations
    case "session:create":
      return handleSessionCreate(input);
    case "session:reconnect":
      return handleSessionReconnect(input);
    case "session:prompt":
      return handleSessionPrompt(input);
    case "session:abort":
      return handleSessionAbort(input);
    case "session:dispose":
      return handleSessionDispose(input);
    case "session:dispose-all":
      return handleSessionDisposeAll();
    case "session:load-history":
      return handleSessionLoadHistory(input);
    case "session:load-history-disk":
      return handleSessionLoadHistoryDisk(input);
    case "session:list-models":
      return handleSessionListModels();
    case "session:set-model":
      return handleSessionSetModel(input);
    case "session:get-model":
      return handleSessionGetModel(input);
    // Project operations
    case "project:discover-sessions":
      return handleProjectDiscoverSessions(input);
    case "project:save-workspace":
      return handleProjectSaveWorkspace(input);
    default:
      throw new Error(`Unknown operation type: ${type}`);
  }
}
async function handleSessionCreate(input) {
  logger3.debug(`Creating session for cwd: ${input.cwd}`);
  const { loadWithFallback: loadWithFallback2 } = await Promise.resolve().then(() => (init_extension_loader(), extension_loader_exports));
  const { SessionManager: SdkSessionManager2 } = await import("@mariozechner/pi-coding-agent");
  const allowExtensionFallback = process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK === "1";
  const { session, extensionErrors, extensionsDisabled } = await loadWithFallback2(
    "create",
    () => SdkSessionManager2.create(input.cwd),
    input.cwd,
    allowExtensionFallback
  );
  const sessionId = session.sessionId;
  logger3.info(`Created session ${sessionId}`);
  const managed = wrapSession(session, sessionId, extensionErrors, extensionsDisabled);
  sessions.set(sessionId, managed);
  return {
    sessionId,
    extensionErrors,
    extensionsDisabled
  };
}
async function handleSessionReconnect(input) {
  logger3.debug(`Reconnecting session: ${input.sessionId}`);
  const existing = sessions.get(input.sessionId);
  if (existing) {
    return {
      sessionId: input.sessionId,
      history: existing.messages,
      extensionErrors: existing.extensionErrors,
      extensionsDisabled: existing.extensionsDisabled
    };
  }
  const { loadWithFallback: loadWithFallback2 } = await Promise.resolve().then(() => (init_extension_loader(), extension_loader_exports));
  const { SessionManager: SdkSessionManager2 } = await import("@mariozechner/pi-coding-agent");
  const { extractHistoryFromSdkMessages: extractHistoryFromSdkMessages2 } = await Promise.resolve().then(() => (init_message_store(), message_store_exports));
  const infos = await SdkSessionManager2.list(input.cwd);
  const match = infos.find((info) => info.id === input.sessionId);
  if (!match?.path) {
    throw new Error(`Session not found on disk: ${input.sessionId}`);
  }
  const allowExtensionFallback = process.env.NEKOCODE_ALLOW_EXTENSION_FALLBACK === "1";
  const { session, extensionErrors, extensionsDisabled } = await loadWithFallback2(
    "reconnect",
    async () => SdkSessionManager2.open(match.path),
    input.cwd,
    allowExtensionFallback
  );
  const sessionId = session.sessionId;
  logger3.info(`Reconnected session ${sessionId}`);
  const messages = extractHistoryFromSdkMessages2(session.messages);
  const managed = wrapSession(session, sessionId, extensionErrors, extensionsDisabled);
  managed.messages = messages;
  sessions.set(sessionId, managed);
  return {
    sessionId,
    history: messages,
    extensionErrors,
    extensionsDisabled
  };
}
async function handleSessionPrompt(input) {
  logger3.debug(`Prompt for session: ${input.sessionId}`);
  const managed = sessions.get(input.sessionId);
  if (!managed) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }
  await managed.session.prompt(input.text, { streamingBehavior: "steer" });
}
function handleSessionAbort(input) {
  logger3.debug(`Abort session: ${input.sessionId}`);
  const managed = sessions.get(input.sessionId);
  if (managed) {
    managed.session.abort();
  }
  return { success: true };
}
function handleSessionDispose(input) {
  logger3.debug(`Dispose session: ${input.sessionId}`);
  const managed = sessions.get(input.sessionId);
  if (managed) {
    managed.unsubscribe();
    managed.session.dispose();
    sessions.delete(input.sessionId);
  }
  return { success: true };
}
function handleSessionDisposeAll() {
  logger3.debug("Dispose all sessions");
  for (const [id, managed] of sessions) {
    try {
      managed.unsubscribe();
      managed.session.dispose();
    } catch (err) {
      logger3.warn(`Failed to dispose session ${id}:`, err);
    }
  }
  sessions.clear();
  return { success: true };
}
function handleSessionLoadHistory(input) {
  logger3.debug(`Load history for session: ${input.sessionId}`);
  const managed = sessions.get(input.sessionId);
  if (!managed) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }
  return { messages: [...managed.messages] };
}
async function handleSessionLoadHistoryDisk(input) {
  logger3.debug(`Load history from disk: ${input.sessionId}`);
  const { SessionManager: SdkSessionManager2 } = await import("@mariozechner/pi-coding-agent");
  const { extractHistoryFromSdkMessages: extractHistoryFromSdkMessages2 } = await Promise.resolve().then(() => (init_message_store(), message_store_exports));
  const infos = await SdkSessionManager2.list(input.cwd);
  const match = infos.find((info) => info.id === input.sessionId);
  if (!match?.path) {
    logger3.debug(`loadHistoryFromDisk ${input.sessionId} - not found on disk, returning empty`);
    return { messages: [] };
  }
  const sdkSessionMgr = SdkSessionManager2.open(match.path);
  const entries = sdkSessionMgr.getEntries();
  const allMessages = extractHistoryFromSdkMessages2(
    entries.filter((e) => e.type === "message").map((e) => e.message)
  );
  const diskMessages = input.limit > 0 && allMessages.length > input.limit ? allMessages.slice(-input.limit) : allMessages;
  logger3.debug(`loadHistoryFromDisk ${input.sessionId} - ${diskMessages.length}/${allMessages.length} message(s) returned`);
  return { messages: diskMessages };
}
async function handleSessionListModels() {
  logger3.debug("Listing available models");
  const { ModelRegistry, AuthStorage } = await import("@mariozechner/pi-coding-agent");
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = modelRegistry.getAvailable();
  const models = available.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider
  }));
  return { models };
}
async function handleSessionSetModel(input) {
  logger3.debug(`Set model for session: ${input.sessionId}`);
  const managed = sessions.get(input.sessionId);
  if (!managed) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }
  const model = managed.session.modelRegistry.find(input.provider, input.modelId);
  if (!model) {
    throw new Error(`Model not found: ${input.provider}/${input.modelId}`);
  }
  await managed.session.setModel(model);
  return {
    id: model.id,
    name: model.name,
    provider: model.provider
  };
}
function handleSessionGetModel(input) {
  const managed = sessions.get(input.sessionId);
  if (!managed) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }
  const model = managed.session.model;
  if (!model) {
    throw new Error(`No model set for session: ${input.sessionId}`);
  }
  return {
    id: model.id,
    name: model.name,
    provider: model.provider
  };
}
async function handleProjectDiscoverSessions(input) {
  logger3.debug(`Discovering sessions for path: ${input.path}`);
  const { SessionManager } = await import("@mariozechner/pi-coding-agent");
  try {
    const sessionList = await SessionManager.list(input.path);
    return {
      sessions: sessionList.filter((s) => s.messageCount > 0).map((s) => ({
        id: s.id,
        firstMessage: s.firstMessage,
        created: s.created.toISOString(),
        messageCount: s.messageCount
      }))
    };
  } catch (err) {
    logger3.error(`Failed to discover sessions for ${input.path}:`, err);
    return { sessions: [] };
  }
}
async function handleProjectSaveWorkspace(input) {
  logger3.debug("Saving workspace...");
  const { writeFile, mkdir } = await import("fs/promises");
  const { dirname } = await import("path");
  try {
    const state = JSON.stringify({
      projectPaths: input.projectPaths,
      activeSessionId: input.activeSessionId,
      activeProjectPath: input.activeProjectPath
    }, null, 2);
    await mkdir(dirname(input.workspacePath), { recursive: true });
    await writeFile(input.workspacePath, state, "utf-8");
    return { success: true };
  } catch (err) {
    logger3.error("Failed to save workspace:", err);
    throw err;
  }
}
function wrapSession(session, sessionId, extensionErrors, extensionsDisabled) {
  const managed = {
    session,
    unsubscribe: () => {
    },
    extensionErrors,
    extensionsDisabled,
    messages: [],
    currentAssistantId: null,
    currentAssistantContent: "",
    currentToolCallId: null,
    usageTotals: { input: 0, output: 0, totalCost: 0 }
  };
  managed.unsubscribe = session.subscribe((event) => {
    handleAgentEvent(sessionId, event, managed);
  });
  return managed;
}
parentPort?.on("message", async (message) => {
  const { id, type, input } = message;
  logger3.debug(`Received operation: ${type}`);
  try {
    const result = await dispatchOperation(type, input);
    const response = {
      id,
      success: true,
      result
    };
    parentPort?.postMessage(response);
  } catch (error) {
    logger3.error(`Operation ${type} failed:`, error);
    const response = {
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    parentPort?.postMessage(response);
  }
});
logger3.info("Worker thread initialized");
