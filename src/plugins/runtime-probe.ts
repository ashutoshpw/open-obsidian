import {spawn} from "node:child_process";
import {performance} from "node:perf_hooks";

export type RuntimeProbeStatus = "loaded" | "denied" | "failed" | "timed-out";

export type RuntimeProbeResult = {
  status: RuntimeProbeStatus;
  coverage: "module-load-only";
  exportKind: "undefined" | "null" | "boolean" | "number" | "string" | "function" | "object" | "array";
  requiredModules: string[];
  deniedCapabilities: string[];
  durationMs: number;
  error?: string;
};

type RuntimeProbeOptions = {
  timeoutMs?: number;
};

type WorkerResult = Omit<RuntimeProbeResult, "durationMs">;

const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_OUTPUT_LENGTH = 16_384;

const WORKER_SOURCE = String.raw`
const vm = require('node:vm');
const deniedCapabilities = [];
const requiredModules = [];

function remember(list, value) {
  if (!list.includes(value)) list.push(value);
}

function deny(capability) {
  remember(deniedCapabilities, capability);
  throw new Error('D15 denied ' + capability);
}

function capabilityForModule(specifier) {
  if (/^(?:node:)?fs(?:\/promises)?$/.test(specifier)) return 'filesystem.direct';
  if (/^(?:node:)?(?:child_process|cluster|worker_threads)$/.test(specifier)) return 'process.spawn';
  if (/^(?:keytar|electron(?:-safe-storage)?|safe-storage)$/.test(specifier)) return 'credentials.read';
  if (/^(?:electron|@electron\/)/.test(specifier)) return 'dom.privileged';
  return 'module.import';
}

function deniedObject(capability) {
  return new Proxy(Object.create(null), {
    get() { return deny(capability); },
    set() { return deny(capability); },
    defineProperty() { return deny(capability); },
    deleteProperty() { return deny(capability); },
  });
}

function deniedFunction(capability) {
  return function deniedCall() { return deny(capability); };
}

function safeApiFunction() {
  const api = function SafeApi() {};
  return new Proxy(api, {
    get(target, property) { return property === 'prototype' ? target.prototype : api; },
    apply() { return api; },
    construct() { return {}; },
  });
}

function safeLibraryModule() {
  return new Proxy(Object.create(null), {
    get(_target, property) { return property === Symbol.toStringTag ? 'Module' : safeApiFunction(); },
  });
}

class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
  }
}

const obsidian = new Proxy({Plugin}, {
  get(target, property) {
    if (property in target) return target[property];
    return safeApiFunction();
  },
});

function safeRequire(specifier) {
  remember(requiredModules, specifier);
  if (specifier === 'obsidian') return obsidian;
  if (/^(?:@codemirror\/|codemirror$|luxon$|moment$|svelte(?:\/|$)|yaml$)/.test(specifier)) return safeLibraryModule();
  return deny(capabilityForModule(specifier));
}

function exportKind(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function emit(result) {
  process.stdout.write(JSON.stringify({coverage: 'module-load-only', ...result}));
}

let source = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { source += chunk; });
process.stdin.on('end', () => {
  const module = {exports: {}};
  const sandbox = {
    module,
    exports: module.exports,
    require: safeRequire,
    console: {log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {}, time() {}, timeEnd() {}},
    fetch: deniedFunction('network.request'),
    WebSocket: deniedFunction('network.request'),
    XMLHttpRequest: deniedFunction('network.request'),
    document: deniedObject('dom.privileged'),
    window: deniedObject('dom.privileged'),
    process: deniedObject('process.spawn'),
    keytar: deniedObject('credentials.read'),
    WebAssembly: deniedObject('native.abi'),
    setTimeout: deniedFunction('resource.unbounded'),
    setInterval: deniedFunction('resource.unbounded'),
    clearTimeout() {},
    clearInterval() {},
    performance: {now() { return 0; }},
    Buffer,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
  };
  sandbox.global = sandbox;
  try {
    const context = vm.createContext(sandbox, {codeGeneration: {strings: false, wasm: false}});
    const script = new vm.Script(source, {filename: 'unchanged-plugin-main.js'});
    script.runInContext(context, {timeout: 1_500});
    emit({status: deniedCapabilities.length > 0 ? 'denied' : 'loaded', exportKind: exportKind(module.exports), requiredModules, deniedCapabilities});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Code generation from strings|WebAssembly|D15 denied/.test(message)) {
      if (/Code generation from strings/.test(message)) remember(deniedCapabilities, 'code.dynamic');
      if (/WebAssembly/.test(message)) remember(deniedCapabilities, 'native.abi');
      emit({status: 'denied', exportKind: 'undefined', requiredModules, deniedCapabilities, error: message.slice(0, 600)});
      return;
    }
    emit({status: 'failed', exportKind: 'undefined', requiredModules, deniedCapabilities, error: message.slice(0, 600)});
  }
});
`;

function appendOutput(current: string, chunk: Uint8Array | string): string {
  const value = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  return `${current}${value}`.slice(0, MAX_OUTPUT_LENGTH);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseWorkerResult(stdout: string, stderr: string, durationMs: number): RuntimeProbeResult {
  const line = stdout.trim().split("\n").at(-1) ?? "";
  try {
    const result = JSON.parse(line) as WorkerResult;
    return {...result, durationMs};
  } catch {
    const detail = (stderr || stdout).trim().slice(0, 600) || "runtime probe emitted no result";
    return {status: "failed", coverage: "module-load-only", exportKind: "undefined", requiredModules: [], deniedCapabilities: [], durationMs, error: detail};
  }
}

function nodeEnvironment(): NodeJS.ProcessEnv {
  return {PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1"};
}

export function probePluginBundle(source: string, options: RuntimeProbeOptions = {}): Promise<RuntimeProbeResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const started = performance.now();
  const child = spawn("node", ["--experimental-permission", "--no-addons", "--disable-proto=throw", "-e", WORKER_SOURCE], {
    cwd: "/",
    env: nodeEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result: RuntimeProbeResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Uint8Array | string) => { stdout = appendOutput(stdout, chunk); });
    child.stderr.on("data", (chunk: Uint8Array | string) => { stderr = appendOutput(stderr, chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({status: "failed", coverage: "module-load-only", exportKind: "undefined", requiredModules: [], deniedCapabilities: [], durationMs: Math.round(performance.now() - started), error: errorMessage(error)});
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - started);
      if (timedOut) {
        finish({status: "timed-out", coverage: "module-load-only", exportKind: "undefined", requiredModules: [], deniedCapabilities: [], durationMs, error: `probe exceeded ${timeoutMs}ms`});
        return;
      }
      if (code !== 0 && !stdout.trim()) {
        finish({status: "failed", coverage: "module-load-only", exportKind: "undefined", requiredModules: [], deniedCapabilities: [], durationMs, error: stderr.trim().slice(0, 600) || `probe exited with code ${String(code)}`});
        return;
      }
      finish(parseWorkerResult(stdout, stderr, durationMs));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(source, "utf8");
  });
}
