export type CredentialStoreKind = "os" | "memory-test";

export interface CredentialStore {
  readonly kind: CredentialStoreKind;
  has(reference: string): boolean;
  read(reference: string): string | null;
  write(reference: string, secret: string): void;
  remove(reference: string): void;
}

export class CredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialStoreError";
  }
}

export class MemoryCredentialStore implements CredentialStore {
  readonly kind = "memory-test" as const;
  private readonly values = new Map<string, string>();

  has(reference: string): boolean {
    return this.values.has(reference);
  }

  read(reference: string): string | null {
    return this.values.get(reference) ?? null;
  }

  write(reference: string, secret: string): void {
    if (!secret) throw new CredentialStoreError("Credential secret cannot be empty");
    this.values.set(reference, secret);
  }

  remove(reference: string): void {
    this.values.delete(reference);
  }
}
