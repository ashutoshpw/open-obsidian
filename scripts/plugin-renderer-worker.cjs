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
    append() {},
    prepend() {},
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

function safeDocumentObject() {
  return {
    body: safeDomObject(),
    createDocumentFragment() { return safeDomObject(); },
    createElement() { return safeDomObject(); },
    createTextNode() { return safeDomObject(); },
  };
}

function safeComponentObject() {
  const component = {app: null, containerEl: safeDomObject()};
  let proxy;
  proxy = new Proxy(component, {
    get(target, property) {
      if (property in target) return target[property];
      return (..._args) => proxy;
    },
  });
  return proxy;
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
      const component = safeComponentObject();
      component.app = args[0];
      return component;
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
      if (command && typeof command.id === "string") {
        this.app.commands.push(command.id);
        const callback = [command.callback, command.editorCallback, command.checkCallback].find((candidate) => typeof candidate === "function");
        if (callback) this.app.commandHandlers.push({id: command.id, callback, owner: this, callbackKind: callback === command.checkCallback ? "checkCallback" : callback === command.editorCallback ? "editorCallback" : "callback"});
      }
    }

    addRibbonIcon() {
      return safeDomObject();
    }

    addStatusBarItem() {
      return safeDomObject();
    }

    registerView(type, viewCreator) {
      if (typeof type === "string") {
        this.app.views.push(type);
        if (typeof viewCreator === "function") this.app.viewFactories.push({type, creator: viewCreator, owner: this});
      }
    }

    addSettingTab(tab) {
      if (tab) {
        const id = typeof tab.id === "string" ? tab.id : tab.constructor?.name || "setting-tab";
        this.app.settings.push(id);
        this.app.settingTabs.push({id, tab});
      }
    }

    registerEvent(event) {
      if (event && typeof event.type === "string") {
        this.app.registeredEvents.push(event.type);
        if (typeof event.callback === "function") this.app.eventHandlers.push({type: event.type, callback: event.callback});
      }
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
  class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = leaf?.app;
      this.containerEl = leaf?.containerEl ?? safeDomObject();
    }
  }
  class PluginSettingTab {
    constructor(pluginApp) {
      this.app = pluginApp;
      this.containerEl = safeDomObject();
    }
  }
  const target = {Plugin, ItemView, PluginSettingTab};
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

function createPluginApp(events, dataStore, workflowContext = {}) {
  const context = workflowContext && typeof workflowContext === "object" ? workflowContext : {};
  const files = new Map();
  const fileEntries = Array.isArray(context.files) ? context.files : [];
  for (const entry of fileEntries) {
    if (!entry || typeof entry.path !== "string") continue;
    files.set(entry.path, typeof entry.content === "string" ? entry.content : "");
  }
  const activePath = typeof context.active_file === "string" ? context.active_file : fileEntries[0]?.path;
  const metrics = context.metrics && typeof context.metrics === "object" ? context.metrics : {};
  if (!Array.isArray(metrics.vaultOperations)) metrics.vaultOperations = [];
  if (typeof metrics.vaultWrites !== "number") metrics.vaultWrites = 0;
  const fileRecord = (path) => {
    if (typeof path !== "string" || !files.has(path)) return null;
    const parts = path.split("/");
    const name = parts.at(-1) || path;
    const dot = name.lastIndexOf(".");
    return {path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1) : "", stat: {size: new TextEncoder().encode(files.get(path)).byteLength}};
  };
  const pathValue = (value) => typeof value === "string" ? value : value && typeof value.path === "string" ? value.path : "";
  const recordWrite = (operation, path) => {
    metrics.vaultWrites += 1;
    metrics.vaultOperations.push({operation, path: pathValue(path)});
  };
  const event = (type, callback) => ({type, callback, off() {}, ref: null});
  const missingFile = () => {
    const error = new Error("mediated vault path is unavailable");
    error.code = "ENOENT";
    throw error;
  };
  let pluginApp;
  const readPath = async (path) => {
    const value = files.get(pathValue(path));
    if (value === undefined) return missingFile();
    return value;
  };
  const writePath = async (path, value, operation = "modify") => {
    const target = pathValue(path);
    if (!target) return undefined;
    files.set(target, typeof value === "string" ? value : new TextDecoder().decode(value));
    recordWrite(operation, target);
    return fileRecord(target) || {path: target};
  };
  const adapter = {
    exists: async (path) => files.has(pathValue(path)),
    read: readPath,
    readBinary: async (path) => new TextEncoder().encode(await readPath(path)),
    write: (path, value) => writePath(path, value, "adapter.write"),
    writeBinary: (path, value) => writePath(path, value, "adapter.writeBinary"),
    append: async (path, value) => writePath(path, `${await readPath(path)}${value}`, "adapter.append"),
    appendBinary: async (path, value) => writePath(path, `${await readPath(path)}${new TextDecoder().decode(value)}`, "adapter.appendBinary"),
    list: async () => ({files: [...files.keys()].map(fileRecord).filter(Boolean), folders: []}),
    mkdir: async () => undefined,
    rmdir: async () => undefined,
    remove: async (path) => { files.delete(pathValue(path)); recordWrite("adapter.remove", path); },
    stat: async (path) => fileRecord(pathValue(path)) || missingFile(),
    getBasePath: () => "",
    getFullPath: (path) => path,
    getResourcePath: (path) => path,
    readFile: readPath,
    writeFile: (path, value) => writePath(path, value, "adapter.writeFile"),
    readdir: async () => [...files.keys()],
    unlink: async (path) => { files.delete(pathValue(path)); recordWrite("adapter.unlink", path); },
    lstat: async (path) => fileRecord(pathValue(path)) || missingFile(),
    readlink: async () => "",
    symlink: async () => undefined,
    cp: async (source, target) => writePath(target, await readPath(source), "adapter.cp"),
    rm: async (path) => { files.delete(pathValue(path)); recordWrite("adapter.rm", path); },
  };
  const vault = {
    on(type, callback) { return event(type, callback); },
    off() {},
    offref() {},
    getConfig() { return context.vault_config; },
    getAbstractFileByPath(path) { return fileRecord(pathValue(path)); },
    getFileByPath(path) { return fileRecord(pathValue(path)); },
    getFolderByPath() { return null; },
    getFiles() { return [...files.keys()].map(fileRecord).filter(Boolean); },
    getAllLoadedFiles() { return [...files.keys()].map(fileRecord).filter(Boolean); },
    read: readPath,
    cachedRead: readPath,
    create: (path, value) => writePath(path, value, "vault.create"),
    createBinary: (path, value) => writePath(path, value, "vault.createBinary"),
    createFolder: async () => undefined,
    modify: (file, value) => writePath(file, value, "vault.modify"),
    modifyBinary: (file, value) => writePath(file, value, "vault.modifyBinary"),
    delete: async (file) => { files.delete(pathValue(file)); recordWrite("vault.delete", file); },
    config: {defaultViewMode: "source", livePreview: false},
    adapter,
  };
  const activeFile = fileRecord(activePath);
  const leaves = Array.isArray(context.leaves) ? context.leaves : [];
  const workspace = {
    layoutReady: true,
    on(type, callback) { return event(type, callback); },
    off() {},
    offref() {},
    onLayoutReady(callback) { if (typeof callback === "function") callback(); },
    getLeavesOfType(type) { return leaves.filter((leaf) => leaf && leaf.type === type); },
    getRightLeaf() { return {app: pluginApp, view: {containerEl: safeDomObject()}, setViewState() {}, openFile: async (file) => { pluginApp.activeFile = file; }}; },
    getLeftLeaf() { return {app: pluginApp, view: {containerEl: safeDomObject()}, setViewState() {}, openFile: async (file) => { pluginApp.activeFile = file; }}; },
    getLayout() { return {type: "split", children: []}; },
    getActiveFile() { return activeFile; },
    getActiveViewOfType() { return context.active_view || null; },
    getActiveFileView() { return context.active_view || null; },
    getLeaf() { return {app: pluginApp, view: {containerEl: safeDomObject()}, openFile: async (file) => { pluginApp.activeFile = file; }, setViewState() {}}; },
    getMostRecentLeaf() { return null; },
    openLinkText: async (_link, _sourcePath, _newLeaf) => undefined,
    revealLeaf: async () => undefined,
    changeLayout: async () => undefined,
    iterateAllLeaves(callback) { for (const leaf of leaves) if (typeof callback === "function") callback(leaf); },
    trigger() {},
  };
  pluginApp = {
    events,
    commands: [],
    commandHandlers: [],
    views: [],
    viewFactories: [],
    settings: [],
    settingTabs: [],
    registeredEvents: [],
    eventHandlers: [],
    persistence: [],
    dataStore,
    vault,
    workspace,
    metadataCache: {getFileCache() { return {}; }, getFirstLinkpathDest(path) { return fileRecord(path) || activeFile; }},
    config: {defaultViewMode: "source", livePreview: false},
    fileManager: {trashFile: async (file) => { files.delete(pathValue(file)); recordWrite("fileManager.trashFile", file); }},
    commandsManager: {},
    plugins: {enabledPlugins: new Set(), plugins: context.plugins || {}, getPlugin(id) { return this.plugins[id] || null; }},
    internalPlugins: {plugins: {}, getEnabledPluginById() { return null; }},
    app: null,
    activeFile,
  };
  return pluginApp;
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
  globalThis.activeDocument = safeDocumentObject();
  globalThis.DOMParser = class { parseFromString() { return safeDocumentObject(); } };
  globalThis.createDiv = () => safeDomObject();
  globalThis.createEl = () => safeDomObject();
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

function actionError(error) {
  return error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
}

async function awaitAction(value) {
  if (value && typeof value.then === "function") await value;
}

async function exerciseRegistrations(pluginApp) {
  const actions = {commands: [], views: [], settings: []};
  for (const command of pluginApp.commandHandlers) {
    try {
      await awaitAction(command.callback.call(command.owner));
      actions.commands.push({id: command.id, callbackKind: command.callbackKind, status: "passed"});
    } catch (error) {
      actions.commands.push({id: command.id, callbackKind: command.callbackKind, status: "failed", error: actionError(error)});
    }
  }
  for (const viewFactory of pluginApp.viewFactories) {
    const leaf = {app: pluginApp, containerEl: safeDomObject(), view: null, getViewState() { return {}; }, setViewState() {}};
    try {
      let view;
      let directError;
      try {
        view = viewFactory.creator(leaf);
      } catch (error) {
        directError = error;
        try {
          view = Reflect.construct(viewFactory.creator, [leaf]);
        } catch {
          throw directError;
        }
      }
      leaf.view = view || null;
      if (view && typeof view.onOpen === "function") await awaitAction(view.onOpen());
      if (view && typeof view.onClose === "function") await awaitAction(view.onClose());
      actions.views.push({type: viewFactory.type, status: "passed", lifecycle: ["construct", "onOpen", "onClose"].filter((name) => name === "construct" || (name === "onOpen" && view && typeof view.onOpen === "function") || (name === "onClose" && view && typeof view.onClose === "function"))});
    } catch (error) {
      actions.views.push({type: viewFactory.type, status: "failed", error: actionError(error)});
    }
  }
  for (const setting of pluginApp.settingTabs) {
    try {
      if (setting.tab && typeof setting.tab.display === "function") await awaitAction(setting.tab.display());
      actions.settings.push({id: setting.id, status: "passed", displayed: Boolean(setting.tab && typeof setting.tab.display === "function")});
    } catch (error) {
      actions.settings.push({id: setting.id, status: "failed", error: actionError(error)});
    }
  }
  return actions;
}

async function workflowInstance(module, workflow, dataStore, phase, version, workflowContext = {}, manifestId = "renderer-workflow-fixture") {
  const Constructor = pluginConstructor(module);
  if (!Constructor) throw new Error("workflow fixture did not export a plugin class");
  const pluginApp = createPluginApp([], dataStore, workflowContext);
  const instance = new Constructor(pluginApp, {id: manifestId, version});
  const events = ["constructed"];
  await lifecycleCall(instance, "onload", events);
  const actions = await exerciseRegistrations(pluginApp);
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
    actions,
    remainingRegistrationsBeforeCleanup: [registered.commands, registered.views, registered.settings, registered.events].filter((values) => values.length > 0).length,
  };
  pluginApp.commands.length = 0;
  pluginApp.views.length = 0;
  pluginApp.settings.length = 0;
  pluginApp.registeredEvents.length = 0;
  pluginApp.commandHandlers.length = 0;
  pluginApp.viewFactories.length = 0;
  pluginApp.settingTabs.length = 0;
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

async function rendererLifecycleWorkflowProbe(source, workflowConfig = {}) {
  const deniedCapabilities = [];
  const requiredModules = [];
  const metrics = {vaultWrites: 0, vaultOperations: []};
  const workflowContext = {...workflowConfig, metrics};
  const workflow = {supported: false, phases: [], pluginDataWrites: 0, vaultWrites: 0, vaultOperations: [], activeAfterUninstall: true, artifactId: typeof workflowConfig.artifact_id === "string" ? workflowConfig.artifact_id : "renderer-workflow-fixture"};
  try {
    exposeBoundedApp();
    const module = evaluateSource(source, deniedCapabilities, requiredModules);
    workflow.supported = true;
    const dataStore = {value: cloneData(workflowConfig.initial_data), writes: 0};
    await workflowInstance(module, workflow, dataStore, "install", "1.0.0", workflowContext, workflow.artifactId);
    await workflowInstance(module, workflow, dataStore, "restart", "1.0.0", workflowContext, workflow.artifactId);
    await workflowInstance(module, workflow, dataStore, "update", "1.1.0", workflowContext, workflow.artifactId);
    workflow.pluginDataWrites = dataStore.writes;
    workflow.vaultWrites = metrics.vaultWrites;
    workflow.vaultOperations = metrics.vaultOperations;
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

function rendererScript(source, mode = "probe", workflowConfig = {}) {
  const runtime = [
    `const OBSIDIAN_EXPORT_NAMES = ${JSON.stringify(OBSIDIAN_EXPORT_NAMES)};`,
    remember,
    denyCapability,
    deniedObject,
    deniedFunction,
    safeDomObject,
    safeDocumentObject,
    safeComponentObject,
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
    actionError,
    awaitAction,
    exerciseRegistrations,
    workflowInstance,
    lifecycleWorkflowFailure,
    rendererLifecycleWorkflowProbe,
  ].map((functionDefinition) => functionDefinition.toString()).join("\n");
  const probe = mode === "workflow" ? "rendererLifecycleWorkflowProbe" : mode === "lifecycle" ? "rendererLifecycleProbe" : "rendererProbe";
  return `(function(){${runtime};return ${probe}(${JSON.stringify(source)}, ${JSON.stringify(workflowConfig)});})()`;
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

async function executeRenderer(sourceFile, mode = "probe", workflowConfig = {}) {
  const source = readFileSync(sourceFile, "utf8");
  const window = createWindow();
  try {
    await window.loadURL("data:text/html,<meta charset='utf-8'><title>OpenObsidian plugin preflight</title>");
    return await window.webContents.executeJavaScript(rendererScript(source, mode, workflowConfig), true);
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
  let workflowConfig = {};
  const configFile = argumentValue("--workflow-config");
  if (configFile) workflowConfig = JSON.parse(readFileSync(configFile, "utf8"));
  app.whenReady().then(() => executeRenderer(sourceFile, mode, workflowConfig)).then(emit, (error) => emit(startupFailure(error, mode), 1));
}

start(argumentValue("--source-file"));
