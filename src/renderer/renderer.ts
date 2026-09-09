import type {OpenObsidianAPI} from "../shared/api.js";

type OpenObsidianWindow = Window & {openObsidian?: OpenObsidianAPI};

const api = (window as unknown as OpenObsidianWindow).openObsidian;
const button = document.querySelector<HTMLButtonElement>("#select-vault");
const status = document.querySelector<HTMLDivElement>("#status");

function setStatus(message: string): void {
  if (status) status.textContent = message;
}

function summaryMessage(summary: Awaited<ReturnType<OpenObsidianAPI["selectVault"]>>): string {
  if (!summary) return "No vault selected.";
  return `Opened ${summary.root} · ${summary.fileCount} files · ${summary.unchanged ? "no-op scan verified" : "changed during scan"} · ${summary.sha256.slice(0, 12)}…`;
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
