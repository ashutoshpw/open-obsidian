import type {VaultIndex} from "./vault-index.js";

import type {GraphEdge, GraphGroup, GraphNode, GraphView} from "../shared/api.js";

export type VaultGraph = GraphView;

function nodeKind(relativePath: string): GraphNode["kind"] {
  return relativePath.toLowerCase().endsWith(".md") ? "file" : "attachment";
}

function folderId(relativePath: string): string {
  const separator = relativePath.lastIndexOf("/");
  return separator === -1 ? "(root)" : relativePath.slice(0, separator);
}

export function buildVaultGraph(index: VaultIndex): VaultGraph {
  const nodes: GraphNode[] = index.files.map((file) => ({id: file.relativePath, kind: nodeKind(file.relativePath), label: file.relativePath}));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [];
  for (const file of index.files) {
    for (const [index, link] of file.links.entries()) {
      const target = link.resolution.target ?? `?${link.target}`;
      if (!nodeIds.has(target)) nodes.push({id: target, kind: "unresolved", label: link.target});
      edges.push({id: `${file.relativePath}:${index}:${target}`, from: file.relativePath, to: target, kind: link.kind === "embed" ? "embed" : "link"});
    }
  }
  const groups = [...nodes.filter((node) => node.kind !== "unresolved").reduce((groupMap, node) => {
    const id = folderId(node.id);
    const group = groupMap.get(id) ?? {id, label: id, nodeIds: []};
    group.nodeIds.push(node.id);
    groupMap.set(id, group);
    return groupMap;
  }, new Map<string, GraphGroup>()).values()].sort((left, right) => left.id.localeCompare(right.id));
  return {nodes, edges, groups, layout: "force"};
}
