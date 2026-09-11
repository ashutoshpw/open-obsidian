export type BundleMarkerId = "filesystem" | "network" | "process" | "credentials" | "dom" | "native" | "dynamic-code";

export type BundleMarker = {
  id: BundleMarkerId;
  capability: string;
  matchedPatterns: string[];
};

export type BundlePrescreen = {
  markers: BundleMarker[];
  markerIds: BundleMarkerId[];
};

type MarkerDefinition = {
  id: BundleMarkerId;
  capability: string;
  patterns: ReadonlyArray<readonly [string, RegExp]>;
};

const markerDefinitions: readonly MarkerDefinition[] = [
  {id: "filesystem", capability: "filesystem.direct", patterns: [["node-fs", /node:fs|require\(["']fs["']\)/], ["fs-operation", /\bfs\.(?:readFile|writeFile|readdir|stat|unlink|mkdir|rename)\b/]]},
  {id: "network", capability: "network.request", patterns: [["fetch", /\bfetch\s*\(/], ["xhr", /XMLHttpRequest|WebSocket/], ["obsidian-request", /requestUrl|request\(/]]},
  {id: "process", capability: "process.spawn", patterns: [["child-process", /child_process|process\.(?:spawn|exec|dlopen)\b/], ["exec", /\bexec(?:File)?\s*\(/]]},
  {id: "credentials", capability: "credentials.read", patterns: [["keytar", /keytar|safeStorage|app\.(?:get|set)Password/], ["environment", /process\.env\b/]]},
  {id: "dom", capability: "dom.privileged", patterns: [["document", /\bdocument\./], ["window", /\bwindow\./], ["editor-dom", /HTMLElement|MutationObserver|CodeMirror|app\.workspace/]]},
  {id: "native", capability: "native.abi", patterns: [["native-addon", /\.node\b|node-gyp|ffi-napi/]]},
  {id: "dynamic-code", capability: "code.dynamic", patterns: [["eval", /\beval\s*\(/], ["function-constructor", /\bnew Function\s*\(/], ["webassembly", /WebAssembly/]]},
];

function markerResult(source: string, definition: MarkerDefinition): BundleMarker | null {
  const matchedPatterns = definition.patterns.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
  return matchedPatterns.length > 0 ? {id: definition.id, capability: definition.capability, matchedPatterns} : null;
}

export function scanPluginBundle(source: string): BundlePrescreen {
  const markers = markerDefinitions.map((definition) => markerResult(source, definition)).filter((marker): marker is BundleMarker => marker !== null);
  return {markers, markerIds: markers.map((marker) => marker.id)};
}
