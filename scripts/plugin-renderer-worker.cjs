const {app, BrowserWindow} = require("electron");
const {readFileSync} = require("node:fs");

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");

function argumentValue(name) {
  const prefix = `${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : "";
}

function hasArgument(name) {
  return process.argv.includes(name);
}

function emit(result, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  app.exit(exitCode);
}

function remember(list, value) {
  if (!list.includes(value)) list.push(value);
}

function denyCapability(capabilities, capability) {
  remember(capabilities, capability);
  throw new Error(`D15 denied ${capability}`);
}

function deniedObject(capabilities, capability) {
  const fail = () => denyCapability(capabilities, capability);
  return new Proxy(Object.create(null), {
    get: fail,
    set: fail,
    defineProperty: fail,
    deleteProperty: fail,
    getPrototypeOf: () => null,
    setPrototypeOf: fail,
  });
}

function deniedFunction(capabilities, capability) {
  return function deniedCall() {
    return denyCapability(capabilities, capability);
  };
}

function safeCallable(name) {
  const callable = function safePluginCallable() {};
  return new Proxy(callable, {
    get(target, property) {
      if (property === "prototype") return target.prototype;
      if (property === Symbol.toStringTag) return "Function";
      return safeCallable(`${name}.${String(property)}`);
    },
    apply() {
      return {};
    },
    construct() {
      return {};
    },
  });
}

function createObsidianApi() {
  class Plugin {
    constructor(pluginApp, manifest) {
      this.app = pluginApp;
      this.manifest = manifest;
    }
  }
  return new Proxy({Plugin}, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === "__esModule") return false;
      return safeCallable(`obsidian.${String(property)}`);
    },
  });
}

function createSafeRequire(capabilities, requiredModules) {
  const obsidian = createObsidianApi();
  const safeModulePattern = /^(?:@codemirror\/|@lezer\/|codemirror$|luxon$|moment$|svelte(?:\/|$)|yaml$)/;
  return function safeRequire(specifier) {
    remember(requiredModules, specifier);
    if (specifier === "obsidian") return obsidian;
    if (safeModulePattern.test(specifier)) return safeCallable(specifier);
    const capability = /^(?:node:)?fs(?:\/promises)?$/.test(specifier) ? "filesystem.direct" : "module.import";
    return denyCapability(capabilities, capability);
  };
}

function createEvaluationArguments(capabilities, requiredModules) {
  const safeGlobal = deniedObject(capabilities, "dom.privileged");
  return [
    createSafeRequire(capabilities, requiredModules),
    deniedObject(capabilities, "dom.privileged"),
    safeGlobal,
    safeGlobal,
    safeGlobal,
    safeGlobal,
    safeGlobal,
    deniedObject(capabilities, "process.spawn"),
    deniedFunction(capabilities, "network.request"),
    deniedFunction(capabilities, "network.request"),
    deniedFunction(capabilities, "network.request"),
    deniedObject(capabilities, "credentials.read"),
    deniedObject(capabilities, "native.abi"),
    deniedFunction(capabilities, "resource.unbounded"),
    deniedFunction(capabilities, "resource.unbounded"),
    () => undefined,
    () => undefined,
    deniedFunction(capabilities, "resource.unbounded"),
    deniedFunction(capabilities, "code.dynamic"),
    undefined,
    TextEncoder,
    TextDecoder,
  ];
}

function evaluateSource(source, capabilities, requiredModules) {
  const module = {exports: {}};
  const factory = new Function(
    "module", "exports", "require", "document", "window", "globalThis", "self", "navigator", "location",
    "process", "fetch", "WebSocket", "XMLHttpRequest", "keytar", "WebAssembly", "setTimeout", "setInterval",
    "clearTimeout", "clearInterval", "setImmediate", "Function", "moduleBuffer", "TextEncoder", "TextDecoder",
    `"use strict";\n${source}\n`,
  );
  factory(module, module.exports, ...createEvaluationArguments(capabilities, requiredModules));
  return module;
}

function exportKind(exports) {
  if (exports === null) return "null";
  if (Array.isArray(exports)) return "array";
  return typeof exports;
}

function loadedResult(module, requiredModules, deniedCapabilities) {
  return {
    status: deniedCapabilities.length > 0 ? "denied" : "loaded",
    enforcement: "electron-context-isolated-sandbox",
    coverage: "electron-sandboxed-renderer-module-load-only",
    exportKind: exportKind(module.exports),
    requiredModules,
    deniedCapabilities,
  };
}

function failedResult(error, requiredModules, deniedCapabilities) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: deniedCapabilities.length > 0 || /D15 denied/.test(message) ? "denied" : "failed",
    enforcement: "electron-context-isolated-sandbox",
    coverage: "electron-sandboxed-renderer-module-load-only",
    exportKind: "undefined",
    requiredModules,
    deniedCapabilities,
    error: message.slice(0, 600),
  };
}

function rendererProbe(source) {
  const deniedCapabilities = [];
  const requiredModules = [];
  try {
    return loadedResult(evaluateSource(source, deniedCapabilities, requiredModules), requiredModules, deniedCapabilities);
  } catch (error) {
    return failedResult(error, requiredModules, deniedCapabilities);
  }
}

function lifecycleCall(instance, name, events) {
  if (typeof instance[name] !== "function") return;
  instance[name]();
  events.push(name);
}

function lifecycleInstance(module, lifecycle) {
  if (typeof module.exports !== "function") throw new Error("lifecycle fixture did not export a plugin class");
  lifecycle.supported = true;
  const instance = new module.exports({events: lifecycle.events}, {id: "renderer-lifecycle-fixture", version: "1"});
  lifecycle.events.push("constructed");
  return instance;
}

function lifecycleFailure(error, requiredModules, deniedCapabilities, lifecycle) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: deniedCapabilities.length > 0 ? "denied" : "failed",
    enforcement: "electron-context-isolated-sandbox",
    coverage: "electron-sandboxed-renderer-lifecycle",
    exportKind: "undefined",
    requiredModules,
    deniedCapabilities,
    lifecycle,
    error: message.slice(0, 600),
  };
}

function rendererLifecycleProbe(source) {
  const deniedCapabilities = [];
  const requiredModules = [];
  const lifecycle = {supported: false, events: []};
  try {
    const module = evaluateSource(source, deniedCapabilities, requiredModules);
    const instance = lifecycleInstance(module, lifecycle);
    lifecycleCall(instance, "onload", lifecycle.events);
    lifecycleCall(instance, "onunload", lifecycle.events);
    return {
      status: "loaded",
      enforcement: "electron-context-isolated-sandbox",
      coverage: "electron-sandboxed-renderer-lifecycle",
      exportKind: "function",
      requiredModules,
      deniedCapabilities,
      lifecycle,
    };
  } catch (error) {
    return lifecycleFailure(error, requiredModules, deniedCapabilities, lifecycle);
  }
}

function rendererScript(source, lifecycleMode = false) {
  const runtime = [
    remember,
    denyCapability,
    deniedObject,
    deniedFunction,
    safeCallable,
    createObsidianApi,
    createSafeRequire,
    createEvaluationArguments,
    evaluateSource,
    exportKind,
    loadedResult,
    failedResult,
    rendererProbe,
    lifecycleCall,
    lifecycleInstance,
    lifecycleFailure,
    rendererLifecycleProbe,
  ].map((functionDefinition) => functionDefinition.toString()).join("\n");
  const probe = lifecycleMode ? "rendererLifecycleProbe" : "rendererProbe";
  return `(function(){${runtime};return ${probe}(${JSON.stringify(source)});})()`;
}

function createWindow() {
  return new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
}

function destroyWindow(window) {
  if (!window.isDestroyed()) window.destroy();
}

async function executeRenderer(sourceFile, lifecycleMode = false) {
  const source = readFileSync(sourceFile, "utf8");
  const window = createWindow();
  try {
    await window.loadURL("data:text/html,<meta charset='utf-8'><title>OpenObsidian plugin preflight</title>");
    return await window.webContents.executeJavaScript(rendererScript(source, lifecycleMode), true);
  } finally {
    destroyWindow(window);
  }
}

function startupFailure(error, lifecycleMode = false) {
  return {
    status: "failed",
    enforcement: "electron-context-isolated-sandbox",
    coverage: lifecycleMode ? "electron-sandboxed-renderer-lifecycle" : "electron-sandboxed-renderer-module-load-only",
    exportKind: "undefined",
    requiredModules: [],
    deniedCapabilities: [],
    error: error instanceof Error ? error.message.slice(0, 600) : String(error).slice(0, 600),
  };
}

function start(sourceFile) {
  if (!sourceFile) {
    process.stderr.write("Missing --source-file\n");
    app.whenReady().then(() => emit({status: "failed", error: "Missing --source-file"}, 2));
    return;
  }
  const lifecycleMode = hasArgument("--run-lifecycle");
  app.whenReady().then(() => executeRenderer(sourceFile, lifecycleMode)).then(emit, (error) => emit(startupFailure(error, lifecycleMode), 1));
}

start(argumentValue("--source-file"));
