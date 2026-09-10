export type CanvasNode = {id: string; type: string; [key: string]: unknown};
export type CanvasEdge = {id: string; fromNode: string; toNode: string; [key: string]: unknown};

export type CanvasDocument = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  [key: string]: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireCanvas(value: unknown): CanvasDocument {
  if (!isObject(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error("Canvas document must contain nodes and edges arrays");
  return value as CanvasDocument;
}

export function parseCanvas(bytes: Uint8Array): CanvasDocument {
  return requireCanvas(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
}

export function encodeCanvas(document: CanvasDocument): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
}

export function editCanvasTextNode(bytes: Uint8Array, nodeId: string, text: string): Uint8Array {
  const document = parseCanvas(bytes);
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Canvas node does not exist: ${nodeId}`);
  if (node.type !== "text") throw new Error(`Canvas node is not a text card: ${nodeId}`);
  node.text = text;
  return encodeCanvas(document);
}

export function createNoteFromTextNode(bytes: Uint8Array, nodeId: string, path: string): {path: string; bytes: Uint8Array} {
  const document = parseCanvas(bytes);
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.type !== "text" || typeof node.text !== "string") throw new Error(`Canvas text card is not available: ${nodeId}`);
  return {path, bytes: new TextEncoder().encode(node.text)};
}
