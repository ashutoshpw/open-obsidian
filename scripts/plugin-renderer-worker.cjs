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

function rememberDeniedPath(capabilities, path) {
  if (typeof path !== "string" || path.length === 0) return;
  if (!Array.isArray(capabilities.deniedPaths)) capabilities.deniedPaths = [];
  remember(capabilities.deniedPaths, path);
}

function denyCapability(capabilities, capability, path = capability) {
  remember(capabilities, capability);
  rememberDeniedPath(capabilities, path);
  throw new Error(`D15 denied ${capability}`);
}

function deniedObject(capabilities, capability, path = capability) {
  const fail = () => denyCapability(capabilities, capability, path);
  return new Proxy(Object.create(null), {
    get: fail,
    set: fail,
    defineProperty: fail,
    deleteProperty: fail,
    getPrototypeOf: () => null,
    setPrototypeOf: fail,
  });
}

function deniedFunction(capabilities, capability, path = capability) {
  const denied = function deniedCall() {
    return denyCapability(capabilities, capability, path);
  };
  Object.defineProperty(denied, "prototype", {value: Function.prototype});
  return denied;
}

function safeDomObject() {
  return new Proxy({
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) { return child; },
    addChild(child) { return child; },
    append() {},
    prepend() {},
    appendText() {},
    createEl() { return safeDomObject(); },
    createDiv() { return safeDomObject(); },
    createSpan() { return safeDomObject(); },
    empty() {},
    toggleClass() {},
    addClass() {},
    removeClass() {},
    setText() {},
    setAttr() {},
    setAttribute() {},
    removeAttribute() {},
    setChildrenInPlace() {},
    style: {removeProperty() {}, setProperty() {}, getPropertyValue() { return ""; }},
    classList: {add() {}, remove() {}, toggle() {}, contains() { return false; }},
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return safeCallable(`dom.${String(property)}`);
    },
  });
}

function safeDocumentObject(capabilities, allowSyntheticDocument = false, root = "document") {
  const target = {body: safeDomObject()};
  if (allowSyntheticDocument) {
    target.createDocumentFragment = () => safeDomObject();
    target.createElement = () => safeDomObject();
    target.createTextNode = () => safeDomObject();
    target.getElementsByClassName = () => safeCollection([]);
    target.addEventListener = () => undefined;
    target.removeEventListener = () => undefined;
    target.on = () => undefined;
    target.off = () => undefined;
  }
  return new Proxy(target, {
    get(current, property) {
      if (property in current) return current[property];
      return denyCapability(capabilities, "dom.privileged", `${root}.${String(property)}`);
    },
  });
}

function safeCollection(values = []) {
  const collection = [...values];
  Object.defineProperty(collection, "first", {configurable: true, value: () => collection[0]});
  Object.defineProperty(collection, "contains", {configurable: true, value: (value) => collection.includes(value)});
  return collection;
}

function boundedMoment(value) {
  const initial = value && typeof value === "object" && value._date instanceof Date
    ? value._date
    : value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : new Date();
  const date = new Date(initial.getTime());
  const moment = {
    _date: date,
    clone() { return boundedMoment(date); },
    isValid() { return Number.isFinite(date.getTime()); },
    add(amount, unit) {
      if (unit === "d" || unit === "day" || unit === "days") date.setUTCDate(date.getUTCDate() + Number(amount));
      if (unit === "w" || unit === "week" || unit === "weeks") date.setUTCDate(date.getUTCDate() + Number(amount) * 7);
      if (unit === "M" || unit === "month" || unit === "months") date.setUTCMonth(date.getUTCMonth() + Number(amount));
      if (unit === "y" || unit === "year" || unit === "years") date.setUTCFullYear(date.getUTCFullYear() + Number(amount));
      return moment;
    },
    set(values, value) {
      if (typeof values === "string") values = {[values]: value};
      if (values && typeof values === "object") {
        if (values.year !== undefined) date.setUTCFullYear(Number(values.year));
        if (values.month !== undefined) date.setUTCMonth(Number(values.month));
        if (values.date !== undefined || values.day !== undefined) date.setUTCDate(Number(values.date ?? values.day));
        if (values.hour !== undefined) date.setUTCHours(Number(values.hour));
        if (values.minute !== undefined) date.setUTCMinutes(Number(values.minute));
        if (values.second !== undefined) date.setUTCSeconds(Number(values.second));
      }
      return moment;
    },
    startOf(unit) {
      if (unit === "day") date.setUTCHours(0, 0, 0, 0);
      if (unit === "week") {
        const day = date.getUTCDay();
        date.setUTCDate(date.getUTCDate() - day);
        date.setUTCHours(0, 0, 0, 0);
      }
      if (unit === "month") {
        date.setUTCDate(1);
        date.setUTCHours(0, 0, 0, 0);
      }
      return moment;
    },
    weekday(value) {
      if (value === undefined) return date.getUTCDay();
      date.setUTCDate(date.getUTCDate() + Number(value) - date.getUTCDay());
      return moment;
    },
    format(pattern = "YYYY-MM-DD") {
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      const firstDay = new Date(Date.UTC(year, 0, 1));
      const week = String(Math.ceil((((date - firstDay) / 86400000) + firstDay.getUTCDay() + 1) / 7)).padStart(2, "0");
      return String(pattern)
        .replace(/\[([^\]]+)\]/g, "$1")
        .replace(/GGGG/g, String(year))
        .replace(/YYYY/g, String(year))
        .replace(/MM/g, month)
        .replace(/DD/g, day)
        .replace(/WW/g, week)
        .replace(/ww/g, week);
    },
    localeData() { return {_week: {dow: 0}}; },
  };
  return moment;
}

function safeWindowObject(capabilities, runtimeApp, allowSyntheticDocument = false, root = "window") {
  const document = safeDocumentObject(capabilities, allowSyntheticDocument, `${root}.document`);
  const moment = (value) => boundedMoment(value);
  moment.weekdays = () => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  moment.months = () => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  let boundedTimerCalls = 0;
  const boundedTimer = allowSyntheticDocument
    ? (callback) => {
      if (++boundedTimerCalls > 32) return 0;
      if (typeof callback === "function") Promise.resolve().then(callback);
      return 0;
    }
    : () => denyCapability(capabilities, "resource.unbounded", `${root}.setTimeout`);
  const target = {
    app: runtimeApp || null,
    document,
    moment,
    CodeMirrorAdapter: null,
    setTimeout: boundedTimer,
    setInterval: (callback) => {
      if (!allowSyntheticDocument) return denyCapability(capabilities, "resource.unbounded", `${root}.setInterval`);
      let calls = 0;
      const tick = () => {
        if (++calls > 32) return;
        if (typeof callback === "function") callback();
        if (calls < 32) Promise.resolve().then(tick);
      };
      Promise.resolve().then(tick);
      return 0;
    },
    clearTimeout() {},
    clearInterval() {},
  };
  if (allowSyntheticDocument) {
    target.smart_env = null;
    target.smart_env_configs = Object.create(null);
    target.all_envs = [];
  }
  return new Proxy(target, {
    get(current, property) {
      if (property in current) return current[property];
      return denyCapability(capabilities, "dom.privileged", `${root}.${String(property)}`);
    },
    set(current, property, value) {
      if (property === "app" || (allowSyntheticDocument && ["smart_env", "smart_env_configs", "all_envs"].includes(property))) {
        current[property] = value;
        return true;
      }
      return denyCapability(capabilities, "dom.privileged", `${root}.${String(property)}`);
    },
  });
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

    addChild(child) { return child; }

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
      this.contentEl = this.containerEl;
    }

    registerEvent(event) {
      if (event && typeof event.type === "string" && this.app) {
        this.app.registeredEvents.push(event.type);
      }
      return event;
    }
  }
  class FileView {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = leaf?.app;
      this.file = leaf?.file || null;
    }
  }
  class PluginSettingTab {
    constructor(pluginApp) {
      this.app = pluginApp;
      this.name = "";
      this.icon = "";
      this.containerEl = safeDomObject();
    }
  }
  const target = {Plugin, ItemView, FileView, PluginSettingTab};
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

function createPluginApp(events, dataStore, workflowContext = {}, capabilities = []) {
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
  const folderRecord = (path) => {
    const normalized = pathValue(path).replace(/\\/g, "/").replace(/\/$/, "");
    const prefix = normalized ? `${normalized}/` : "";
    return {path: normalized, name: normalized.split("/").at(-1) || normalized, children: [...files.keys()].filter((candidate) => candidate.startsWith(prefix)).map(fileRecord).filter(Boolean)};
  };
  const pathValue = (value) => typeof value === "string" ? value : value && typeof value.path === "string" ? value.path : "";
  const recordWrite = (operation, path) => {
    metrics.vaultWrites += 1;
    metrics.vaultOperations.push({operation, path: pathValue(path)});
  };
  const denyVaultWrite = (operation, path) => denyCapability(capabilities, "vault.direct-write", `vault.${operation}:${pathValue(path)}`);
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
    denyVaultWrite(operation, target);
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
    remove: async (path) => { denyVaultWrite("adapter.remove", path); files.delete(pathValue(path)); recordWrite("adapter.remove", path); },
    stat: async (path) => fileRecord(pathValue(path)) || missingFile(),
    getBasePath: () => "",
    getFullPath: (path) => path,
    getResourcePath: (path) => path,
    readFile: readPath,
    writeFile: (path, value) => writePath(path, value, "adapter.writeFile"),
    readdir: async () => [...files.keys()],
    unlink: async (path) => { denyVaultWrite("adapter.unlink", path); files.delete(pathValue(path)); recordWrite("adapter.unlink", path); },
    lstat: async (path) => fileRecord(pathValue(path)) || missingFile(),
    readlink: async () => "",
    symlink: async () => undefined,
    cp: async (source, target) => writePath(target, await readPath(source), "adapter.cp"),
    rm: async (path) => { denyVaultWrite("adapter.rm", path); files.delete(pathValue(path)); recordWrite("adapter.rm", path); },
  };
  const vault = {
    on(type, callback) { return event(type, callback); },
    off() {},
    offref() {},
    getConfig() { return context.vault_config; },
    getAbstractFileByPath(path) { return fileRecord(pathValue(path)); },
    getFileByPath(path) { return fileRecord(pathValue(path)); },
    getFolderByPath(path) { return folderRecord(path); },
    getFiles() { return safeCollection([...files.keys()].map(fileRecord).filter(Boolean)); },
    getAllLoadedFiles() { return safeCollection([...files.keys()].map(fileRecord).filter(Boolean)); },
    recurseChildren(folder, callback) {
      const normalized = pathValue(folder).replace(/\\/g, "/").replace(/\/$/, "");
      const prefix = normalized ? `${normalized}/` : "";
      for (const candidate of files.keys()) {
        if (candidate.startsWith(prefix) && typeof callback === "function") callback(fileRecord(candidate));
      }
    },
    read: readPath,
    cachedRead: readPath,
    create: (path, value) => writePath(path, value, "vault.create"),
    createBinary: (path, value) => writePath(path, value, "vault.createBinary"),
    createFolder: async () => undefined,
    modify: (file, value) => writePath(file, value, "vault.modify"),
    modifyBinary: (file, value) => writePath(file, value, "vault.modifyBinary"),
    delete: async (file) => { denyVaultWrite("vault.delete", file); files.delete(pathValue(file)); recordWrite("vault.delete", file); },
    config: {defaultViewMode: "source", livePreview: false},
    adapter,
  };
  const activeFile = fileRecord(activePath);
  const leaves = safeCollection(Array.isArray(context.leaves) ? context.leaves : []);
  const activeLeaf = {app: null, file: activeFile, view: context.active_view || null, containerEl: safeDomObject()};
  const createLeaf = () => {
    const leaf = {
      app: pluginApp,
      file: activeFile,
      view: null,
      type: "empty",
      containerEl: safeDomObject(),
      getViewState() { return {type: leaf.type}; },
      setViewState: async (state = {}) => {
        leaf.type = typeof state.type === "string" ? state.type : leaf.type;
        const factory = pluginApp.viewFactories.find((candidate) => candidate.type === leaf.type);
        if (factory) {
          leaf.view = factory.creator(leaf);
          if (leaf.view && typeof leaf.view.onOpen === "function") await awaitAction(leaf.view.onOpen());
        }
        if (!leaves.includes(leaf)) leaves.push(leaf);
        activeLeaf.view = leaf.view;
        return leaf;
      },
      openFile: async (file) => {
        leaf.file = file;
        activeLeaf.file = file;
        activeLeaf.view = {file};
      },
    };
    return leaf;
  };
  const workspace = {
    layoutReady: true,
    activeLeaf,
    on(type, callback) { return event(type, callback); },
    off() {},
    offref() {},
    onLayoutReady(callback) { if (typeof callback === "function") callback(); },
    getLeavesOfType(type) { return safeCollection(leaves.filter((leaf) => leaf && leaf.type === type)); },
    getRightLeaf() { return createLeaf(); },
    getLeftLeaf() { return createLeaf(); },
    getUnpinnedLeaf() { return createLeaf(); },
    splitActiveLeaf() { return createLeaf(); },
    getLayout() { return {type: "split", children: []}; },
    getActiveFile() { return activeFile; },
    getActiveViewOfType() { return context.active_view || null; },
    getActiveFileView() { return context.active_view || null; },
    registerHoverLinkSource() {},
    getLeaf() { return createLeaf(); },
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
    metadataCache: {
      getFileCache() { return {}; },
      getFirstLinkpathDest(path) { return fileRecord(path) || activeFile; },
      getCachedFiles() { return []; },
      getCache() { return {}; },
      getTags() { return {}; },
      on(type, callback) { return event(type, callback); },
      off() {},
      offref() {},
    },
    config: {defaultViewMode: "source", livePreview: false},
    fileManager: {trashFile: async (file) => { denyVaultWrite("fileManager.trashFile", file); files.delete(pathValue(file)); recordWrite("fileManager.trashFile", file); }},
    commandsManager: {},
    plugins: {enabledPlugins: new Set(), plugins: context.plugins || {}, getPlugin(id) { return this.plugins[id] || null; }},
    internalPlugins: {plugins: {}, getEnabledPluginById() { return null; }},
    app: null,
    activeFile,
  };
  pluginApp.app = pluginApp;
  activeLeaf.app = pluginApp;
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

function createEvaluationArguments(capabilities, requiredModules, runtime = {}) {
  const safeWindow = runtime.window || (runtime.window = safeWindowObject(capabilities, runtime.app, runtime.allowSyntheticDocument === true));
  let boundedTimerCalls = 0;
  const boundedTimer = runtime.allowSyntheticDocument
    ? (callback) => {
      if (++boundedTimerCalls > 32) return 0;
      if (typeof callback === "function") Promise.resolve().then(callback);
      return 0;
    }
    : deniedFunction(capabilities, "resource.unbounded");
  const boundedInterval = runtime.allowSyntheticDocument
    ? (callback) => {
      let calls = 0;
      const tick = () => {
        if (++calls > 32) return;
        if (typeof callback === "function") callback();
        if (calls < 32) Promise.resolve().then(tick);
      };
      Promise.resolve().then(tick);
      return 0;
    }
    : deniedFunction(capabilities, "resource.unbounded");
  return [
    createSafeRequire(capabilities, requiredModules),
    safeDocumentObject(capabilities, runtime.allowSyntheticDocument === true),
    safeWindow,
    safeWindow,
    safeWindow,
    safeWindow,
    safeWindow,
    deniedObject(capabilities, "process.spawn"),
    deniedFunction(capabilities, "network.request"),
    deniedFunction(capabilities, "network.request"),
    deniedFunction(capabilities, "network.request"),
    deniedObject(capabilities, "credentials.read"),
    deniedObject(capabilities, "native.abi"),
    boundedTimer,
    boundedInterval,
    () => undefined,
    () => undefined,
    boundedTimer,
    deniedFunction(capabilities, "code.dynamic"),
    undefined,
    TextEncoder,
    TextDecoder,
    safeCallable("activeWindow"),
  ];
}

function evaluateSource(source, capabilities, requiredModules, runtime = {}) {
  const module = {exports: {}};
  if (typeof Array.prototype.contains !== "function") {
    Object.defineProperty(Array.prototype, "contains", {configurable: true, value(value) { return this.includes(value); }});
  }
  globalThis.activeDocument = safeDocumentObject(capabilities, runtime.allowSyntheticDocument === true, "activeDocument");
  globalThis.DOMParser = class { parseFromString() { return safeDocumentObject(capabilities, runtime.allowSyntheticDocument === true, "DOMParser.document"); } };
  globalThis.createDiv = () => safeDomObject();
  globalThis.createEl = () => safeDomObject();
  const factory = new Function(
    "module", "exports", "require", "document", "window", "globalThis", "self", "navigator", "location",
    "process", "fetch", "WebSocket", "XMLHttpRequest", "keytar", "WebAssembly", "setTimeout", "setInterval",
    "clearTimeout", "clearInterval", "setImmediate", "Function", "moduleBuffer", "TextEncoder", "TextDecoder", "activeWindow", "app",
    `"use strict";\n${source}\n`,
  );
  factory(module, module.exports, ...createEvaluationArguments(capabilities, requiredModules, runtime), runtime.window?.app || null);
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
    deniedPaths: Array.isArray(deniedCapabilities.deniedPaths) ? [...deniedCapabilities.deniedPaths] : [],
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
    deniedPaths: Array.isArray(deniedCapabilities.deniedPaths) ? [...deniedCapabilities.deniedPaths] : [],
    error: message.slice(0, 600),
  };
}

function exposeBoundedApp(capabilities = []) {
  const boundedApp = createPluginApp([], undefined, {}, capabilities);
  boundedApp.app = boundedApp;
  globalThis.app = boundedApp;
  return boundedApp;
}

function rendererProbe(source) {
  const deniedCapabilities = [];
  const requiredModules = [];
  try {
    const boundedApp = exposeBoundedApp(deniedCapabilities);
    return loadedResult(evaluateSource(source, deniedCapabilities, requiredModules, {app: boundedApp}), requiredModules, deniedCapabilities);
  } catch (error) {
    return failedResult(error, requiredModules, deniedCapabilities);
  }
}

async function lifecycleCall(instance, name, events) {
  if (typeof instance[name] !== "function") return;
  await instance[name]();
  events.push(name);
}

function lifecycleInstance(module, lifecycle, runtime = {}, capabilities = []) {
  const Constructor = pluginConstructor(module);
  if (!Constructor) throw new Error("lifecycle fixture did not export a plugin class");
  lifecycle.supported = true;
  const pluginApp = createPluginApp(lifecycle.events, undefined, {}, capabilities);
  if (runtime.window) runtime.window.app = pluginApp;
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
  if (!value || typeof value.then !== "function") return;
  const timeoutMs = 1000;
  let timer;
  try {
    await Promise.race([
      value,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`bounded action timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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

async function workflowInstance(module, workflow, dataStore, phase, version, workflowContext = {}, manifestId = "renderer-workflow-fixture", runtime = {}, capabilities = []) {
  const Constructor = pluginConstructor(module);
  if (!Constructor) throw new Error("workflow fixture did not export a plugin class");
  const pluginApp = createPluginApp([], dataStore, workflowContext, capabilities);
  const instance = new Constructor(pluginApp, {id: manifestId, version});
  pluginApp.plugins.plugins[manifestId] = instance;
  if (runtime.window) runtime.window.app = pluginApp;
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
    deniedPaths: Array.isArray(deniedCapabilities.deniedPaths) ? [...deniedCapabilities.deniedPaths] : [],
    workflow,
    errorStack: error instanceof Error && typeof error.stack === "string" ? error.stack.slice(0, 1600) : undefined,
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
    const dataStore = {value: cloneData(workflowConfig.initial_data), writes: 0};
    const initialApp = createPluginApp([], dataStore, workflowContext, deniedCapabilities);
    const runtime = {app: initialApp, allowSyntheticDocument: true};
    const evaluatePhase = () => evaluateSource(source, deniedCapabilities, requiredModules, runtime);
    const module = evaluatePhase();
    workflow.supported = true;
    await workflowInstance(module, workflow, dataStore, "install", "1.0.0", workflowContext, workflow.artifactId, runtime, deniedCapabilities);
    await workflowInstance(evaluatePhase(), workflow, dataStore, "restart", "1.0.0", workflowContext, workflow.artifactId, runtime, deniedCapabilities);
    await workflowInstance(evaluatePhase(), workflow, dataStore, "update", "1.1.0", workflowContext, workflow.artifactId, runtime, deniedCapabilities);
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
    deniedPaths: Array.isArray(deniedCapabilities.deniedPaths) ? [...deniedCapabilities.deniedPaths] : [],
    lifecycle,
    error: message.slice(0, 600),
  };
}

async function rendererLifecycleProbe(source) {
  const deniedCapabilities = [];
  const requiredModules = [];
  const lifecycle = {supported: false, events: []};
  try {
    const boundedApp = exposeBoundedApp(deniedCapabilities);
    const runtime = {app: boundedApp};
    const module = evaluateSource(source, deniedCapabilities, requiredModules, runtime);
    const instance = lifecycleInstance(module, lifecycle, runtime, deniedCapabilities);
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
    rememberDeniedPath,
    denyCapability,
    deniedObject,
    deniedFunction,
    safeDomObject,
    safeDocumentObject,
    safeCollection,
    boundedMoment,
    safeWindowObject,
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
