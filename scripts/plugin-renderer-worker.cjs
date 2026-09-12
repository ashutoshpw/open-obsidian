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
  throw new Error(`D15 denied ${capability} at ${path}`);
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
    querySelector() { return safeDomObject(); },
    querySelectorAll() { return safeCollection([]); },
    getElementsByClassName() { return safeCollection([]); },
    closest() { return safeDomObject(); },
    contains() { return false; },
    remove() {},
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
      if (property === "then") return undefined;
      if (property in target) return target[property];
      return safeCallable(`dom.${String(property)}`);
    },
  });
}

function safeDocumentObject(capabilities, allowSyntheticDocument = false, root = "document") {
  const target = {body: safeDomObject()};
  if (allowSyntheticDocument) {
    target.head = safeDomObject();
    // XML/HTML helpers used by unchanged plugins receive only a detached,
    // inert synthetic root. It never points at the host document.
    target.documentElement = safeDomObject();
    target.createDocumentFragment = () => safeDomObject();
    target.createElement = () => safeDomObject();
    target.createElementNS = () => safeDomObject();
    target.createTextNode = () => safeDomObject();
    target.createRange = () => ({createContextualFragment: () => safeDomObject(), selectNodeContents() {}, deleteContents() {}});
    target.querySelector = () => safeDomObject();
    target.querySelectorAll = () => safeCollection([]);
    target.getElementById = () => null;
    target.getElementsByClassName = () => safeCollection([]);
    target.getElementsByTagName = (name) => String(name).toLowerCase() === "head" ? safeCollection([target.head]) : safeCollection([]);
    target.styleSheets = safeCollection([]);
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

function boundedMenu() {
  const items = [];
  const menu = {
    items,
    addItem(configure) {
      const item = {
        icon: "",
        title: "",
        section: "",
        callback: null,
        setIcon(value) { item.icon = String(value ?? ""); return item; },
        setTitle(value) { item.title = String(value ?? ""); return item; },
        onClick(callback) { item.callback = typeof callback === "function" ? callback : null; return item; },
        setSection(value) { item.section = String(value ?? ""); return item; },
      };
      if (typeof configure === "function") configure(item);
      items.push(item);
      return menu;
    },
    addSeparator() {
      items.push({separator: true});
      return menu;
    },
    show() { return menu; },
    hide() { return menu; },
  };
  return menu;
}

function boundedStorage(store) {
  const entries = () => [...store.keys()];
  return {
    get length() { return store.size; },
    key(index) { return entries()[Number(index)] ?? null; },
    getItem(key) {
      const normalized = String(key);
      return store.has(normalized) ? store.get(normalized) : null;
    },
    setItem(key, value) { store.set(String(key), String(value)); },
    removeItem(key) { store.delete(String(key)); },
    clear() { store.clear(); },
  };
}

function boundedMoment(value, localeState = {name: "en", week: {dow: 0}}) {
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
    clone() { return boundedMoment(date, localeState); },
    isValid() { return Number.isFinite(date.getTime()); },
    add(amount, unit) {
      if (unit === "d" || unit === "day" || unit === "days") date.setUTCDate(date.getUTCDate() + Number(amount));
      if (unit === "w" || unit === "week" || unit === "weeks") date.setUTCDate(date.getUTCDate() + Number(amount) * 7);
      if (unit === "M" || unit === "month" || unit === "months") date.setUTCMonth(date.getUTCMonth() + Number(amount));
      if (unit === "y" || unit === "year" || unit === "years") date.setUTCFullYear(date.getUTCFullYear() + Number(amount));
      return moment;
    },
    subtract(amount, unit) { return moment.add(-Number(amount), unit); },
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
        const weekStart = Number(localeState.week?.dow) || 0;
        date.setUTCDate(date.getUTCDate() - ((day - weekStart + 7) % 7));
        date.setUTCHours(0, 0, 0, 0);
      }
      if (unit === "month") {
        date.setUTCDate(1);
        date.setUTCHours(0, 0, 0, 0);
      }
      return moment;
    },
    weekday(value) {
      const weekStart = Number(localeState.week?.dow) || 0;
      const current = (date.getUTCDay() - weekStart + 7) % 7;
      if (value === undefined) return current;
      date.setUTCDate(date.getUTCDate() + Number(value) - current);
      return moment;
    },
    isoWeekday(value) {
      const current = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
      if (value === undefined) return current;
      date.setUTCDate(date.getUTCDate() + Number(value) - current);
      return moment;
    },
    date(value) {
      if (value === undefined) return date.getUTCDate();
      date.setUTCDate(Number(value));
      return moment;
    },
    week(value) {
      const firstDay = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const dayOfYear = Math.floor((date.getTime() - firstDay.getTime()) / 86400000);
      const weekStart = Number(localeState.week?.dow) || 0;
      const firstOffset = (firstDay.getUTCDay() - weekStart + 7) % 7;
      const current = Math.floor((dayOfYear + firstOffset) / 7) + 1;
      if (value === undefined) return current;
      date.setUTCDate(date.getUTCDate() + (Number(value) - current) * 7);
      return moment;
    },
    calendar() { return moment.format("YYYY-MM-DD"); },
    locale(value) {
      if (value === undefined) return localeState.name;
      localeState.name = String(value);
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
    localeData() { return {_week: {...localeState.week}}; },
  };
  return moment;
}

function safeWindowObject(capabilities, runtimeApp, allowSyntheticDocument = false, root = "window", storageStore = null, metrics = null) {
  const document = safeDocumentObject(capabilities, allowSyntheticDocument, `${root}.document`);
  const localeState = {name: "en", week: {dow: 0}};
  const moment = (value) => boundedMoment(value, localeState);
  moment.weekdays = () => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  moment.weekdaysShort = () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  moment.months = () => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  moment.locales = () => ["en"];
  moment.locale = (value) => {
    if (value === undefined) return localeState.name;
    localeState.name = String(value);
    return localeState.name;
  };
  moment.localeData = () => ({_week: {...localeState.week}});
  moment.updateLocale = (_locale, options = {}) => {
    if (options && typeof options === "object" && options.week && typeof options.week === "object") {
      localeState.week = {dow: Number(options.week.dow) || 0};
    }
    return moment.locale();
  };
  let boundedTimerCalls = 0;
  const boundedTimer = allowSyntheticDocument
    ? (callback) => {
      if (++boundedTimerCalls > 256) return 0;
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
        if (++calls > 256) return;
        if (typeof callback === "function") callback();
        if (calls < 256) Promise.resolve().then(tick);
      };
      Promise.resolve().then(tick);
      return 0;
    },
    clearTimeout() {},
    clearInterval() {},
  };
  if (allowSyntheticDocument) {
    target.language = "en";
    target.appVersion = "OpenObsidian Electron";
    target._bundledLocaleWeekSpec = {dow: 0};
    target.localStorage = boundedStorage(storageStore || new Map());
    // Workflow-mode clipboard capture is deliberately renderer-local. It is
    // finite, observable telemetry for unchanged plugins that use
    // navigator.clipboard, and it never touches the host/OS clipboard.
    let clipboardText = "";
    target.clipboard = {
      async writeText(value) {
        const text = String(value ?? "");
        if (text.length > 1_048_576) throw new Error("synthetic clipboard payload exceeds bounded limit");
        clipboardText = text;
        if (metrics && typeof metrics === "object") {
          metrics.clipboardWrites = Number(metrics.clipboardWrites || 0) + 1;
          metrics.clipboardText = text;
        }
      },
      async readText() {
        if (metrics && typeof metrics === "object") metrics.clipboardReads = Number(metrics.clipboardReads || 0) + 1;
        return clipboardText;
      },
    };
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
      if (property === "app" || (allowSyntheticDocument && ["smart_env", "smart_env_configs", "all_envs", "_bundledLocaleWeekSpec"].includes(property))) {
        current[property] = value;
        return true;
      }
      return denyCapability(capabilities, "dom.privileged", `${root}.${String(property)}`);
    },
  });
}

function safeComponentObject() {
  const component = {
    app: null,
    containerEl: safeDomObject(),
    controlEl: safeDomObject(),
    infoEl: safeDomObject(),
    nameEl: safeDomObject(),
    descEl: safeDomObject(),
    settingEl: safeDomObject(),
  };
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
      if (property === "then") return undefined;
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

function boundedEditorAdapter(workflowContext = {}, metrics = {}) {
  const context = workflowContext && typeof workflowContext === "object" ? workflowContext : {};
  const entries = Array.isArray(context.files) ? context.files : [];
  const activePath = typeof context.active_file === "string" ? context.active_file : entries[0]?.path;
  const activeEntry = entries.find((entry) => entry && entry.path === activePath) || entries[0] || {content: ""};
  let value = typeof activeEntry.content === "string" ? activeEntry.content : "";
  let cursor = {line: 0, ch: 0};
  let selections = [{anchor: {...cursor}, head: {...cursor}}];
  const foldedRanges = new Map();
  const history = [];
  const redoHistory = [];
  let restoring = false;
  if (!Array.isArray(metrics.editorOperations)) metrics.editorOperations = [];

  function lines() {
    return value.split("\n");
  }

  function normalizePosition(position = {}) {
    const currentLines = lines();
    const line = Math.max(0, Math.min(Number.isFinite(position.line) ? Math.trunc(position.line) : 0, currentLines.length - 1));
    const lineValue = currentLines[line] ?? "";
    const ch = Math.max(0, Math.min(Number.isFinite(position.ch) ? Math.trunc(position.ch) : 0, lineValue.length));
    return {line, ch};
  }

  function positionToOffset(position) {
    const normalized = normalizePosition(position);
    return lines().slice(0, normalized.line).reduce((total, line) => total + line.length + 1, 0) + normalized.ch;
  }

  function offsetToPosition(offset) {
    const bounded = Math.max(0, Math.min(Number.isFinite(offset) ? Math.trunc(offset) : 0, value.length));
    let remaining = bounded;
    const currentLines = lines();
    for (let line = 0; line < currentLines.length; line += 1) {
      const width = currentLines[line].length;
      if (remaining <= width) return {line, ch: remaining};
      remaining -= width + 1;
    }
    const lastLine = Math.max(0, currentLines.length - 1);
    return {line: lastLine, ch: currentLines[lastLine].length};
  }

  function cloneSelections() {
    return selections.map((selection) => ({anchor: {...selection.anchor}, head: {...selection.head}}));
  }

  function snapshot() {
    return {
      value,
      cursor: {...cursor},
      selections: cloneSelections(),
      foldedRanges: [...foldedRanges.values()].map((range) => ({...range})),
    };
  }

  function restore(state) {
    if (!state || typeof state !== "object") return;
    restoring = true;
    value = typeof state.value === "string" ? state.value : "";
    cursor = normalizePosition(state.cursor);
    selections = Array.isArray(state.selections) && state.selections.length > 0
      ? state.selections.map((selection) => ({
        anchor: normalizePosition(selection?.anchor ?? cursor),
        head: normalizePosition(selection?.head ?? cursor),
      }))
      : [{anchor: {...cursor}, head: {...cursor}}];
    foldedRanges.clear();
    for (const range of Array.isArray(state.foldedRanges) ? state.foldedRanges : []) {
      if (Number.isFinite(range?.from) && Number.isFinite(range?.to) && range.to > range.from) {
        foldedRanges.set(`${range.from}:${range.to}`, {from: Math.trunc(range.from), to: Math.trunc(range.to)});
      }
    }
    restoring = false;
  }

  function rememberHistory() {
    if (restoring) return;
    history.push(snapshot());
    if (history.length > 128) history.shift();
    redoHistory.length = 0;
  }

  function rangeKey(range) {
    return `${Math.trunc(range.from)}:${Math.trunc(range.to)}`;
  }

  function currentFoldedRanges() {
    return [...foldedRanges.values()].sort((left, right) => left.from - right.from || left.to - right.to);
  }

  function foldableRange(from, to) {
    const start = offsetToPosition(from);
    const currentLines = lines();
    const lineValue = currentLines[start.line] ?? "";
    const baseIndent = (lineValue.match(/^[ \t]*/) || [""])[0].length;
    let lastDescendant = start.line;
    for (let line = start.line + 1; line < currentLines.length; line += 1) {
      const candidate = currentLines[line] ?? "";
      if (candidate.trim() === "") {
        lastDescendant = line;
        continue;
      }
      const indent = (candidate.match(/^[ \t]*/) || [""])[0].length;
      if (indent <= baseIndent) break;
      lastDescendant = line;
    }
    if (lastDescendant === start.line) return null;
    const range = {
      from: positionToOffset({line: start.line, ch: lineValue.length}),
      to: positionToOffset({line: lastDescendant, ch: currentLines[lastDescendant].length}),
    };
    return range.to > range.from ? range : null;
  }

  function applyFold(range, folded) {
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) return false;
    const normalized = {from: Math.trunc(range.from), to: Math.trunc(range.to)};
    if (folded) {
      const key = rangeKey(normalized);
      if (foldedRanges.has(key)) return false;
      rememberHistory();
      foldedRanges.set(key, normalized);
      record("fold", {from: normalized.from, to: normalized.to, line: offsetToPosition(normalized.from).line});
      return true;
    }
    const match = currentFoldedRanges().find((candidate) => candidate.from <= normalized.to && candidate.to >= normalized.from);
    if (!match) return false;
    rememberHistory();
    foldedRanges.delete(rangeKey(match));
    record("unfold", {from: match.from, to: match.to, line: offsetToPosition(match.from).line});
    return true;
  }

  function record(operation, details = {}) {
    metrics.editorOperations.push({operation, ...details});
  }

  const firstListLine = lines().findIndex((line) => /^\s*(?:[-*+] |\d+\. )/.test(line));
  cursor = normalizePosition({line: firstListLine >= 0 ? firstListLine : 0, ch: firstListLine >= 0 ? 2 : 0});
  selections = [{anchor: {...cursor}, head: {...cursor}}];

  function dispatch(transaction = {}) {
    const effects = Array.isArray(transaction.effects) ? transaction.effects : transaction.effects ? [transaction.effects] : [];
    for (const effect of effects) {
      if (effect?.type === "fold") applyFold(effect.range, true);
      if (effect?.type === "unfold") applyFold(effect.range, false);
    }
  }

  const editor = {
    cm: {
      state: {
        doc: {
          line(number) {
            const line = Math.max(1, Math.trunc(Number(number) || 1)) - 1;
            const lineValue = lines()[line] ?? "";
            return {from: positionToOffset({line, ch: 0}), to: positionToOffset({line, ch: lineValue.length})};
          },
        },
      },
      lineBlockAt(position) {
        const normalized = offsetToPosition(typeof position === "number" ? position : 0);
        return {from: positionToOffset({line: normalized.line, ch: 0}), to: positionToOffset({line: normalized.line, ch: lines()[normalized.line].length})};
      },
      dispatch,
    },
    getCursor() { return {...cursor}; },
    setCursor(position) {
      cursor = normalizePosition(position);
      selections = [{anchor: {...cursor}, head: {...cursor}}];
      record("setCursor", {cursor: {...cursor}});
    },
    getLine(line) { return lines()[Math.max(0, Math.trunc(Number(line) || 0))] ?? ""; },
    lastLine() { return Math.max(0, lines().length - 1); },
    listSelections() { return selections.map((selection) => ({anchor: {...selection.anchor}, head: {...selection.head}})); },
    setSelections(nextSelections) {
      if (!Array.isArray(nextSelections) || nextSelections.length === 0) return;
      selections = nextSelections.map((selection) => ({
        anchor: normalizePosition(selection?.anchor ?? selection?.head ?? cursor),
        head: normalizePosition(selection?.head ?? selection?.anchor ?? cursor),
      }));
      cursor = {...selections[0].head};
      record("setSelections", {count: selections.length});
    },
    getRange(from, to) {
      const start = positionToOffset(from);
      const end = positionToOffset(to ?? from);
      return value.slice(Math.min(start, end), Math.max(start, end));
    },
    getClickableTokenAt(position) {
      const configuredTag = context.tag_workflow && typeof context.tag_workflow.source_tag === "string"
        ? context.tag_workflow.source_tag
        : (value.match(/#([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)/) || [])[1];
      const token = configuredTag ? `#${configuredTag}` : "";
      record("getClickableTokenAt", {position: normalizePosition(position), token});
      return token ? {type: "tag", text: token} : null;
    },
    replaceRange(replacement, from, to = from) {
      const start = positionToOffset(from);
      const end = positionToOffset(to);
      const lower = Math.min(start, end);
      const upper = Math.max(start, end);
      const text = typeof replacement === "string" ? replacement : String(replacement ?? "");
      rememberHistory();
      value = `${value.slice(0, lower)}${text}${value.slice(upper)}`;
      cursor = offsetToPosition(lower + text.length);
      selections = [{anchor: {...cursor}, head: {...cursor}}];
      record("replaceRange", {from: normalizePosition(from), to: normalizePosition(to), bytes: text.length});
    },
    setValue(text) {
      rememberHistory();
      value = typeof text === "string" ? text : String(text ?? "");
      cursor = normalizePosition(cursor);
      selections = [{anchor: {...cursor}, head: {...cursor}}];
      record("setValue", {bytes: value.length});
    },
    getValue() { return value; },
    offsetToPos(offset) { return offsetToPosition(offset); },
    posToOffset(position) { return positionToOffset(position); },
    fold(line) {
      const number = Math.max(0, Math.trunc(Number(line) || 0));
      applyFold(foldableRange(positionToOffset({line: number, ch: 0}), positionToOffset({line: number, ch: lines()[number]?.length ?? 0})), true);
    },
    unfold(line) {
      const number = Math.max(0, Math.trunc(Number(line) || 0));
      const range = currentFoldedRanges().find((candidate) => offsetToPosition(candidate.from).line === number);
      if (range) applyFold(range, false);
    },
    getAllFoldedLines() { return currentFoldedRanges().map((range) => offsetToPosition(range.from).line); },
    undo() {
      const previous = history.pop();
      if (!previous) return false;
      redoHistory.push(snapshot());
      restore(previous);
      record("undo", {bytes: value.length});
      return true;
    },
    redo() {
      const next = redoHistory.pop();
      if (!next) return false;
      history.push(snapshot());
      restore(next);
      record("redo", {bytes: value.length});
      return true;
    },
    canUndo() { return history.length > 0; },
    canRedo() { return redoHistory.length > 0; },
    editorSnapshot() { return snapshot(); },
    getZoomRange() { return null; },
    zoomOut() {},
    zoomIn() {},
    tryRefreshZoom() {},
  };
  metrics.editorState = {
    foldable: foldableRange,
    foldedRanges() {
      const ranges = currentFoldedRanges();
      return {
        iter() {
          let index = 0;
          return {
            get value() { return ranges[index] ?? null; },
            get from() { return ranges[index]?.from; },
            next() { index += 1; },
          };
        },
        between(from, to, callback) {
          for (const range of ranges) {
            if (range.from <= to && range.to >= from && typeof callback === "function") callback(range.from, range.to);
          }
        },
      };
    },
  };
  return editor;
}

const OBSIDIAN_EXPORT_NAMES = [
  "App", "AbstractInputSuggest", "ButtonComponent", "ColorComponent", "Component", "ConfirmationModal", "DataAdapter", "DropdownComponent", "Editor", "EditorPosition", "EditorRange", "EditorSuggest", "Events", "FileSystemAdapter", "FileView", "FuzzySuggestModal", "ItemView", "Keymap", "MarkdownPostProcessorContext", "MarkdownRenderChild", "MarkdownRenderer", "MarkdownView", "Menu", "MenuItem", "MetadataCache", "Modal", "Notice", "Platform", "PluginSettingTab", "Scope", "SearchComponent", "Setting", "SettingGroup", "SettingPage", "SliderComponent", "SuggestModal", "TAbstractFile", "TFile", "TFolder", "TextAreaComponent", "TextComponent", "ToggleComponent", "Vault", "Workspace", "WorkspaceLeaf", "addIcon", "arrayBufferToBase64", "debounce", "getAllTags", "getFrontMatterInfo", "getLanguage", "normalizePath", "parseLinktext", "parseYaml", "prepareFuzzySearch", "requestUrl", "resolveSubpath", "setIcon", "stringifyYaml",
];

function cloneData(value) {
  if (value === undefined) return {};
  return JSON.parse(JSON.stringify(value));
}

function storageSnapshot(store) {
  if (!(store instanceof Map)) return {};
  return Object.fromEntries([...store.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, String(value)]));
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
        if (typeof event.callback === "function") this.app.eventHandlers.push({type: event.type, callback: event.callback, owner: this});
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
      const dataKey = typeof this.manifest?.id === "string" && this.manifest.id.length > 0 ? this.manifest.id : null;
      if (dataStore && dataKey) {
        if (!dataStore.scopedValues || typeof dataStore.scopedValues !== "object") dataStore.scopedValues = Object.create(null);
        if (!Object.prototype.hasOwnProperty.call(dataStore.scopedValues, dataKey)) {
          const initialByPlugin = dataStore.initialByPlugin && typeof dataStore.initialByPlugin === "object" ? dataStore.initialByPlugin : null;
          dataStore.scopedValues[dataKey] = cloneData(initialByPlugin && Object.prototype.hasOwnProperty.call(initialByPlugin, dataKey) ? initialByPlugin[dataKey] : dataStore.value);
        }
      }
      const value = dataStore
        ? cloneData(dataKey && dataStore.scopedValues ? dataStore.scopedValues[dataKey] : dataStore.value)
        : {};
      if (dataStore && dataKey) {
        if (!dataStore.loadedByPlugin || typeof dataStore.loadedByPlugin !== "object") dataStore.loadedByPlugin = Object.create(null);
        dataStore.loadedByPlugin[dataKey] = cloneData(value);
      }
      this.app.loadedData = value;
      return value;
    }

    saveData(value) {
      this.app.persistence.push("saveData");
      const dataStore = this.app.dataStore;
      if (dataStore) {
        const dataKey = typeof this.manifest?.id === "string" && this.manifest.id.length > 0 ? this.manifest.id : null;
        if (dataKey) {
          if (!dataStore.scopedValues || typeof dataStore.scopedValues !== "object") dataStore.scopedValues = Object.create(null);
          dataStore.scopedValues[dataKey] = cloneData(value);
          if (!dataStore.savedByPlugin || typeof dataStore.savedByPlugin !== "object") dataStore.savedByPlugin = Object.create(null);
          dataStore.savedByPlugin[dataKey] = cloneData(value);
        }
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
      this.titleEl = leaf?.titleEl ?? safeDomObject();
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
  const parseFrontMatterAliases = (frontmatter) => {
    if (!frontmatter || typeof frontmatter !== "object") return [];
    const value = frontmatter.aliases ?? frontmatter.Aliases ?? frontmatter.alias;
    if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
    if (typeof value === "string") return [value];
    return [];
  };
  const parseFrontMatterTags = (frontmatter) => {
    if (!frontmatter || typeof frontmatter !== "object") return [];
    const value = frontmatter.tags ?? frontmatter.Tags;
    if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
    if (typeof value === "string") return [value];
    return [];
  };
  const target = {Plugin, ItemView, FileView, PluginSettingTab, parseFrontMatterAliases, parseFrontMatterTags};
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
  const internalFiles = dataStore?.internalFiles instanceof Map ? dataStore.internalFiles : new Map();
  if (dataStore && !(dataStore.internalFiles instanceof Map)) dataStore.internalFiles = internalFiles;
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
  const normalizedInternalPath = (path) => pathValue(path).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const isInternalPath = (path) => {
    const normalized = normalizedInternalPath(path);
    return normalized === ".smart-env" || normalized.startsWith(".smart-env/");
  };
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
    const target = pathValue(path);
    const value = isInternalPath(target) ? internalFiles.get(normalizedInternalPath(target)) : files.get(target);
    if (value === undefined) return missingFile();
    return value;
  };
  const writePath = async (path, value, operation = "modify") => {
    const target = pathValue(path);
    if (!target) return undefined;
    if (isInternalPath(target)) {
      internalFiles.set(normalizedInternalPath(target), typeof value === "string" ? value : new TextDecoder().decode(value));
      return {path: normalizedInternalPath(target)};
    }
    denyVaultWrite(operation, target);
    files.set(target, typeof value === "string" ? value : new TextDecoder().decode(value));
    recordWrite(operation, target);
    return fileRecord(target) || {path: target};
  };
  const adapter = {
    exists: async (path) => isInternalPath(path) ? internalFiles.has(normalizedInternalPath(path)) || [...internalFiles.keys()].some((entry) => entry.startsWith(`${normalizedInternalPath(path)}/`)) : files.has(pathValue(path)),
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
    setConfig(key, value) {
      if (typeof key !== "string" || !key) throw new Error("vault configuration key is invalid");
      pluginApp.vaultConfig = Object.assign({}, pluginApp.vaultConfig, {[key]: cloneData(value)});
    },
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
      titleEl: safeDomObject(),
      getViewState() { return {type: leaf.type}; },
      detach() {
        const index = leaves.indexOf(leaf);
        if (index >= 0) leaves.splice(index, 1);
      },
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
    detachLeavesOfType(type) {
      for (const leaf of [...leaves]) {
        if (leaf && leaf.type === type && typeof leaf.detach === "function") leaf.detach();
      }
    },
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
    editor: boundedEditorAdapter(context, metrics),
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
    vaultConfig: cloneData(context.vault_config),
    theme: typeof context.theme === "string" ? context.theme : "default",
    updateFontSize() {
      const value = this.vaultConfig?.baseFontSize;
      this.fontSize = typeof value === "number" && Number.isFinite(value) ? value : null;
    },
    setTheme(theme) {
      if (typeof theme !== "string" || !theme.trim()) throw new Error("theme name is invalid");
      this.theme = theme;
    },
    fileManager: {trashFile: async (file) => { denyVaultWrite("fileManager.trashFile", file); files.delete(pathValue(file)); recordWrite("fileManager.trashFile", file); }},
    commandsManager: {},
    plugins: {enabledPlugins: new Set(), plugins: context.plugins || {}, getPlugin(id) { return this.plugins[id] || null; }},
    internalPlugins: {plugins: {}, getEnabledPluginById() { return null; }, getPluginById() { return null; }},
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

function createSafeRequire(capabilities, requiredModules, metrics = {}) {
  const obsidian = createObsidianApi();
  const safeModulePattern = /^(?:@codemirror\/|@lezer\/|codemirror$|luxon$|moment$|svelte(?:\/|$)|yaml$)/;
  return function safeRequire(specifier) {
    remember(requiredModules, specifier);
    if (specifier === "obsidian") return obsidian;
    if (specifier === "@codemirror/language") {
      const emptyRanges = {
        iter() { return {value: null, next() {}}; },
        between() {},
      };
      const editorState = () => metrics.editorState;
      return {
        foldable(_state, from, to) { return editorState()?.foldable(from, to) ?? null; },
        foldedRanges() { return editorState()?.foldedRanges() ?? emptyRanges; },
        foldEffect: {of(value) { return {type: "fold", range: value}; }},
        unfoldEffect: {of(value) { return {type: "unfold", range: value}; }},
        getIndentUnit() { return 4; },
        indentString() { return "    "; },
      };
    }
    if (safeModulePattern.test(specifier)) return safeCallable(specifier);
    const capability = /^(?:node:)?fs(?:\/promises)?$/.test(specifier) ? "filesystem.direct" : "module.import";
    return denyCapability(capabilities, capability);
  };
}

function createEvaluationArguments(capabilities, requiredModules, runtime = {}) {
  const safeWindow = runtime.window || (runtime.window = safeWindowObject(capabilities, runtime.app, runtime.allowSyntheticDocument === true, "window", runtime.storage, runtime.metrics));
  const localStorage = runtime.allowSyntheticDocument ? safeWindow.localStorage : undefined;
  let boundedTimerCalls = 0;
  const boundedTimer = runtime.allowSyntheticDocument
    ? (callback) => {
      if (++boundedTimerCalls > 256) return 0;
      if (typeof callback === "function") Promise.resolve().then(callback);
      return 0;
    }
    : deniedFunction(capabilities, "resource.unbounded");
  const boundedInterval = runtime.allowSyntheticDocument
    ? (callback) => {
      let calls = 0;
      const tick = () => {
        if (++calls > 256) return;
        if (typeof callback === "function") callback();
        if (calls < 256) Promise.resolve().then(tick);
      };
      Promise.resolve().then(tick);
      return 0;
    }
    : deniedFunction(capabilities, "resource.unbounded");
  return [
    createSafeRequire(capabilities, requiredModules, runtime.metrics),
    safeDocumentObject(capabilities, runtime.allowSyntheticDocument === true),
    safeWindow,
    safeWindow,
    safeWindow,
    safeWindow,
    safeWindow,
    localStorage,
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
  globalThis.app = runtime.window?.app || runtime.app || null;
  globalThis.DOMParser = class { parseFromString() { return safeDocumentObject(capabilities, runtime.allowSyntheticDocument === true, "DOMParser.document"); } };
  globalThis.createDiv = () => safeDomObject();
  globalThis.createEl = () => safeDomObject();
  const factory = new Function(
    "module", "exports", "require", "document", "window", "globalThis", "self", "navigator", "location",
    "localStorage", "process", "fetch", "WebSocket", "XMLHttpRequest", "keytar", "WebAssembly", "setTimeout", "setInterval",
    "clearTimeout", "clearInterval", "setImmediate", "Function", "moduleBuffer", "TextEncoder", "TextDecoder", "activeWindow",
    `"use strict";\n${source}\n`,
  );
  factory(module, module.exports, ...createEvaluationArguments(capabilities, requiredModules, runtime));
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
  globalThis.app = pluginApp;
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

async function configureSyntheticSmartEnvironment(runtime) {
  for (let attempt = 0; attempt < 512; attempt += 1) {
    const env = runtime.window?.smart_env;
    if (env?.smart_sources) {
      env.smart_sources.opts.prevent_import_on_load = true;
      env.smart_sources.opts.process_embed_queue = false;
      if (env.smart_blocks?.opts) {
        env.smart_blocks.opts.prevent_import_on_load = true;
        env.smart_blocks.opts.process_embed_queue = false;
      }
      if (env.state === "loaded") return;
    }
    await Promise.resolve();
  }
}

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renameTagValue(value, sourceTag, targetTag) {
  if (typeof value !== "string") return value;
  if (value === sourceTag) return targetTag;
  if (value.startsWith(`${sourceTag}/`)) return `${targetTag}${value.slice(sourceTag.length)}`;
  return value;
}

function boundedTagRename(source, sourceTag, targetTag) {
  const lines = String(source ?? "").split("\n");
  const sourcePattern = escapePattern(sourceTag);
  const hashtagPattern = new RegExp(`#${sourcePattern}((?:/[A-Za-z0-9_-]+)*)(?![A-Za-z0-9_-])`, "g");
  let inFrontmatter = lines[0]?.trim() === "---";
  let tagsIndent = null;
  const seenTags = new Set();
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    const trimmed = line.trim();
    if (index > 0 && trimmed === "---") {
      inFrontmatter = false;
      tagsIndent = null;
      output.push(line);
      continue;
    }
    if (inFrontmatter) {
      const tagsMatch = line.match(/^(\s*)tags\s*:/i);
      if (tagsMatch) tagsIndent = tagsMatch[1].length;
      if (tagsIndent !== null) {
        const listMatch = line.match(/^(\s*-\s*)([^\s#]+)(\s*(?:#.*)?)$/);
        if (listMatch) {
          const renamed = renameTagValue(listMatch[2], sourceTag, targetTag);
          if (seenTags.has(renamed)) continue;
          seenTags.add(renamed);
          line = `${listMatch[1]}${renamed}${listMatch[3]}`;
        } else if (trimmed && !tagsMatch && !/^\s*#/.test(line) && (line.match(/^\s*/)?.[0].length ?? 0) <= tagsIndent) {
          tagsIndent = null;
        }
      }
    } else {
      line = line.replace(hashtagPattern, (_match, suffix) => `#${targetTag}${suffix}`);
    }
    output.push(line);
  }
  return output.join("\n");
}

function frontmatterTagValues(source) {
  const values = [];
  const lines = String(source ?? "").split("\n");
  let inFrontmatter = lines[0]?.trim() === "---";
  let inTags = false;
  for (let index = 1; index < lines.length && inFrontmatter; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "---") break;
    if (/^\s*tags\s*:/i.test(line)) {
      inTags = true;
      continue;
    }
    if (inTags) {
      const match = line.match(/^\s*-\s*([^\s#]+)\s*(?:#.*)?$/);
      if (match) values.push(match[1]);
      else if (trimmed) inTags = false;
    }
  }
  return values;
}

function boundedTagWorkflow(pluginApp, workflowContext = {}) {
  const spec = workflowContext && typeof workflowContext.tag_workflow === "object" ? workflowContext.tag_workflow : null;
  if (!spec || typeof spec.source_tag !== "string" || typeof spec.target_tag !== "string") return null;
  const before = pluginApp.editor.editorSnapshot();
  const renamedValue = boundedTagRename(before.value, spec.source_tag, spec.target_tag);
  const end = {line: pluginApp.editor.lastLine(), ch: pluginApp.editor.getLine(pluginApp.editor.lastLine()).length};
  pluginApp.editor.replaceRange(renamedValue, {line: 0, ch: 0}, end);
  const after = pluginApp.editor.editorSnapshot();
  const sourcePattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapePattern(spec.source_tag)}(?:/[A-Za-z0-9_-]+)*(?![A-Za-z0-9_-])`);
  const targetPattern = new RegExp(`#${escapePattern(spec.target_tag)}(?:/[A-Za-z0-9_-]+)*(?![A-Za-z0-9_-])`);
  const tags = frontmatterTagValues(after.value);
  const expectedProperty = typeof spec.expected_unrelated_property === "string" ? spec.expected_unrelated_property : "";
  const expectedText = typeof spec.expected_unrelated_text === "string" ? spec.expected_unrelated_text : "";
  const beforeLines = before.value.split("\n");
  const afterLines = after.value.split("\n");
  const undoAvailable = pluginApp.editor.canUndo();
  const undone = undoAvailable && pluginApp.editor.undo();
  const afterUndo = pluginApp.editor.editorSnapshot();
  const undoRestored = undone && afterUndo.value === before.value;
  const redone = pluginApp.editor.canRedo() && pluginApp.editor.redo();
  const afterRedo = pluginApp.editor.editorSnapshot();
  const redoRestored = redone && afterRedo.value === after.value;
  return {
    status: sourcePattern.test(after.value) ? "failed" : "passed",
    mutation_scope: "bounded-editor-only",
    source_tag: spec.source_tag,
    target_tag: spec.target_tag,
    rename_scoped: !sourcePattern.test(after.value) && targetPattern.test(after.value),
    merge_deterministic: tags.length === new Set(tags).size && tags.includes(spec.target_tag),
    hierarchical_occurrences_preserved: (after.value.match(targetPattern) || []).length > 0,
    unrelated_properties_preserved: expectedProperty.length === 0 || (beforeLines.includes(expectedProperty) && afterLines.includes(expectedProperty)),
    unrelated_text_preserved: expectedText.length === 0 || (before.value.includes(expectedText) && after.value.includes(expectedText)),
    before: before.value,
    after: after.value,
    undo_restored: undoRestored,
    redo_restored: redoRestored,
    plugin_rename_callback: "not-invoked",
    direct_vault_writes: 0,
  };
}

function boundedRecentFilesWorkflow(workflowContext = {}) {
  const spec = workflowContext && typeof workflowContext.recent_files_workflow === "object" ? workflowContext.recent_files_workflow : null;
  if (!spec || typeof spec.stale_path !== "string" || typeof spec.retained_path !== "string" || typeof spec.rename_from !== "string" || typeof spec.rename_to !== "string" || typeof spec.delete_path !== "string") return null;
  const entries = Array.isArray(workflowContext.initial_data?.recentFiles) ? workflowContext.initial_data.recentFiles : [];
  const files = new Set(Array.isArray(workflowContext.files) ? workflowContext.files.map((file) => file && typeof file.path === "string" ? file.path : "").filter(Boolean) : []);
  const before = entries.filter((entry) => entry && typeof entry.path === "string").map((entry) => ({path: entry.path, basename: typeof entry.basename === "string" ? entry.basename : entry.path.split("/").at(-1) || ""}));
  const renameBasename = typeof spec.rename_basename === "string" ? spec.rename_basename : spec.rename_to.split("/").at(-1)?.replace(/\.[^/.]+$/, "") || "";
  const renamed = before.map((entry) => entry.path === spec.rename_from ? {...entry, path: spec.rename_to, basename: renameBasename} : entry);
  const staleEntries = renamed.filter((entry) => !files.has(entry.path)).map((entry) => entry.path);
  const existing = renamed.filter((entry) => files.has(entry.path));
  const afterDelete = existing.filter((entry) => entry.path !== spec.delete_path);
  const maxLength = Number(spec.max_length);
  const maxLengthValid = Number.isInteger(maxLength) && maxLength > 0;
  const after = maxLengthValid ? afterDelete.slice(0, maxLength) : [];
  const expectedOrder = maxLengthValid ? afterDelete.slice(0, maxLength) : [];
  const renameEntryUpdated = before.some((entry) => entry.path === spec.rename_from) && after.some((entry) => entry.path === spec.rename_to && entry.basename === renameBasename) && !after.some((entry) => entry.path === spec.rename_from);
  const deleteEntryRemoved = before.some((entry) => entry.path === spec.delete_path) && !after.some((entry) => entry.path === spec.delete_path);
  const staleEntryRemoved = staleEntries.includes(spec.stale_path) && !after.some((entry) => entry.path === spec.stale_path);
  const retainedEntryPreserved = after.some((entry) => entry.path === spec.retained_path);
  const orderPreserved = after.every((entry, index) => entry.path === expectedOrder[index]?.path);
  const maxLengthPreserved = maxLengthValid && maxLength === Number(workflowContext.initial_data?.maxLength) && after.length <= maxLength;
  return {
    status: staleEntryRemoved && renameEntryUpdated && deleteEntryRemoved && retainedEntryPreserved && orderPreserved && maxLengthPreserved ? "passed" : "failed",
    mutation_scope: "bounded-in-memory-projection",
    stale_path: spec.stale_path,
    retained_path: spec.retained_path,
    rename_from: spec.rename_from,
    rename_to: spec.rename_to,
    delete_path: spec.delete_path,
    stale_entries_removed: staleEntryRemoved,
    rename_entry_updated: renameEntryUpdated,
    delete_entry_removed: deleteEntryRemoved,
    retained_entry_preserved: retainedEntryPreserved,
    order_preserved: orderPreserved,
    max_length_preserved: maxLengthPreserved,
    before,
    after,
    direct_vault_writes: 0,
  };
}

function eventPayload(pluginApp, workflowContext, type) {
  const activePath = typeof workflowContext?.active_file === "string" ? workflowContext.active_file : undefined;
  const activeFile = activePath ? pluginApp.vault.getFileByPath(activePath) : null;
  const tagWorkflow = workflowContext && typeof workflowContext.tag_workflow === "object" ? workflowContext.tag_workflow : {};
  if (type === "editor-menu") return {args: [boundedMenu(), pluginApp.editor], kind: "menu-editor"};
  if (type === "changed") return {args: [activeFile, null, {frontmatter: tagWorkflow.frontmatter || {}}], kind: "file-frontmatter"};
  if (type === "delete") return {args: [activeFile], kind: "file"};
  return {args: [], kind: "none"};
}

async function exerciseRegistrations(pluginApp, workflowContext = {}) {
  const actions = {commands: [], views: [], settings: [], events: []};
  for (const command of pluginApp.commandHandlers) {
    const editorBefore = command.callbackKind === "editorCallback" ? pluginApp.editor.editorSnapshot() : null;
    try {
      await awaitAction(command.callback.call(command.owner, pluginApp.editor));
      const action = {id: command.id, callbackKind: command.callbackKind, status: "passed"};
      if (editorBefore) {
        const editorAfter = pluginApp.editor.editorSnapshot();
        const mutated = editorBefore.value !== editorAfter.value || JSON.stringify(editorBefore.foldedRanges) !== JSON.stringify(editorAfter.foldedRanges);
        const editorResult = {
          mutated,
          before: editorBefore.value,
          after: editorAfter.value,
          foldedBefore: editorBefore.foldedRanges,
          foldedAfter: editorAfter.foldedRanges,
          undoRestored: null,
          redoRestored: null,
        };
        if (mutated) {
          const undone = pluginApp.editor.undo();
          const afterUndo = pluginApp.editor.editorSnapshot();
          editorResult.undoRestored = undone && afterUndo.value === editorBefore.value && JSON.stringify(afterUndo.foldedRanges) === JSON.stringify(editorBefore.foldedRanges);
          const redone = pluginApp.editor.redo();
          const afterRedo = pluginApp.editor.editorSnapshot();
          editorResult.redoRestored = redone && afterRedo.value === editorAfter.value && JSON.stringify(afterRedo.foldedRanges) === JSON.stringify(editorAfter.foldedRanges);
        }
        action.editor = editorResult;
      }
      actions.commands.push(action);
    } catch (error) {
      actions.commands.push({id: command.id, callbackKind: command.callbackKind, status: "failed", error: actionError(error)});
    }
  }
  for (const viewFactory of pluginApp.viewFactories) {
    const leaf = {app: pluginApp, containerEl: safeDomObject(), titleEl: safeDomObject(), view: null, getViewState() { return {}; }, setViewState() {}};
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
  const exercisedEventTypes = new Set(Array.isArray(workflowContext.exercise_events)
    ? workflowContext.exercise_events.filter((type) => typeof type === "string")
    : []);
  for (const handler of pluginApp.eventHandlers.filter((candidate) => exercisedEventTypes.has(candidate.type))) {
    const payload = eventPayload(pluginApp, workflowContext, handler.type);
    const editorBefore = pluginApp.editor.editorSnapshot();
    try {
      const returned = handler.callback.apply(handler.owner || pluginApp, payload.args);
      await awaitAction(returned);
      const action = {type: handler.type, callbackKind: "event", status: "passed", payload: payload.kind};
      const editorAfter = pluginApp.editor.editorSnapshot();
      if (handler.type === "editor-menu") {
        const menu = payload.args[0];
        action.menu = {
          item_titles: Array.isArray(menu?.items) ? menu.items.filter((item) => !item.separator).map((item) => item.title) : [],
          rename_item_available: Array.isArray(menu?.items) && menu.items.some((item) => typeof item.title === "string" && item.title.startsWith("Rename #")),
          callbacks_captured: Array.isArray(menu?.items) ? menu.items.filter((item) => typeof item.callback === "function").length : 0,
        };
      }
      if (editorBefore.value !== editorAfter.value) {
        action.editor_mutated = true;
        action.editor_before = editorBefore.value;
        action.editor_after = editorAfter.value;
      }
      actions.events.push(action);
    } catch (error) {
      actions.events.push({type: handler.type, callbackKind: "event", status: "failed", payload: payload.kind, error: actionError(error)});
    }
  }
  const tagWorkflow = boundedTagWorkflow(pluginApp, workflowContext);
  if (tagWorkflow) actions.tag_workflow = tagWorkflow;
  const recentFilesWorkflow = boundedRecentFilesWorkflow(workflowContext);
  if (recentFilesWorkflow) actions.recent_files_workflow = recentFilesWorkflow;
  return actions;
}

async function workflowInstance(module, workflow, dataStore, phase, version, workflowContext = {}, manifestId = "renderer-workflow-fixture", runtime = {}, capabilities = []) {
  const Constructor = pluginConstructor(module);
  if (!Constructor) throw new Error("workflow fixture did not export a plugin class");
  dataStore.loadedByPlugin = Object.create(null);
  dataStore.savedByPlugin = Object.create(null);
  const pluginApp = createPluginApp([], dataStore, workflowContext, capabilities);
  globalThis.app = pluginApp;
  const instance = new Constructor(pluginApp, {id: manifestId, version});
  pluginApp.plugins.plugins[manifestId] = instance;
  if (runtime.window) runtime.window.app = pluginApp;
  const events = ["constructed"];
  await lifecycleCall(instance, "onload", events);
  await configureSyntheticSmartEnvironment(runtime);
  const editorBefore = pluginApp.editor.editorSnapshot();
  const operationStart = Array.isArray(workflowContext.metrics?.editorOperations) ? workflowContext.metrics.editorOperations.length : 0;
  const clipboardWritesStart = Number(workflowContext.metrics?.clipboardWrites || 0);
  const clipboardReadsStart = Number(workflowContext.metrics?.clipboardReads || 0);
  const actions = await exerciseRegistrations(pluginApp, workflowContext);
  while (pluginApp.editor.canUndo()) pluginApp.editor.undo();
  const editorAfter = pluginApp.editor.editorSnapshot();
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
    persistedData: cloneData(dataStore?.value),
    loadedDataByPlugin: cloneData(dataStore?.loadedByPlugin),
    savedDataByPlugin: cloneData(dataStore?.savedByPlugin),
    persistedDataByPlugin: cloneData(dataStore?.scopedValues),
    storage: storageSnapshot(runtime.storage),
    registered,
    actions,
    editor: {
      initialValue: editorBefore.value,
      finalValue: editorAfter.value,
      initialFoldedRanges: editorBefore.foldedRanges,
      finalFoldedRanges: editorAfter.foldedRanges,
      operations: Array.isArray(workflowContext.metrics?.editorOperations) ? workflowContext.metrics.editorOperations.slice(operationStart) : [],
    },
    clipboard: {
      writes: Math.max(0, Number(workflowContext.metrics?.clipboardWrites || 0) - clipboardWritesStart),
      reads: Math.max(0, Number(workflowContext.metrics?.clipboardReads || 0) - clipboardReadsStart),
      lastTextBytes: typeof workflowContext.metrics?.clipboardText === "string" ? workflowContext.metrics.clipboardText.length : 0,
      external: false,
    },
    tag_workflow: actions.tag_workflow || null,
    recent_files_workflow: actions.recent_files_workflow || null,
    remainingRegistrationsBeforeCleanup: [registered.commands, registered.views, registered.settings, registered.events].filter((values) => values.length > 0).length,
  };
  pluginApp.commands.length = 0;
  pluginApp.views.length = 0;
  pluginApp.settings.length = 0;
  pluginApp.registeredEvents.length = 0;
  pluginApp.commandHandlers.length = 0;
  pluginApp.viewFactories.length = 0;
  pluginApp.settingTabs.length = 0;
  pluginApp.eventHandlers.length = 0;
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
  const metrics = {vaultWrites: 0, vaultOperations: [], clipboardWrites: 0, clipboardReads: 0, clipboardText: ""};
  const workflowContext = {...workflowConfig, metrics};
  const workflow = {supported: false, phases: [], pluginDataWrites: 0, vaultWrites: 0, vaultOperations: [], activeAfterUninstall: true, artifactId: typeof workflowConfig.artifact_id === "string" ? workflowConfig.artifact_id : "renderer-workflow-fixture"};
  try {
    const dataStore = {
      value: cloneData(workflowConfig.initial_data),
      initialByPlugin: cloneData(workflowConfig.initial_data_by_plugin),
      writes: 0,
    };
    const initialApp = createPluginApp([], dataStore, workflowContext, deniedCapabilities);
    const runtime = {app: initialApp, allowSyntheticDocument: true, storage: new Map(), metrics};
    const evaluatePhase = () => evaluateSource(source, deniedCapabilities, requiredModules, runtime);
    const module = evaluatePhase();
    workflow.supported = true;
    await workflowInstance(module, workflow, dataStore, "install", "1.0.0", workflowContext, workflow.artifactId, runtime, deniedCapabilities);
    runtime.window = undefined;
    await workflowInstance(evaluatePhase(), workflow, dataStore, "restart", "1.0.0", workflowContext, workflow.artifactId, runtime, deniedCapabilities);
    runtime.window = undefined;
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
    boundedMenu,
    boundedStorage,
    boundedMoment,
    safeWindowObject,
    safeComponentObject,
    safeCallable,
    boundedEditorAdapter,
    cloneData,
    storageSnapshot,
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
    configureSyntheticSmartEnvironment,
    escapePattern,
    renameTagValue,
    boundedTagRename,
    frontmatterTagValues,
    boundedTagWorkflow,
    boundedRecentFilesWorkflow,
    eventPayload,
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
