import type {VaultIndex} from "./vault-index.js";

export type GraphNode = {id: string; kind: "file" | "unresolved"; label: string};
export type GraphEdge = {id: string; from: string; to: string; kind: "link" | "embed"};
export type VaultGraph = {nodes: GraphNode[]; edges: GraphEdge[]};

export function buildVaultGraph(index: VaultIndex): VaultGraph {
  const nodes: GraphNode[] = index.files.map((file) => ({id: file.relativePath, kind: "file", label: file.relativePath}));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [];
  for (const file of index.files) {
    for (const [index, link] of file.links.entries()) {
      const target = link.resolution.target ?? `?${link.target}`;
      if (!nodeIds.has(target)) nodes.push({id: target, kind: "unresolved", label: link.target});
      edges.push({id: `${file.relativePath}:${index}:${target}`, from: file.relativePath, to: target, kind: link.kind === "embed" ? "embed" : "link"});
    }
  }
  return {nodes, edges};
}
