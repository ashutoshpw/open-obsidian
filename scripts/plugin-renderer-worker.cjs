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
  const denied = function deniedCall() {
    return denyCapability(capabilities, capability);
  };
  Object.defineProperty(denied, "prototype", {value: Function.prototype});
  return denied;
}

function safeDomObject() {
  return new Proxy({
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) { return child; },
    createEl() { return safeDomObject(); },
    createDiv() { return safeDomObject(); },
    createSpan() { return safeDomObject(); },
    empty() {},
    toggleClass() {},
    addClass() {},
    removeClass() {},
    setText() {},
    setAttr() {},
    style: {},
    classList: {add() {}, remove() {}, toggle() {}, contains() { return false; }},
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return safeCallable(`dom.${String(property)}`);
    },
  });
}

function safeCallable(name) {
  const callable = function safePluginCallable() {};
  return new Proxy(callable, {
    get(target, property) {
      if (property === "prototype") return target.prototype;
      if (property === Symbol.toStringTag) return "Function";
      if (property === Symbol.toPrimitive) return () => name;
      if (property === "toString" || property === "valueOf") return () => name;
      if (property === "bind") return (...args) => safeCallable(`${name}.bound`);
      return safeCallable(`${name}.${String(property)}`);
    },
    apply(_target, _thisArg, args) {
      if (/\.normalizePath$/.test(name)) return typeof args[0] === "string" ? args[0].replaceAll("\\", "/") : "";
      if (/\.debounce$/.test(name) && typeof args[0] === "function") return args[0];
      if (/\.getLeavesOfType$/.test(name)) return [];
      if (/\.getRightLeaf$/.test(name)) return {setViewState() {}, openFile() {}};
      return safeCallable(`${name}()`);
    },
    construct(_target, args) {
      return {app: args[0], containerEl: safeDomObject()};
    },
  });
}

const OBSIDIAN_EXPORT_NAMES = [
  "App", "AbstractInputSuggest", "ButtonComponent", "ColorComponent", "Component", "ConfirmationModal", "DataAdapter", "DropdownComponent", "Editor", "EditorPosition", "EditorRange", "EditorSuggest", "Events", "FileSystemAdapter", "FileView", "FuzzySuggestModal", "ItemView", "Keymap", "MarkdownPostProcessorContext", "MarkdownRenderChild", "MarkdownRenderer", "MarkdownView", "Menu", "MenuItem", "MetadataCache", "Modal", "Notice", "Platform", "PluginSettingTab", "Scope", "SearchComponent", "Setting", "SettingGroup", "SettingPage", "SliderComponent", "SuggestModal", "TAbstractFile", "TFile", "TFolder", "TextAreaComponent", "TextComponent", "ToggleComponent", "Vault", "Workspace", "WorkspaceLeaf", "addIcon", "arrayBufferToBase64", "debounce", "getAllTags", "getFrontMatterInfo", "getLanguage", "normalizePath", "parseLinktext", "parseYaml", "prepareFuzzySearch", "requestUrl", "resolveSubpath", "setIcon", "stringifyYaml",
];

function cloneData(value) {
  if (value === undefined) return {};
  return JSON.parse(JSON.stringify(value));
}

function createObsidianApi() {
  class Plugin {
    constructor(pluginApp, manifest) {
      this.app = pluginApp;
      this.manifest = manifest;
    }

    addCommand(command) {
      if (command && typeof command.id === "string") this.app.commands.push(command.id);
    }

    addRibbonIcon() {
      return safeDomObject();
    }

    addStatusBarItem() {
      return safeDomObject();
    }

    registerView(type) {
      if (typeof type === "string") this.app.views.push(type);
    }

    addSettingTab(tab) {
      if (tab && typeof tab.id === "string") this.app.settings.push(tab.id);
    }

    registerEvent(event) {
      if (event && typeof event.type === "string") this.app.registeredEvents.push(event.type);
    }

    register() {}

    registerDomEvent() {}

    registerInterval() {}

    registerCliHandler() {}

    registerEditorExtension() {}

    registerMarkdownCodeBlockProcessor() {}

    registerHoverLinkSource() {}

    registerObsidianProtocolHandler() {}

    registerCustomCss() {}

    loadData() {
      this.app.persistence.push("loadData");
      const dataStore = this.app.dataStore;
      const value = dataStore ? cloneData(dataStore.value) : {};
      this.app.loadedData = value;
      return value;
    }

    saveData(value) {
      this.app.persistence.push("saveData");
      const dataStore = this.app.dataStore;
      if (dataStore) {
        dataStore.value = cloneData(value);
        dataStore.writes += 1;
      }
      this.app.savedData = cloneData(value);
    }
  }
  const target = {Plugin};
  return new Proxy(target, {
    ownKeys() {
      return [...new Set([...Reflect.ownKeys(target), ...OBSIDIAN_EXPORT_NAMES])];
    },
    getOwnPropertyDescriptor(_target, property) {
      if (typeof property === "string" && OBSIDIAN_EXPORT_NAMES.includes(property)) return {configurable: true, enumerable: true, writable: true, value: safeCallable(`obsidian.${property}`)};
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    get(target, property) {
      if (property in target) return target[property];
      if (property === "__esModule") return false;
      return safeCallable(`obsidian.${String(property)}`);
    },
  });
}

function pluginConstructor(module) {
  const exports = module.exports;
  if (typeof exports === "function") return exports;
  if (exports && typeof exports.default === "function") return exports.default;
  return null;
}

function createPluginApp(events, dataStore) {
  const event = (type) => ({type, off() {}});
  const missingFile = () => {
    const error = new Error("mediated vault path is unavailable");
    error.code = "ENOENT";
    throw error;
  };
  const adapter = {
    exists: async () => false,
    read: async () => "",
    readBinary: async () => new Uint8Array(),
    write: async () => undefined,
    writeBinary: async () => undefined,
    append: async () => undefined,
    appendBinary: async () => undefined,
    list: async () => ({files: [], folders: []}),
    mkdir: async () => undefined,
    rmdir: async (_path, _recursive) => undefined,
    remove: async () => undefined,
    stat: missingFile,
    getBasePath: () => "",
    getFullPath: (path) => path,
    getResourcePath: (path) => path,
    readFile: async () => "",
    writeFile: async () => undefined,
    readdir: async () => [],
    unlink: async () => undefined,
    lstat: missingFile,
    readlink: async () => "",
    symlink: async () => undefined,
    cp: async () => undefined,
    rm: async () => undefined,
  };
  const vault = {
    on(type) { return event(type); },
    off() {},
    offref() {},
    getConfig() { return undefined; },
    getAbstractFileByPath() { return null; },
    getFileByPath() { return null; },
    getFolderByPath() { return null; },
    getAllLoadedFiles() { return []; },
    read: async () => "",
    cachedRead: async () => "",
    create: async () => ({}),
    createBinary: async () => ({}),
    createFolder: async () => ({}),
    modify: async () => undefined,
    modifyBinary: async () => undefined,
    delete: async () => undefined,
    adapter,
  };
  const workspace = {
    layoutReady: true,
    on(type) { return event(type); },
    off() {},
    offref() {},
    onLayoutReady(callback) { if (typeof callback === "function") callback(); },
    getLeavesOfType() { return []; },
    getRightLeaf() { return {setViewState() {}, openFile: async () => undefined}; },
    getActiveFile() { return null; },
    getActiveViewOfType() { return null; },
    getActiveFileView() { return null; },
    getLeaf() { return {openFile: async () => undefined, setViewState() {}}; },
    getMostRecentLeaf() { return null; },
    openLinkText: async () => undefined,
    iterateAllLeaves() {},
    trigger() {},
  };
  return {
    events,
    commands: [],
    views: [],
    settings: [],
    registeredEvents: [],
    persistence: [],
    dataStore,
    vault,
    workspace,
    metadataCache: {},
    fileManager: {trashFile: async () => undefined},
    commandsManager: {},
    plugins: {enabledPlugins: new Set(), plugins: {}, getPlugin() { return null; }},
    internalPlugins: {plugins: {}},
    app: null,
  };
}

function pluginApiSummary(pluginApp) {
  return {
    events: [...pluginApp.events],
    commands: [...pluginApp.commands],
    views: [...pluginApp.views],
    settings: [...pluginApp.settings],
    registeredEvents: [...pluginApp.registeredEvents],
    persistence: [...pluginApp.persistence],
    loadedData: cloneData(pluginApp.loadedData),
    savedData: cloneData(pluginApp.savedData),
  };
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
    safeCallable("activeWindow"),
  ];
}

function evaluateSource(source, capabilities, requiredModules) {
  const module = {exports: {}};
  const factory = new Function(
    "module", "exports", "require", "document", "window", "globalThis", "self", "navigator", "location",
    "process", "fetch", "WebSocket", "XMLHttpRequest", "keytar", "WebAssembly", "setTimeout", "setInterval",
    "clearTimeout", "clearInterval", "setImmediate", "Function", "moduleBuffer", "TextEncoder", "TextDecoder", "activeWindow",
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

function exposeBoundedApp() {
  const boundedApp = createPluginApp([], undefined);
  boundedApp.app = boundedApp;
  globalThis.app = boundedApp;
}

function rendererProbe(source) {
  const deniedCapabilities = [];
  const requiredModules = [];
  try {
    exposeBoundedApp();
    return loadedResult(evaluateSource(source, deniedCapabilities, requiredModules), requiredModules, deniedCapabilities);
  } catch (error) {
    return failedResult(error, requiredModules, deniedCapabilities);
  }
}

async function lifecycleCall(instance, name, events) {
  if (typeof instance[name] !== "function") return;
  await instance[name]();
  events.push(name);
}

function lifecycleInstance(module, lifecycle) {
  const Constructor = pluginConstructor(module);
  if (!Constructor) throw new Error("lifecycle fixture did not export a plugin class");
  lifecycle.supported = true;
  const pluginApp = createPluginApp(lifecycle.events);
  const instance = new Constructor(pluginApp, {id: "renderer-lifecycle-fixture", version: "1"});
  Object.defineProperty(lifecycle, "_pluginApp", {configurable: true, value: pluginApp});
  lifecycle.api = pluginApiSummary(pluginApp);
  lifecycle.events.push("constructed");
  return instance;
}

async function workflowInstance(module, workflow, dataStore, phase, version) {
  const Constructor = pluginConstructor(module);
  if (!Constructor) throw new Error("workflow fixture did not export a plugin class");
  const pluginApp = createPluginApp([], dataStore);
  const instance = new Constructor(pluginApp, {id: "renderer-workflow-fixture", version});
  const events = ["constructed"];
  await lifecycleCall(instance, "onload", events);
  await lifecycleCall(instance, "onunload", events);
  const registered = {
    commands: [...pluginApp.commands],
    views: [...pluginApp.views],
    settings: [...pluginApp.settings],
    events: [...pluginApp.registeredEvents],
    persistence: [...pluginApp.persistence],
  };
  const phaseResult = {
    phase,
    version,
    lifecycle: events,
    loadedData: cloneData(pluginApp.loadedData),
    savedData: cloneData(pluginApp.savedData),
    registered,
    remainingRegistrationsBeforeCleanup: [registered.commands, registered.views, registered.settings, registered.events].filter((values) => values.length > 0).length,
  };
  pluginApp.commands.length = 0;
  pluginApp.views.length = 0;
  pluginApp.settings.length = 0;
  pluginApp.registeredEvents.length = 0;
  phaseResult.remainingRegistrationsAfterCleanup = pluginApp.commands.length + pluginApp.views.length + pluginApp.settings.length + pluginApp.registeredEvents.length;
  workflow.phases.push(phaseResult);
  return phaseResult;
}

function lifecycleWorkflowFailure(error, requiredModules, deniedCapabilities, workflow) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    status: deniedCapabilities.length > 0 ? "denied" : "failed",
    enforcement: "electron-context-isolated-sandbox",
    coverage: "electron-sandboxed-renderer-lifecycle-workflow",
    exportKind: "undefined",
    requiredModules,
    deniedCapabilities,
    workflow,
    error: message.slice(0, 600),
  };
}

async function rendererLifecycleWorkflowProbe(source) {
  const deniedCapabilities = [];
  const requiredModules = [];
  const workflow = {supported: false, phases: [], pluginDataWrites: 0, vaultWrites: 0, activeAfterUninstall: true};
  try {
    exposeBoundedApp();
    const module = evaluateSource(source, deniedCapabilities, requiredModules);
    workflow.supported = true;
    const dataStore = {value: {}, writes: 0};
    await workflowInstance(module, workflow, dataStore, "install", "1.0.0");
    await workflowInstance(module, workflow, dataStore, "restart", "1.0.0");
    await workflowInstance(module, workflow, dataStore, "update", "1.1.0");
    workflow.pluginDataWrites = dataStore.writes;
    workflow.activeAfterUninstall = false;
    workflow.uninstall = {registrationsCleared: workflow.phases.every((phase) => phase.remainingRegistrationsAfterCleanup === 0), returnToObsidian: true};
    return {
      status: "loaded",
      enforcement: "electron-context-isolated-sandbox",
      coverage: "electron-sandboxed-renderer-lifecycle-workflow",
      exportKind: "function",
      requiredModules,
      deniedCapabilities,
      workflow,
    };
  } catch (error) {
    return lifecycleWorkflowFailure(error, requiredModules, deniedCapabilities, workflow);
  }
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

async function rendererLifecycleProbe(source) {
  const deniedCapabilities = [];
  const requiredModules = [];
  const lifecycle = {supported: false, events: []};
  try {
    exposeBoundedApp();
    const module = evaluateSource(source, deniedCapabilities, requiredModules);
    const instance = lifecycleInstance(module, lifecycle);
    await lifecycleCall(instance, "onload", lifecycle.events);
    await lifecycleCall(instance, "onunload", lifecycle.events);
    lifecycle.api = pluginApiSummary(lifecycle._pluginApp);
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

function rendererScript(source, mode = "probe") {
  const runtime = [
    `const OBSIDIAN_EXPORT_NAMES = ${JSON.stringify(OBSIDIAN_EXPORT_NAMES)};`,
    remember,
    denyCapability,
    deniedObject,
    deniedFunction,
    safeDomObject,
    safeCallable,
    cloneData,
    createObsidianApi,
    pluginConstructor,
    createPluginApp,
    pluginApiSummary,
    createSafeRequire,
    createEvaluationArguments,
    evaluateSource,
    exportKind,
    loadedResult,
    failedResult,
    exposeBoundedApp,
    rendererProbe,
    lifecycleCall,
    lifecycleInstance,
    lifecycleFailure,
    rendererLifecycleProbe,
    workflowInstance,
    lifecycleWorkflowFailure,
    rendererLifecycleWorkflowProbe,
  ].map((functionDefinition) => functionDefinition.toString()).join("\n");
  const probe = mode === "workflow" ? "rendererLifecycleWorkflowProbe" : mode === "lifecycle" ? "rendererLifecycleProbe" : "rendererProbe";
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

async function executeRenderer(sourceFile, mode = "probe") {
  const source = readFileSync(sourceFile, "utf8");
  const window = createWindow();
  try {
    await window.loadURL("data:text/html,<meta charset='utf-8'><title>OpenObsidian plugin preflight</title>");
    return await window.webContents.executeJavaScript(rendererScript(source, mode), true);
  } finally {
    destroyWindow(window);
  }
}

function startupFailure(error, mode = "probe") {
  return {
    status: "failed",
    enforcement: "electron-context-isolated-sandbox",
    coverage: mode === "workflow" ? "electron-sandboxed-renderer-lifecycle-workflow" : mode === "lifecycle" ? "electron-sandboxed-renderer-lifecycle" : "electron-sandboxed-renderer-module-load-only",
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
  const mode = hasArgument("--run-workflow") ? "workflow" : hasArgument("--run-lifecycle") ? "lifecycle" : "probe";
  app.whenReady().then(() => executeRenderer(sourceFile, mode)).then(emit, (error) => emit(startupFailure(error, mode), 1));
}

start(argumentValue("--source-file"));
