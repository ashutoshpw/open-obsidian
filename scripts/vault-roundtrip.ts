import {chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync} from "node:fs";
import {arch, platform as hostPlatform, tmpdir} from "node:os";
import {dirname, join, sep} from "node:path";
import {VaultSafetyError, VaultStore, snapshotVault} from "../src/core/vault.js";

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as {code?: unknown};
  return typeof candidate.code === "string" ? candidate.code : undefined;
}

function reservedNameOutcome(store: VaultStore): "denied-reserved-name" | "denied-other" | "allowed" {
  try {
    store.read("CON");
    return "allowed";
  } catch (error) {
    return error instanceof VaultSafetyError && error.message.includes("Windows-reserved") ? "denied-reserved-name" : "denied-other";
  }
}

function createSymlink(outside: string, link: string): {created: true} | {created: false; reason: string} {
  try {
    symlinkSync(outside, link, "file");
  } catch (error) {
    const code = errorCode(error);
    if (code && ["EACCES", "EPERM", "ENOTSUP"].includes(code)) return {created: false, reason: code};
    throw error;
  }
  return {created: true};
}

function symlinkOutcome(store: VaultStore, root: string, appDataRoot: string): {status: "denied" | "skipped"; reason?: string} {
  const outside = join(appDataRoot, "outside.md");
  const link = join(root, "linked.md");
  writeFileSync(outside, "outside\n");
  const created = createSymlink(outside, link);
  if (!created.created) return {status: "skipped", reason: created.reason};
  try {
    store.read("linked.md");
  } catch (error) {
    if (error instanceof VaultSafetyError) return {status: "denied"};
    throw error;
  }
  throw new Error("VaultStore followed a symlink instead of denying it");
}

type PermissionLossOutcome = {
  status: "denied-preserved" | "not-enforced" | "skipped";
  host_enforced: boolean;
  original_preserved: boolean;
  failed_write_preserved: boolean;
  error_code?: string;
  reason?: string;
};

type PermissionModeChange = {status: "changed"; mode: number} | {status: "skipped"; outcome: PermissionLossOutcome};

function makeReadOnly(directory: string): PermissionModeChange {
  const mode = statSync(directory).mode & 0o777;
  try {
    chmodSync(directory, 0o555);
    return {status: "changed", mode};
  } catch (error) {
    const code = errorCode(error);
    if (code && ["EACCES", "EPERM", "ENOTSUP"].includes(code)) return {status: "skipped", outcome: {status: "skipped", host_enforced: false, original_preserved: true, failed_write_preserved: false, error_code: code, reason: "host refused disposable permission change"}};
    throw error;
  }
}

function attemptPermissionLoss(store: VaultStore, targetPath: string, relativePath: string, baseline: Uint8Array): PermissionLossOutcome {
  const incoming = Buffer.from("permission-loss\n", "utf8");
  const read = store.read(relativePath);
  try {
    store.write({relativePath, expectedRevision: read.revision, bytes: incoming, operationId: "host-permission-loss"});
  } catch (error) {
    const after = readFileSync(targetPath);
    const failed = store.listFailedWrites(relativePath).find((record) => sameBytes(readFileSync(record.path), incoming));
    requireCondition(sameBytes(after, baseline), "permission-loss write changed the original bytes");
    requireCondition(Boolean(failed), "permission-loss write did not preserve incoming failed bytes");
    return {status: "denied-preserved", host_enforced: true, original_preserved: true, failed_write_preserved: true, error_code: errorCode(error)};
  }

  writeFileSync(targetPath, baseline);
  requireCondition(sameBytes(readFileSync(targetPath), baseline), "permission-loss recovery could not restore the baseline bytes");
  return {status: "not-enforced", host_enforced: false, original_preserved: true, failed_write_preserved: false};
}

function permissionLossOutcome(store: VaultStore, root: string, relativePath: string, baseline: Uint8Array): PermissionLossOutcome {
  const targetPath = join(root, relativePath);
  const protectedDirectory = dirname(targetPath);
  const change = makeReadOnly(protectedDirectory);
  if (change.status === "skipped") return change.outcome;
  try {
    return attemptPermissionLoss(store, targetPath, relativePath, baseline);
  } finally {
    chmodSync(protectedDirectory, change.mode);
  }
}

export function runVaultRoundTrip(): Record<string, unknown> {
  const root = mkdtempSync(join(tmpdir(), "openobsidian-host-vault-"));
  const appDataRoot = mkdtempSync(join(tmpdir(), "openobsidian-host-app-"));
  try {
    mkdirSync(join(root, ".obsidian"));
    mkdirSync(join(root, "nested"));
    const originalNote = Buffer.from("\uFEFFtitle\r\nbody\r\n", "utf8");
    const nextNote = Buffer.from("\uFEFFtitle\r\nchanged\r\n", "utf8");
    const originalBinary = Buffer.from([0, 255, 7, 10, 128]);
    writeFileSync(join(root, "nested", "note.md"), originalNote);
    writeFileSync(join(root, "binary.bin"), originalBinary);
    writeFileSync(join(root, ".obsidian", "app.json"), '{"theme":"minimal"}\n');

    const store = new VaultStore(root, appDataRoot);
    const before = snapshotVault(root);
    const scan = store.scan();
    requireCondition(scan.unchanged && scan.changedPaths.length === 0, "read-only scan changed the vault");
    requireCondition(readdirSync(appDataRoot).length === 0, "read-only scan wrote app data");

    const read = store.read("nested\\note.md");
    requireCondition(read.relativePath === "nested/note.md", "backslash path was not normalized");
    requireCondition(sameBytes(read.bytes, originalNote), "initial note bytes changed");
    const written = store.write({relativePath: read.relativePath, expectedRevision: read.revision, bytes: nextNote, operationId: "host-roundtrip"});
    requireCondition(sameBytes(written.bytes, nextNote), "write returned unexpected bytes");
    requireCondition(sameBytes(readFileSync(join(root, "binary.bin")), originalBinary), "unrelated binary bytes changed");
    requireCondition(store.listRecovery("nested/note.md").length === 1, "write did not preserve recovery bytes");
    requireCondition(readdirSync(join(root, "nested")).every((name) => !name.endsWith(".tmp")), "temporary replacement remained in the vault");

    const reopened = new VaultStore(root, appDataRoot);
    const reopenedRead = reopened.read("nested/note.md");
    requireCondition(sameBytes(reopenedRead.bytes, nextNote), "reopened vault did not retain the edited bytes");
    const after = snapshotVault(root);
    const secondScan = reopened.scan();
    requireCondition(secondScan.unchanged && secondScan.changedPaths.length === 0, "reopened no-op scan was not stable");
    const recoverySnapshot = store.listRecovery("nested/note.md").length === 1;
    const reservedName = reservedNameOutcome(reopened);
    if (hostPlatform() === "win32") requireCondition(reservedName === "denied-reserved-name", "Windows reserved name was not denied");
    const symlink = symlinkOutcome(reopened, root, appDataRoot);
    const permissionLoss = permissionLossOutcome(reopened, root, "nested/note.md", reopenedRead.bytes);

    return {
      schema_version: 1,
      status: "passed",
      command: "bun run audit:vault-roundtrip",
      environment: {platform: hostPlatform(), architecture: arch(), path_separator: sep},
      checks: {
        no_op_scan: scan.unchanged,
        no_op_app_data: true,
        bom_crlf_round_trip: sameBytes(reopenedRead.bytes, nextNote),
        normalized_backslash_path: read.relativePath,
        atomic_write_and_reopen: true,
        recovery_snapshot: recoverySnapshot,
        unrelated_binary_preserved: sameBytes(readFileSync(join(root, "binary.bin")), originalBinary),
        temporary_files_removed: true,
        symlink_boundary: symlink,
        windows_reserved_name: {outcome: reservedName, host_enforced: hostPlatform() === "win32"},
        permission_loss: permissionLoss,
      },
      snapshots: {before_sha256: before.sha256, after_sha256: after.sha256, changed_by_approved_write: before.sha256 !== after.sha256},
      limitations: [
        "This is a real temporary-directory host round trip; disk-full, cloud-placeholder, power-loss and reference Obsidian behavior remain separate gates, and permission enforcement is reported as host-dependent.",
        "The report does not certify same-user OS isolation, human accessibility or signed release behavior.",
      ],
    };
  } finally {
    rmSync(root, {recursive: true, force: true});
    rmSync(appDataRoot, {recursive: true, force: true});
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(runVaultRoundTrip()));
  } catch (error) {
    console.error(JSON.stringify({schema_version: 1, status: "failed", command: "bun run audit:vault-roundtrip", error: error instanceof Error ? error.message : String(error)}));
    process.exit(1);
  }
}
