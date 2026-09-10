export function normalizeScopePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function scopePathMatches(path: string, candidate: string): boolean {
  const normalized = normalizeScopePath(candidate);
  return normalized.length > 0 && (path === normalized || path.startsWith(`${normalized}/`));
}
