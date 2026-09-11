export function percentile(values: number[], percentage: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  return Number((sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)] ?? 0).toFixed(3));
}
