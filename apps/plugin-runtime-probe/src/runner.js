(() => {
  const config = __OPENOBSIDIAN_PROBE_CONFIG__;
  const bundleSource = __OPENOBSIDIAN_BUNDLE_SOURCE__;
  const nativeFunction = Function;
  const nativeJsonStringify = JSON.stringify.bind(JSON);
  const nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  const ipcPostMessage = window.ipc?.postMessage?.bind(window.ipc);
  const root = document.getElementById("openobsidian-plugin-root");
  if (typeof config.themeSettingsCss === "string") {
    const themeSettingsStyle = document.createElement("style");
    themeSettingsStyle.textContent = config.themeSettingsCss;
    document.head.append(themeSettingsStyle);
  }
  Object.defineProperty(globalThis, "activeWindow", {configurable: true, value: window});
  Object.defineProperty(globalThis, "activeDocument", {configurable: true, value: document});
  const capabilityDenials = [];
  const cspViolations = [];
  const attemptedModules = [];
  const apiCalls = [];
  const registrations = {commands: [], views: [], settingTabs: [], events: []};
  const editorWorkflow = {
    registeredCallbacks: 0,
    invokedCallbacks: 0,
    completedCallbacks: 0,
    changed: false,
    errors: [],
  };

  document.addEventListener("securitypolicyviolation", (event) => {
    cspViolations.push({directive: event.effectiveDirective, blockedURI: event.blockedURI});
  });

  function remember(list, value) {
    if (!list.includes(value)) list.push(value);
  }

  function deny(capability, detail = capability) {
    remember(capabilityDenials, capability);
    throw new Error(`OpenObsidian denied ${capability} (${detail})`);
  }

  function safeElement(tag, options = {}) {
    const element = document.createElement(tag);
    if (typeof options === "string") options = {text: options};
    if (options.id) element.id = String(options.id);
    if (options.cls) {
      for (const className of String(options.cls).split(/\s+/).filter(Boolean)) element.classList.add(className);
    }
    if (options.text !== undefined) element.textContent = String(options.text);
    if (options.attr && typeof options.attr === "object") {
      for (const [name, value] of Object.entries(options.attr)) element.setAttribute(name, String(value));
    }
    if (options.title) element.setAttribute("title", String(options.title));
    if (options.href) element.setAttribute("href", String(options.href));
    if (options.type) element.setAttribute("type", String(options.type));
    if (options.value !== undefined) element.setAttribute("value", String(options.value));
    if (options.parent) options.parent.append(element);
    return element;
  }

  function installObsidianDomExtensions() {
    const methods = {
      createEl(tag, options = {}) { return safeElement(tag, {...(typeof options === "object" ? options : {cls: options}), parent: this}); },
      createDiv(options = {}) { return safeElement("div", {...(typeof options === "object" ? options : {cls: options}), parent: this}); },
      createSpan(options = {}) { return safeElement("span", {...(typeof options === "object" ? options : {cls: options}), parent: this}); },
      empty() { this.replaceChildren(); },
      addClass(...names) { this.classList.add(...names.flatMap((name) => String(name).split(/\s+/).filter(Boolean))); },
      removeClass(...names) { this.classList.remove(...names.flatMap((name) => String(name).split(/\s+/).filter(Boolean))); },
      toggleClass(name, force) { return this.classList.toggle(name, force); },
      hasClass(name) { return this.classList.contains(name); },
      setText(value) { this.textContent = String(value ?? ""); },
      setAttr(name, value) { this.setAttribute(String(name), String(value)); },
      appendText(value) { this.append(document.createTextNode(String(value ?? ""))); },
    };
    for (const [name, method] of Object.entries(methods)) {
      Object.defineProperty(Element.prototype, name, {configurable: true, writable: true, value: method});
    }
  }

  function safeModule(name) {
    let callable;
    callable = new Proxy(function safeModuleCall() { return callable; }, {
      get(_target, property) {
        if (property === "then") return undefined;
        if (property === Symbol.toStringTag) return "Module";
        if (property === "default") return callable;
        return callable;
      },
      apply() { return callable; },
      construct() { return callable; },
      set() { return true; },
    });
    Object.defineProperty(callable, "name", {value: `safe:${name}`, configurable: true});
    return callable;
  }

  function safeRequire(specifier) {
    const name = String(specifier);
    remember(attemptedModules, name);
    if (name === "obsidian") return obsidianApi;
    if (name === "@codemirror/language") return {
      foldable() { return null; },
      foldedRanges() { return {iter() { return {value: null, next() {}}; }, between() {}}; },
      foldEffect: {of(value) { return {type: "fold", range: value}; }},
      unfoldEffect: {of(value) { return {type: "unfold", range: value}; }},
      getIndentUnit() { return 4; },
      indentString() { return "    "; },
    };
    if (/^(?:@codemirror\/|@lezer\/|codemirror$|luxon$|moment$|svelte(?:\/|$)|(?:js-)?yaml$)/.test(name)) {
      return safeModule(name);
    }
    const capability = /^(?:node:)?fs(?:\/|$)|^(?:node:)?path$/.test(name)
      ? "filesystem.direct"
      : /(?:child_process|node:process|^process$|spawn|execFile)/.test(name)
        ? "process.spawn"
        : /(?:keytar|keychain|credential|safeStorage)/i.test(name)
          ? "credentials.read"
          : /(?:^node:(?:http|https|net|tls|dns)$|^undici$)/.test(name)
            ? "network.request"
            : "module.import";
    return deny(capability, `require(${name})`);
  }

  const state = {
    value: String(config.editorText?.value ?? ""),
    cursor: {line: 0, ch: 0},
  };

  function syncEditorDom() {
    const editorElement = document.getElementById("openobsidian-editor-probe");
    if (editorElement) editorElement.textContent = state.value;
  }

  function positionToIndex(position) {
    const lines = state.value.split("\n");
    const line = Math.max(0, Math.min(Number(position?.line ?? 0), lines.length - 1));
    const character = Math.max(0, Math.min(Number(position?.ch ?? 0), lines[line]?.length ?? 0));
    return lines.slice(0, line).reduce((total, value) => total + value.length + 1, 0) + character;
  }

  function makeEditor() {
    return {
      getValue() { return state.value; },
      setValue(value) { state.value = String(value); syncEditorDom(); },
      lineCount() { return state.value.split("\n").length; },
      lastLine() { return Math.max(0, this.lineCount() - 1); },
      getLine(line) { return state.value.split("\n")[Number(line)] ?? ""; },
      getCursor() { return {...state.cursor}; },
      setCursor(position) { state.cursor = {...position}; },
      getSelection() { return ""; },
      replaceSelection(value) { this.replaceRange(value, state.cursor, state.cursor); },
      replaceRange(value, from, to = from) {
        const start = positionToIndex(from);
        const end = positionToIndex(to);
        state.value = state.value.slice(0, start) + String(value) + state.value.slice(end);
        const prefix = state.value.slice(0, start + String(value).length).split("\n");
        state.cursor = {line: prefix.length - 1, ch: prefix[prefix.length - 1].length};
        syncEditorDom();
      },
      getRange(from, to) { return state.value.slice(positionToIndex(from), positionToIndex(to)); },
      somethingSelected() { return false; },
      transaction(callback) { if (typeof callback === "function") callback(this); },
    };
  }

  class Component {
    constructor() {
      this._children = new Set();
      this._loaded = false;
    }
    addChild(component) {
      this._children.add(component);
      if (this._loaded && typeof component?.load === "function") component.load();
      return component;
    }
    removeChild(component) {
      if (this._children.delete(component) && this._loaded && typeof component?.unload === "function") component.unload();
      return component;
    }
    register(callback) { registrations.events.push({kind: "cleanup", owner: this}); return callback; }
    registerEvent(event) { registrations.events.push({kind: "event", event, owner: this}); return event; }
    registerDomEvent(element, name, callback, options) {
      if (element?.addEventListener) element.addEventListener(name, callback, options);
      registrations.events.push({kind: "dom", name, owner: this});
    }
    registerInterval() { registrations.events.push({kind: "interval", owner: this}); return 0; }
    load() {
      if (this._loaded) return;
      this._loaded = true;
      const result = this.onload();
      for (const child of this._children) child.load?.();
      return result;
    }
    unload() {
      if (!this._loaded) return;
      this._loaded = false;
      for (const child of this._children) child.unload?.();
      this._children.clear();
      return this.onunload();
    }
    onload() {}
    onunload() {}
  }

  class Plugin extends Component {
    constructor(app, manifest) {
      super();
      this.app = app;
      this.manifest = manifest;
      this.settings = {};
      this._data = {};
    }
    addCommand(command) { registrations.commands.push({...command, owner: this}); apiCalls.push("addCommand"); return command; }
    addSettingTab(tab) { registrations.settingTabs.push({tab, owner: this}); apiCalls.push("addSettingTab"); }
    registerView(type, creator) { registrations.views.push({type, creator, owner: this}); apiCalls.push("registerView"); }
    registerEditorExtension(extension) { apiCalls.push("registerEditorExtension"); return extension; }
    registerMarkdownPostProcessor(processor) { apiCalls.push("registerMarkdownPostProcessor"); return processor; }
    registerMarkdownCodeBlockProcessor(language, processor) { apiCalls.push(`registerMarkdownCodeBlockProcessor:${language}`); return processor; }
    registerEditorSuggest(suggest) { apiCalls.push("registerEditorSuggest"); return suggest; }
    addRibbonIcon(icon, title, callback) {
      apiCalls.push("addRibbonIcon");
      const button = safeElement("button", {cls: "side-dock-ribbon-action", text: title, title, parent: root});
      button.dataset.icon = String(icon);
      if (typeof callback === "function") button.addEventListener("click", callback);
      return button;
    }
    addStatusBarItem() { apiCalls.push("addStatusBarItem"); return safeElement("span", {cls: "status-bar-item", parent: root}); }
    loadData() { return Promise.resolve(this._data); }
    saveData(value) { this._data = value; return Promise.resolve(); }
  }

  class PluginSettingTab extends Component {
    constructor(app, plugin) {
      super();
      this.app = app;
      this.plugin = plugin;
      this.containerEl = safeElement("section", {cls: "plugin-setting-tab", parent: root});
    }
    display() { this.containerEl.empty(); }
  }

  class Modal {
    constructor(app) {
      this.app = app;
      this.containerEl = safeElement("div", {cls: "modal-container"});
      this.modalEl = safeElement("div", {cls: "modal", parent: this.containerEl});
      this.titleEl = safeElement("div", {cls: "modal-title", parent: this.modalEl});
      this.contentEl = safeElement("div", {cls: "modal-content", parent: this.modalEl});
      this.scope = {};
      this.shouldRestoreSelection = true;
      this.closeCallback = null;
    }
    open() {
      if (!this.containerEl.isConnected) document.body.append(this.containerEl);
      void this.onOpen();
    }
    close() {
      this.onClose();
      this.containerEl.remove();
      if (typeof this.closeCallback === "function") this.closeCallback();
    }
    onOpen() {}
    onClose() {}
    setTitle(title) { this.titleEl.textContent = String(title); return this; }
    setContent(content) {
      this.contentEl.replaceChildren();
      if (typeof content === "string") this.contentEl.textContent = content;
      else if (content) this.contentEl.append(content);
      return this;
    }
    setCloseCallback(callback) { this.closeCallback = callback; return this; }
  }

  class ItemView extends Component {
    constructor(leaf) {
      super();
      this.leaf = leaf;
      this.app = leaf?.app;
      this.containerEl = leaf?.containerEl ?? safeElement("section", {parent: root});
      this.contentEl = safeElement("div", {cls: "view-content", parent: this.containerEl});
      this.titleEl = safeElement("div", {cls: "view-header", parent: this.containerEl});
    }
    getViewType() { return "openobsidian-probe-view"; }
    getDisplayText() { return "Plugin view"; }
    getIcon() { return "puzzle"; }
    onOpen() { return Promise.resolve(); }
    onClose() { return Promise.resolve(); }
  }

  class Setting {
    constructor(containerEl) {
      this.settingEl = safeElement("div", {cls: "setting-item", parent: containerEl});
      this.infoEl = safeElement("div", {cls: "setting-item-info", parent: this.settingEl});
      this.controlEl = safeElement("div", {cls: "setting-item-control", parent: this.settingEl});
    }
    setName(value) { this.infoEl.createDiv({cls: "setting-item-name", text: value}); return this; }
    setDesc(value) { this.infoEl.createDiv({cls: "setting-item-description", text: value}); return this; }
    setTooltip(value) { this.settingEl.title = String(value); return this; }
    addText(callback) {
      const inputEl = safeElement("input", {type: "text", parent: this.controlEl});
      return this.applyControl(callback, {inputEl, setValue(value) { inputEl.value = String(value); return this; }, getValue() { return inputEl.value; }, setPlaceholder(value) { inputEl.placeholder = String(value); return this; }, onChange(callback) { inputEl.addEventListener("change", () => callback(inputEl.value)); return this; }});
    }
    addToggle(callback) {
      const toggleEl = safeElement("input", {type: "checkbox", parent: this.controlEl});
      return this.applyControl(callback, {toggleEl, setValue(value) { toggleEl.checked = Boolean(value); return this; }, getValue() { return toggleEl.checked; }, onChange(callback) { toggleEl.addEventListener("change", () => callback(toggleEl.checked)); return this; }});
    }
    addDropdown(callback) {
      const selectEl = safeElement("select", {parent: this.controlEl});
      return this.applyControl(callback, {selectEl, addOption(value, label) { selectEl.add(new Option(String(label), String(value))); return this; }, addOptions(values) { for (const [value, label] of Object.entries(values)) this.addOption(value, label); return this; }, setValue(value) { selectEl.value = String(value); return this; }, getValue() { return selectEl.value; }, onChange(callback) { selectEl.addEventListener("change", () => callback(selectEl.value)); return this; }});
    }
    addButton(callback) {
      const buttonEl = safeElement("button", {parent: this.controlEl});
      const control = {buttonEl, setButtonText(value) { buttonEl.textContent = String(value); return this; }, setCta() { buttonEl.classList.add("mod-cta"); return this; }, setWarning() { buttonEl.classList.add("mod-warning"); return this; }, onClick(callback) { buttonEl.addEventListener("click", callback); return this; }};
      return this.applyControl(callback, control);
    }
    addExtraButton(callback) { return this.addButton(callback); }
    addSlider(callback) {
      const sliderEl = safeElement("input", {type: "range", parent: this.controlEl});
      return this.applyControl(callback, {sliderEl, setLimits(min, max, step) { sliderEl.min = String(min); sliderEl.max = String(max); sliderEl.step = String(step); return this; }, setValue(value) { sliderEl.value = String(value); return this; }, getValue() { return Number(sliderEl.value); }, onChange(callback) { sliderEl.addEventListener("input", () => callback(Number(sliderEl.value))); return this; }});
    }
    applyControl(callback, control) { if (typeof callback === "function") callback(control); return this; }
  }

  class Notice {
    constructor(message) { safeElement("div", {cls: "notice", text: message, parent: root}); }
    hide() {}
  }

  class MarkdownRenderChild extends Component {
    constructor(containerEl) { super(); this.containerEl = containerEl; }
  }

  const app = {
    vault: {
      getName() { return "Synthetic compatibility vault"; },
      getMarkdownFiles() { return []; },
      getAllLoadedFiles() { return []; },
      getAbstractFileByPath() { return null; },
      getFileByPath() { return null; },
      read() { return Promise.resolve(""); },
      cachedRead() { return Promise.resolve(""); },
      exists() { return Promise.resolve(false); },
      getConfig(key) { return key === "useMarkdownLinks" ? false : null; },
      on(name, callback) { registrations.events.push({kind: "vault", name}); return {name, callback}; },
    },
    metadataCache: {
      getFileCache() { return null; },
      getCache() { return null; },
      getFirstLinkpathDest() { return null; },
      getBacklinksForFile() { return {data: new Map()}; },
      on(name, callback) { registrations.events.push({kind: "metadata", name}); return {name, callback}; },
    },
    workspace: {
      getActiveFile() { return {path: config.editorText?.activeFile ?? "Notes/Table.md", basename: "Table", extension: "md"}; },
      getActiveViewOfType() { return {editor: makeEditor(), file: this.getActiveFile(), contentEl: root}; },
      onLayoutReady(callback) { if (typeof callback === "function") queueMicrotask(callback); },
      getLeaf() { return {app, containerEl: safeElement("section", {parent: root}), app}; },
      getLeavesOfType(type) { return registrations.views.filter((view) => view.type === type).map((view) => ({view: view.creator({app, containerEl: root})})); },
      getRightLeaf() { return this.getLeaf(); },
      getLeftLeaf() { return this.getLeaf(); },
      getMostRecentLeaf() { return this.getLeaf(); },
      on(name, callback) { registrations.events.push({kind: "workspace", name}); return {name, callback}; },
      registerHoverLinkSource() {},
      revealLeaf() { return Promise.resolve(); },
      openLinkText() { return Promise.resolve(); },
      detachLeavesOfType() {},
      iterateAllLeaves(callback) { if (typeof callback === "function") callback(this.getLeaf()); },
    },
    commands: {removeCommand() {}},
    fileManager: {generateMarkdownLink(file) { return `[[${file?.path ?? ""}]]`; }},
    plugins: {plugins: {}, enabledPlugins: new Set([config.pluginManifest.id]), manifests: {[config.pluginManifest.id]: config.pluginManifest}},
    setting: {open() {}},
    appId: "openobsidian-rust-probe",
  };

  const obsidianApi = {
    App: class App {},
    Component,
    Plugin,
    PluginSettingTab,
    Modal,
    ItemView,
    Setting,
    Notice,
    MarkdownRenderChild,
    MarkdownRenderer: {
      render(_app, markdown, element) { element.textContent = String(markdown ?? ""); return Promise.resolve(); },
      renderMarkdown(markdown, element) { element.textContent = String(markdown ?? ""); return Promise.resolve(); },
    },
    TFile: class TFile {},
    TFolder: class TFolder {},
    MarkdownView: class MarkdownView {},
    WorkspaceLeaf: class WorkspaceLeaf {},
    Platform: {isDesktop: true, isMobile: false, isMacOS: navigator.platform.includes("Mac"), isWin: navigator.platform.includes("Win"), isLinux: navigator.platform.includes("Linux"), isDesktopApp: true, isMobileApp: false},
    normalizePath(value) { return String(value).replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); },
    setIcon(element, icon) { element.dataset.icon = String(icon); },
    addIcon() {},
    parseYaml(text) { return JSON.parse(String(text)); },
    stringifyYaml(value) { return JSON.stringify(value, null, 2); },
    requestUrl() { return deny("network.request", "obsidian.requestUrl"); },
  };

  function denyNetwork(label) {
    remember(capabilityDenials, "network.request");
    return Promise.reject(new Error(`OpenObsidian denied network.request (${label})`));
  }

  function installDeniedCapabilities() {
    Object.defineProperty(globalThis, "process", {
      configurable: false,
      enumerable: false,
      value: new Proxy(Object.create(null), {
        get(_target, property) { return deny("process.spawn", `process.${String(property)}`); },
        set(_target, property) { return deny("process.spawn", `process.${String(property)}`); },
      }),
    });
    globalThis.fetch = () => denyNetwork("fetch");
    globalThis.XMLHttpRequest = class DeniedXMLHttpRequest { constructor() { deny("network.request", "XMLHttpRequest"); } };
    globalThis.WebSocket = class DeniedWebSocket { constructor() { deny("network.request", "WebSocket"); } };
    globalThis.EventSource = class DeniedEventSource { constructor() { deny("network.request", "EventSource"); } };
    try {
      Object.defineProperty(navigator, "sendBeacon", {configurable: true, value() { remember(capabilityDenials, "network.request"); return false; }});
    } catch {}
  }

  async function verifyCapabilityDenials() {
    for (const [expected, attempt] of [
      ["filesystem.direct", () => safeRequire("node:fs")],
      ["process.spawn", () => globalThis.process.cwd()],
      ["network.request", () => globalThis.fetch("https://openobsidian.invalid/")],
      ["credentials.read", () => safeRequire("keytar")],
    ]) {
      try { await attempt(); } catch {}
    }
    let nativeNetworkBlockedByCsp = false;
    if (nativeFetch) {
      let connectViolation = false;
      const observeConnectViolation = (event) => {
        if (event.effectiveDirective === "connect-src") connectViolation = true;
      };
      document.addEventListener("securitypolicyviolation", observeConnectViolation);
      try { await nativeFetch("http://127.0.0.1:9/openobsidian-denied"); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 150));
      document.removeEventListener("securitypolicyviolation", observeConnectViolation);
      nativeNetworkBlockedByCsp = connectViolation;
      if (connectViolation) remember(capabilityDenials, "network.request");
    }
    const tested = ["filesystem.direct", "process.spawn", "network.request", "credentials.read"];
    return {
      passed: tested.every((capability) => capabilityDenials.includes(capability)) && nativeNetworkBlockedByCsp,
      tested,
      scope: "direct CommonJS module and common browser request probes; not an isolation certification",
      nativeNetworkBlockedByCsp,
      cspViolations,
    };
  }

  async function runEditorCallbacks(plugin) {
    const commands = registrations.commands.filter((command) => typeof command.editorCallback === "function");
    editorWorkflow.registeredCallbacks = commands.length;
    const initialValue = String(config.editorText?.value ?? "");
    for (const command of commands.slice(0, 8)) {
      state.value = initialValue;
      state.cursor = {line: 0, ch: 0};
      syncEditorDom();
      const before = state.value;
      editorWorkflow.invokedCallbacks += 1;
      try {
        await command.editorCallback.call(command.owner ?? plugin, makeEditor(), app.workspace.getActiveViewOfType());
        editorWorkflow.completedCallbacks += 1;
        editorWorkflow.changed ||= before !== state.value;
      } catch (error) {
        editorWorkflow.errors.push(String(error?.message ?? error).slice(0, 180));
      }
    }
    editorWorkflow.finalValue = state.value;
    editorWorkflow.status = editorWorkflow.completedCallbacks > 0 ? "exercised" : "no-editor-callback-completed";
  }

  async function finish() {
    const capabilityProbe = await verifyCapabilityDenials();
    installObsidianDomExtensions();
    root.append(safeElement("pre", {id: "openobsidian-editor-probe", cls: "cm-content", text: state.value}));
    const manifest = config.pluginManifest;
    const module = {exports: {}};
    let plugin = null;
    let pluginStatus = "failed";
    let pluginError = null;
    try {
      const pluginFactory = new nativeFunction("module", "exports", "require", `"use strict";\n${bundleSource}\n//# sourceURL=openobsidian-unchanged-plugin.js`);
      pluginFactory(module, module.exports, safeRequire);
      const PluginClass = module.exports?.default ?? module.exports;
      if (typeof PluginClass !== "function") throw new Error("unchanged bundle did not export a plugin constructor");
      plugin = new PluginClass(app, manifest);
      if (typeof plugin.load === "function") await plugin.load();
      else if (typeof plugin.onload === "function") await plugin.onload();
      // Some legacy plugins start asyncOnload work without returning its promise.
      // Style Settings debounces CSS parsing for 100 ms after onload.
      const startupSettleMs = config.pluginId === "PC08" ? 150 : 50;
      await new Promise((resolve) => setTimeout(resolve, startupSettleMs));
      pluginStatus = "loaded";
      for (const {tab} of registrations.settingTabs.slice(0, 3)) {
        try { if (typeof tab?.display === "function") { await tab.display(); apiCalls.push("displaySettingTab"); } }
        catch (error) { apiCalls.push(`settingTabError:${String(error?.message ?? error).slice(0, 90)}`); }
      }
      for (const view of registrations.views.slice(0, 2)) {
        try {
          const leaf = {app, containerEl: root, titleEl: root, file: app.workspace.getActiveFile()};
          const instance = typeof view.creator === "function" ? view.creator(leaf) : null;
          if (instance && typeof instance.onOpen === "function") await instance.onOpen();
          apiCalls.push("openRegisteredView");
        } catch (error) { apiCalls.push(`viewError:${String(error?.message ?? error).slice(0, 90)}`); }
      }
      if (config.pluginId === "PC05") await runEditorCallbacks(plugin);
    } catch (error) {
      pluginError = String(error?.message ?? error).slice(0, 600);
    }

    let stylesheetRuleCount = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      try { stylesheetRuleCount += sheet.cssRules.length; } catch {}
    }
    const report = {
      status: capabilityProbe.passed && pluginStatus === "loaded" ? "passed" : "failed",
      artifact: {id: config.pluginId, manifestId: manifest.id, version: config.pluginVersion, sha256: config.artifactSha256, manifestSha256: config.manifestSha256, bytes: new TextEncoder().encode(bundleSource).byteLength},
      stylesheet: {sha256: config.stylesheetSha256, ruleCount: stylesheetRuleCount},
      themeSettingsFixture: config.themeSettingsFixture,
      runtime: {...config.runtime, userAgent: navigator.userAgent, platform: navigator.platform, language: navigator.language, legacyCompatibilityState: config.legacyCompatibilityState},
      execution: "unchanged-bundle-in-wry-webview",
      certification: "feasibility-only",
      plugin: {status: pluginStatus, error: pluginError, moduleExports: typeof module.exports},
      api: {requiredModules: attemptedModules, calls: apiCalls, commands: registrations.commands.map((command) => String(command.id ?? command.name ?? "")), settingTabs: registrations.settingTabs.length, views: registrations.views.map((view) => String(view.type ?? "")), events: registrations.events.length},
      dom: {bodyChildren: document.body.children.length, pluginRootChildren: root.children.length, settingControls: root.querySelectorAll("input,select,button").length, stylesheetCount: document.styleSheets.length, stylesheetRuleCount},
      editorWorkflow,
      capabilityProbe,
      capabilityDenials,
      policy: {csp: "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'none'; frame-ancestors 'none'", navigation: "localhost probe document only", newWindows: "denied", downloads: "denied", permissions: "denied", nodeIntegration: false, ipc: "report-channel-only"},
    };
    if (typeof ipcPostMessage === "function") ipcPostMessage(nativeJsonStringify({token: config.sessionToken, report}));
  }

  installDeniedCapabilities();
  void finish().catch((error) => {
    if (typeof ipcPostMessage === "function") {
      ipcPostMessage(nativeJsonStringify({token: config.sessionToken, report: {status: "failed", error: String(error?.message ?? error).slice(0, 600)}}));
    }
  });
})();
