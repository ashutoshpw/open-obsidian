import type {GraphEdge, GraphLayoutMode, GraphNode, GraphPoint} from "../api.js";

export type GraphLayoutOptions = {width?: number; height?: number; padding?: number};

const DEFAULT_LAYOUT: Required<GraphLayoutOptions> = {width: 720, height: 360, padding: 34};

function dimension(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function layoutBounds(options: GraphLayoutOptions): Required<GraphLayoutOptions> {
  const width = dimension(options.width, DEFAULT_LAYOUT.width);
  const height = dimension(options.height, DEFAULT_LAYOUT.height);
  const padding = Math.min(dimension(options.padding, DEFAULT_LAYOUT.padding), Math.min(width, height) / 2);
  return {width, height, padding};
}

function nodeIds(nodes: readonly GraphNode[]): string[] {
  return [...new Set(nodes.map((node) => node.id))].sort((left, right) => left.localeCompare(right));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundedPoint(point: GraphPoint, bounds: Required<GraphLayoutOptions>): GraphPoint {
  return {
    x: Math.round(clamp(point.x, bounds.padding, bounds.width - bounds.padding) * 100) / 100,
    y: Math.round(clamp(point.y, bounds.padding, bounds.height - bounds.padding) * 100) / 100,
  };
}

function distribute(count: number, minimum: number, maximum: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(minimum + maximum) / 2];
  const step = (maximum - minimum) / (count - 1);
  return Array.from({length: count}, (_, index) => minimum + step * index);
}

function radialPositions(ids: string[], bounds: Required<GraphLayoutOptions>): Map<string, GraphPoint> {
  const result = new Map<string, GraphPoint>();
  const center = {x: bounds.width / 2, y: bounds.height / 2};
  if (ids.length === 1) {
    result.set(ids[0]!, center);
    return result;
  }
  const radius = Math.max(0, Math.min(bounds.width, bounds.height) / 2 - bounds.padding);
  ids.forEach((id, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / ids.length;
    result.set(id, {x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius});
  });
  return result;
}

function hierarchicalPositions(ids: string[], edges: readonly GraphEdge[], bounds: Required<GraphLayoutOptions>): Map<string, GraphPoint> {
  const known = new Set(ids);
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  edges.forEach((edge) => {
    if (!known.has(edge.from) || !known.has(edge.to) || edge.from === edge.to) return;
    const targets = outgoing.get(edge.from)!;
    if (targets.includes(edge.to)) return;
    targets.push(edge.to);
    incoming.set(edge.to, incoming.get(edge.to)! + 1);
  });
  outgoing.forEach((targets) => targets.sort((left, right) => left.localeCompare(right)));
  const roots = ids.filter((id) => incoming.get(id) === 0);
  const frontier = roots.length > 0 ? roots : ids.slice(0, 1);
  const levels = new Map<string, number>();
  let current = [...frontier];
  let level = 0;
  while (current.length > 0) {
    const next: string[] = [];
    current.sort((left, right) => left.localeCompare(right)).forEach((id) => {
      if (levels.has(id)) return;
      levels.set(id, level);
      outgoing.get(id)?.forEach((target) => {
        if (!levels.has(target)) next.push(target);
      });
    });
    current = [...new Set(next)];
    level += 1;
  }
  ids.filter((id) => !levels.has(id)).forEach((id) => levels.set(id, level++));
  const byLevel = new Map<number, string[]>();
  levels.forEach((nodeLevel, id) => {
    const levelIds = byLevel.get(nodeLevel) ?? [];
    levelIds.push(id);
    byLevel.set(nodeLevel, levelIds);
  });
  const maxLevel = Math.max(0, ...byLevel.keys());
  const result = new Map<string, GraphPoint>();
  byLevel.forEach((levelIds, nodeLevel) => {
    const yValues = distribute(levelIds.length, bounds.padding, bounds.height - bounds.padding);
    const x = maxLevel === 0 ? bounds.width / 2 : bounds.padding + ((bounds.width - bounds.padding * 2) * nodeLevel) / maxLevel;
    levelIds.sort((left, right) => left.localeCompare(right)).forEach((id, index) => result.set(id, {x, y: yValues[index]!}));
  });
  return result;
}

function forcePositions(ids: string[], edges: readonly GraphEdge[], bounds: Required<GraphLayoutOptions>): Map<string, GraphPoint> {
  const points = radialPositions(ids, bounds);
  if (ids.length < 2) return points;
  const known = new Set(ids);
  const links = edges.filter((edge) => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to);
  const minimumDistance = 16;
  for (let iteration = 0; iteration < 28; iteration += 1) {
    const forces = new Map(ids.map((id) => [id, {x: 0, y: 0}]));
    for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
        const left = ids[leftIndex]!;
        const right = ids[rightIndex]!;
        const leftPoint = points.get(left)!;
        const rightPoint = points.get(right)!;
        const dx = rightPoint.x - leftPoint.x;
        const dy = rightPoint.y - leftPoint.y;
        const distance = Math.max(minimumDistance, Math.hypot(dx, dy));
        const strength = 1400 / (distance * distance);
        const fx = (dx / distance) * strength;
        const fy = (dy / distance) * strength;
        forces.get(left)!.x -= fx;
        forces.get(left)!.y -= fy;
        forces.get(right)!.x += fx;
        forces.get(right)!.y += fy;
      }
    }
    links.forEach((edge) => {
      const from = points.get(edge.from)!;
      const to = points.get(edge.to)!;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.max(minimumDistance, Math.hypot(dx, dy));
      const strength = (distance - 105) * 0.0018;
      const fx = (dx / distance) * strength;
      const fy = (dy / distance) * strength;
      forces.get(edge.from)!.x += fx;
      forces.get(edge.from)!.y += fy;
      forces.get(edge.to)!.x -= fx;
      forces.get(edge.to)!.y -= fy;
    });
    ids.forEach((id) => {
      const point = points.get(id)!;
      const force = forces.get(id)!;
      points.set(id, {
        x: clamp(point.x + force.x * 18, bounds.padding, bounds.width - bounds.padding),
        y: clamp(point.y + force.y * 18, bounds.padding, bounds.height - bounds.padding),
      });
    });
  }
  return points;
}

export function layoutGraph(nodes: readonly GraphNode[], edges: readonly GraphEdge[], layout: GraphLayoutMode, options: GraphLayoutOptions = {}): Record<string, GraphPoint> {
  const ids = nodeIds(nodes);
  const bounds = layoutBounds(options);
  const positions = layout === "hierarchical" ? hierarchicalPositions(ids, edges, bounds) : layout === "radial" ? radialPositions(ids, bounds) : forcePositions(ids, edges, bounds);
  return Object.fromEntries(ids.map((id) => [id, roundedPoint(positions.get(id) ?? {x: bounds.width / 2, y: bounds.height / 2}, bounds)]));
}
