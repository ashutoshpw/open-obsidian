import type {SyncToolDisposition} from "../shared/api.js";

const DISPOSITIONS: SyncToolDisposition[] = [
  {id: "chronicle-git", name: "Built-in Chronicle Git", mode: "built-in", verification: "contract-only", remoteContacted: false, note: "Explicit status, diff, commit, pull and push controls; no automatic push or destructive reset."},
  {id: "remotely-save", name: "Remotely Save", mode: "manual", verification: "contract-only", remoteContacted: false, note: "Use its existing configuration outside this v1 boundary; avoid competing automatic writers and keep conflicts visible."},
  {id: "syncthing", name: "Syncthing", mode: "manual", verification: "contract-only", remoteContacted: false, note: "Filesystem changes are observed and reconciled locally; no Syncthing service or account access is implied."},
  {id: "dropbox-onedrive", name: "Dropbox / OneDrive", mode: "manual", verification: "contract-only", remoteContacted: false, note: "OS-level file sync remains external; resolve preserved versions before accepting a replacement."},
  {id: "obsidian-sync-publish", name: "Obsidian Sync / Publish", mode: "unsupported", verification: "contract-only", remoteContacted: false, note: "No proprietary Sync or Publish access is claimed; this app does not contact those services."},
];

export function syncToolDispositions(): SyncToolDisposition[] {
  return DISPOSITIONS.map((disposition) => ({...disposition}));
}
