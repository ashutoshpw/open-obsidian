export type UninstallCleanupOptionId = "app-cache" | "credentials" | "recovery-history";

export type UninstallCleanupOption = {
  id: UninstallCleanupOptionId;
  label: string;
  description: string;
  vaultDisposition: "preserve";
  defaultSelected: false;
};

export const UNINSTALL_CLEANUP_OPTIONS: readonly UninstallCleanupOption[] = [
  {id: "app-cache", label: "App cache", description: "Derived indexes, UI state and disposable runtime cache.", vaultDisposition: "preserve", defaultSelected: false},
  {id: "credentials", label: "Stored credentials", description: "Provider credentials kept in OS-backed credential storage.", vaultDisposition: "preserve", defaultSelected: false},
  {id: "recovery-history", label: "Recovery history", description: "Managed recovery snapshots; unresolved conflicts remain protected.", vaultDisposition: "preserve", defaultSelected: false},
];

export function uninstallCleanupOption(id: UninstallCleanupOptionId): UninstallCleanupOption {
  const option = UNINSTALL_CLEANUP_OPTIONS.find((candidate) => candidate.id === id);
  if (!option) throw new Error(`Unknown uninstall cleanup option: ${id}`);
  return option;
}
