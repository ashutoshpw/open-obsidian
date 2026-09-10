import type {OpenObsidianAPI} from "../shared/api.js";

type OpenObsidianWindow = Window & {openObsidian?: OpenObsidianAPI};

const api = (window as unknown as OpenObsidianWindow).openObsidian;
const button = document.querySelector<HTMLButtonElement>("#select-vault");
const status = document.querySelector<HTMLDivElement>("#status");
type VaultSummary = Exclude<Awaited<ReturnType<OpenObsidianAPI["selectVault"]>>, null>;

function setStatus(message: string): void {
  if (status) status.textContent = message;
}

function gitSummaryMessage(git: VaultSummary["git"]): string {
  if (git.vaultType !== "chronicle") return "Standard";
  return git.dirty ? "Chronicle · dirty" : "Chronicle · clean";
}

function scanSummaryMessage(summary: VaultSummary): string {
  return summary.unchanged ? "no-op scan verified" : "changed during scan";
}

function summaryMessage(summary: Awaited<ReturnType<OpenObsidianAPI["selectVault"]>>): string {
  if (!summary) return "No vault selected.";
  return `Opened ${summary.root} · ${gitSummaryMessage(summary.git)} · ${summary.fileCount} files · ${scanSummaryMessage(summary)} · ${summary.sha256.slice(0, 12)}…`;
}

async function openSelectedVault(client: OpenObsidianAPI, trigger: HTMLButtonElement): Promise<void> {
  trigger.disabled = true;
  setStatus("Scanning selected vault without changing its files…");
  try {
    setStatus(summaryMessage(await client.selectVault()));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Unable to open the vault.");
  } finally {
    trigger.disabled = false;
  }
}

if (api && button) button.addEventListener("click", () => void openSelectedVault(api, button));
