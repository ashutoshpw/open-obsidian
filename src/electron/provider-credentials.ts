import {safeStorage} from "electron";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";
import {CredentialStoreError, type CredentialStore} from "../core/credentials.js";

type StoredCredentials = Record<string, string>;

function storedCredentials(value: unknown): StoredCredentials {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as StoredCredentials;
}

export class ElectronCredentialStore implements CredentialStore {
  readonly kind = "os" as const;

  constructor(private readonly path: string) {}

  has(reference: string): boolean {
    return Object.hasOwn(this.readAll(), reference);
  }

  read(reference: string): string | null {
    const value = this.readAll()[reference];
    if (!value) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new CredentialStoreError("OS credential storage is unavailable");
    try {
      return safeStorage.decryptString(Buffer.from(value, "base64"));
    } catch {
      throw new CredentialStoreError("OS credential storage could not decrypt the credential");
    }
  }

  write(reference: string, secret: string): void {
    if (!secret) throw new CredentialStoreError("Credential secret cannot be empty");
    if (!safeStorage.isEncryptionAvailable()) throw new CredentialStoreError("OS credential storage is unavailable");
    const encrypted = safeStorage.encryptString(secret).toString("base64");
    this.writeAll({...this.readAll(), [reference]: encrypted});
  }

  remove(reference: string): void {
    const values = this.readAll();
    delete values[reference];
    this.writeAll(values);
  }

  private readAll(): StoredCredentials {
    if (!existsSync(this.path)) return {};
    try {
      return storedCredentials(JSON.parse(readFileSync(this.path, "utf8")) as unknown);
    } catch {
      throw new CredentialStoreError("OS credential storage metadata is unreadable");
    }
  }

  private writeAll(values: StoredCredentials): void {
    mkdirSync(dirname(this.path), {recursive: true});
    writeFileSync(this.path, `${JSON.stringify(values, null, 2)}\n`, {mode: 0o600});
  }
}
