import {createHash} from "node:crypto";
import {resolve} from "node:path";

const root = resolve(import.meta.dir, "..");
const excludedPrefixes = [".agents/", ".git/", "node_modules/", ".fallow/", "dist/", "out/"];
const definition = "SHA-256 over sorted tracked and untracked paths plus a NUL separator, file bytes and a trailing NUL separator for each path, excluding .agents, .git, node_modules, .fallow, dist and out.";

function sourcePaths(): string[] {
  const output = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard"], {cwd: root}).stdout.toString().trim();
  return (output ? output.split("\n") : []).filter((path) => !excludedPrefixes.some((prefix) => path.startsWith(prefix))).sort();
}

async function digest(paths: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update(Buffer.from([0]));
    hash.update(Buffer.from(await Bun.file(resolve(root, path)).arrayBuffer()));
    hash.update(Buffer.from([0]));
  }
  return hash.digest("hex");
}

const paths = sourcePaths();
console.log(JSON.stringify({
  schema_version: 1,
  generated_at: new Date().toISOString(),
  head: Bun.spawnSync(["git", "rev-parse", "HEAD"], {cwd: root}).stdout.toString().trim(),
  sha256: await digest(paths),
  paths: paths.length,
  definition,
}, null, 2));
