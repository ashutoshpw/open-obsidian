import {performance} from "node:perf_hooks";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {basename, join} from "node:path";
import {buildVaultIndex, searchVaultIndex, type VaultIndex} from "../src/core/vault-index.js";
import {createVaultWatcher} from "../src/core/watcher.js";
import {VaultStore} from "../src/core/vault.js";
import {percentile} from "./metrics.js";

type BenchmarkFixture = {
  schema_version: number;
  protocol_version: string;
  scope: string;
  profiles: Array<{id: string; notes: number; disposition: "local-synthetic" | "external-pending"; reason?: string}>;
  budgets: {startup_p95_ms: number; input_p95_ms: number; input_p99_ms: number; search_p95_ms: number; search_p99_ms: number; watcher_p95_ms: number};
  external_pending: Array<{id: string; reason: string}>;
};

type Distribution = {
  runs: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  min_ms: number;
  max_ms: number;
};

type MemoryDistribution = {
  runs: number;
  p50_bytes: number;
  p95_bytes: number;
  p99_bytes: number;
  min_bytes: number;
  max_bytes: number;
};

type BenchmarkScope = "linux-core-synthetic" | "non-linux-core-synthetic";

export type BenchmarkProfileReport = {
  id: string;
  notes: number;
  scope: BenchmarkScope;
  startup: {prior_note_read: Distribution; indexing: Distribution; editable_before_indexing: boolean; passed: boolean};
  input: {normal: Distribution; large_file: Distribution; passed: boolean};
  search: Distribution & {passed: boolean};
  watcher: Distribution & {observed: boolean; passed: boolean};
  resources: {
    rss: MemoryDistribution;
    heap_used: MemoryDistribution;
    app_overhead_bytes: number;
    model_memory_bytes: number;
    cpu_user_ms: number;
    cpu_system_ms: number;
  };
};

export type BenchmarkReport = {
  schema_version: 1;
  protocol_version: string;
  recorded_at: string;
  environment: {os: string; architecture: string; bun: string; scope: BenchmarkScope};
  budgets: BenchmarkFixture["budgets"];
  profiles: BenchmarkProfileReport[];
  external_pending: BenchmarkFixture["external_pending"];
  release_eligible: false;
};

const fixture = await Bun.file(new URL("../fixtures/performance-benchmark.json", import.meta.url)).json() as BenchmarkFixture;

function localScope(): BenchmarkScope {
  return process.platform === "linux" ? "linux-core-synthetic" : "non-linux-core-synthetic";
}

function distribution(values: number[]): Distribution {
  return {
    runs: values.length,
    p50_ms: percentile(values, 0.5),
    p95_ms: percentile(values, 0.95),
    p99_ms: percentile(values, 0.99),
    min_ms: Number((Math.min(...values) || 0).toFixed(3)),
    max_ms: Number((Math.max(...values) || 0).toFixed(3)),
  };
}

function memoryDistribution(values: number[]): MemoryDistribution {
  return {
    runs: values.length,
    p50_bytes: Math.round(percentile(values, 0.5)),
    p95_bytes: Math.round(percentile(values, 0.95)),
    p99_bytes: Math.round(percentile(values, 0.99)),
    min_bytes: Math.round(Math.min(...values) || 0),
    max_bytes: Math.round(Math.max(...values) || 0),
  };
}

function noteText(index: number): string {
  const link = index % 100 === 0 ? `\nSee [[Benchmark ${index % 11}]].` : "";
  return `---\ntags: [benchmark, note-${index % 17}]\n---\n# Benchmark note ${index}\n\nThe local benchmark corpus records deterministic content for indexing, search and edit measurements.${link}\n`;
}

function seedVault(root: string, notes: number): string {
  const directory = join(root, "Notes");
  mkdirSync(directory, {recursive: true});
  for (let index = 0; index < notes; index += 1) writeFileSync(join(directory, `note-${String(index).padStart(6, "0")}.md`), noteText(index));
  const prior = join(directory, "note-000000.md");
  const large = "# Large input fixture\n\n" + "benchmark text ".repeat(65536);
  writeFileSync(join(root, "large-input.md"), large);
  return prior;
}

function syntheticInsert(text: string, iteration: number): string {
  const position = Math.min(text.length, 32 + (iteration % 97));
  return `${text.slice(0, position)}x${text.slice(position)}`;
}

function measureInput(text: string, runs: number): Distribution {
  const samples: number[] = [];
  let checksum = 0;
  for (let iteration = 0; iteration < runs; iteration += 1) {
    const started = performance.now();
    checksum ^= syntheticInsert(text, iteration).length;
    samples.push(performance.now() - started);
  }
  if (checksum < 0) throw new Error("Synthetic input checksum became invalid");
  return distribution(samples);
}

function measureSearch(index: VaultIndex, runs: number): Distribution {
  const samples: number[] = [];
  let resultCount = 0;
  for (let iteration = 0; iteration < runs; iteration += 1) {
    const started = performance.now();
    resultCount += searchVaultIndex(index, iteration % 2 === 0 ? "deterministic content" : "benchmark").length;
    samples.push(performance.now() - started);
  }
  if (resultCount <= 0) throw new Error("Synthetic search returned no results");
  return distribution(samples);
}

function memorySamples(): {rss: number; heapUsed: number} {
  const memory = process.memoryUsage();
  return {rss: memory.rss, heapUsed: memory.heapUsed};
}

async function measureWatcher(root: string, relativePath: string): Promise<number | null> {
  const target = join(root, ...relativePath.split("/"));
  let resolveSample: (value: number | null) => void = () => undefined;
  const result = new Promise<number | null>((resolve) => { resolveSample = resolve; });
  const started = performance.now();
  let closed = false;
  let watcher: ReturnType<typeof createVaultWatcher> | null = null;
  watcher = createVaultWatcher(root, (event) => {
    if (closed || (event.event !== "change" && event.event !== "rename")) return;
    closed = true;
    watcher?.close();
    resolveSample(performance.now() - started);
  });
  const timeout = setTimeout(() => {
    if (closed) return;
    closed = true;
    watcher?.close();
    resolveSample(null);
  }, 2000);
  writeFileSync(target, `${readFileSync(target, "utf8")}watcher probe\n`);
  const sample = await result;
  clearTimeout(timeout);
  return sample;
}

function parseRequestedProfiles(args: readonly string[]): number[] {
  const requested = args.find((arg) => arg.startsWith("--profiles="))?.slice("--profiles=".length);
  if (!requested) return [100, 1000];
  const values = requested.split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0 && value <= 10000);
  if (values.length === 0) throw new Error("--profiles must contain one or more positive note counts up to 10000");
  return [...new Set(values)];
}

function parsePositiveOption(args: readonly string[], name: string, fallback: number): number {
  const value = args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function localProfileId(notes: number): string {
  return notes === 100 ? "smoke-100" : notes === 1000 ? "synthetic-1000" : notes === 10000 ? "synthetic-10000" : `synthetic-${notes}`;
}

type BenchmarkOptions = {indexRuns: number; searchRuns: number; inputRuns: number};

type IndexMeasurements = {index: VaultIndex; priorReadSamples: number[]; indexSamples: number[]; rssSamples: number[]; heapSamples: number[]};

function collectIndexMeasurements(store: VaultStore, priorPath: string, runs: number): IndexMeasurements {
  const priorReadSamples: number[] = [];
  const indexSamples: number[] = [];
  const rssSamples: number[] = [];
  const heapSamples: number[] = [];
  const initialMemory = memorySamples();
  rssSamples.push(initialMemory.rss);
  heapSamples.push(initialMemory.heapUsed);
  let index: VaultIndex | null = null;
  for (let run = 0; run < runs; run += 1) {
    const readStarted = performance.now();
    store.read(`Notes/${basename(priorPath) || "note-000000.md"}`);
    priorReadSamples.push(performance.now() - readStarted);
    const indexStarted = performance.now();
    index = buildVaultIndex(store);
    indexSamples.push(performance.now() - indexStarted);
    const memory = memorySamples();
    rssSamples.push(memory.rss);
    heapSamples.push(memory.heapUsed);
  }
  if (!index) throw new Error("Benchmark index was not built");
  return {index, priorReadSamples, indexSamples, rssSamples, heapSamples};
}

function inputPassed(normal: Distribution, largeFile: Distribution): boolean {
  const within = (sample: Distribution): boolean => sample.p95_ms <= fixture.budgets.input_p95_ms && sample.p99_ms <= fixture.budgets.input_p99_ms;
  return within(normal) && within(largeFile);
}

function searchPassed(search: Distribution): boolean {
  return search.p95_ms <= fixture.budgets.search_p95_ms && search.p99_ms <= fixture.budgets.search_p99_ms;
}

function watcherPassed(watcherSample: number | null, watcher: Distribution): boolean {
  return watcherSample !== null && watcher.p95_ms <= fixture.budgets.watcher_p95_ms;
}

async function benchmarkProfile(notes: number, options: BenchmarkOptions): Promise<BenchmarkProfileReport> {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-benchmark-vault-"));
  const appData = mkdtempSync(join(tmpdir(), "openobsidian-benchmark-app-"));
  try {
    const priorPath = seedVault(root, notes);
    const store = new VaultStore(root, appData);
    const cpuBefore = process.cpuUsage();
    const indexed = collectIndexMeasurements(store, priorPath, options.indexRuns);
    const search = measureSearch(indexed.index, options.searchRuns);
    const normalInput = measureInput(noteText(0), options.inputRuns);
    const largeInput = measureInput(readFileSync(join(root, "large-input.md"), "utf8"), options.inputRuns);
    const watcherSample = await measureWatcher(root, "Notes/note-000000.md");
    if (watcherSample !== null) {
      const memory = memorySamples();
      indexed.rssSamples.push(memory.rss);
      indexed.heapSamples.push(memory.heapUsed);
    }
    const cpu = process.cpuUsage(cpuBefore);
    const watcher = distribution(watcherSample === null ? [] : [watcherSample]);
    const rss = memoryDistribution(indexed.rssSamples);
    const heapUsed = memoryDistribution(indexed.heapSamples);
    const appOverheadBytes = Math.max(0, rss.p95_bytes - rss.min_bytes);
    return {
      id: localProfileId(notes),
      notes,
      scope: localScope(),
      startup: {prior_note_read: distribution(indexed.priorReadSamples), indexing: distribution(indexed.indexSamples), editable_before_indexing: indexed.priorReadSamples.length === indexed.indexSamples.length && indexed.priorReadSamples.length > 0, passed: percentile(indexed.priorReadSamples, 0.95) <= fixture.budgets.startup_p95_ms},
      input: {normal: normalInput, large_file: largeInput, passed: inputPassed(normalInput, largeInput)},
      search: {...search, passed: searchPassed(search)},
      watcher: {...watcher, observed: watcherSample !== null, passed: watcherPassed(watcherSample, watcher)},
      resources: {rss, heap_used: heapUsed, app_overhead_bytes: appOverheadBytes, model_memory_bytes: 0, cpu_user_ms: Number((cpu.user / 1000).toFixed(3)), cpu_system_ms: Number((cpu.system / 1000).toFixed(3))},
    };
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appData, {recursive: true, force: true});
  }
}

export async function runBenchmark(noteCounts: readonly number[] = [100, 1000], options: {indexRuns?: number; searchRuns?: number; inputRuns?: number} = {}): Promise<BenchmarkReport> {
  const settings: BenchmarkOptions = {indexRuns: options.indexRuns ?? 3, searchRuns: options.searchRuns ?? 25, inputRuns: options.inputRuns ?? 50};
  const profiles: BenchmarkProfileReport[] = [];
  for (const notes of noteCounts) profiles.push(await benchmarkProfile(notes, settings));
  return {schema_version: 1, protocol_version: fixture.protocol_version, recorded_at: new Date().toISOString(), environment: {os: process.platform, architecture: process.arch, bun: Bun.version, scope: localScope()}, budgets: fixture.budgets, profiles, external_pending: fixture.external_pending, release_eligible: false};
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    const report = await runBenchmark(parseRequestedProfiles(args), {
      indexRuns: parsePositiveOption(args, "--index-runs", 3),
      searchRuns: parsePositiveOption(args, "--search-runs", 25),
      inputRuns: parsePositiveOption(args, "--input-runs", 50),
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
