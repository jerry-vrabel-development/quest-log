// Settings → Connect an AI assistant: the connector setup steps, inside the app instead of the README (#80).
// Needs sync, because the assistant talks to the synced quests on the server.
import { $ } from "./dom";

/** The connector address for this deployment. */
export const connectorUrl = (): string => `${location.origin}/mcp`;

let codeOf: () => string | undefined = () => undefined;

async function copy(text: string, done: string): Promise<void> {
  const status = $("#assistStatus");
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = done;
  } catch {
    status.textContent = `Couldn't copy automatically. Select it and copy: ${text}`;
  }
}

/** Shows the steps when sync is on, or the "turn on sync first" note when it's off. */
export function updateAssistantUI(visible: boolean, syncOn: boolean): void {
  const box = document.querySelector<HTMLElement>("#assistBox");
  if (!box) return;
  box.hidden = !visible;
  $("#assistOff").hidden = syncOn;
  $("#assistSteps").hidden = !syncOn;
  $("#assistNote").hidden = !syncOn;
  if (!syncOn) $("#assistStatus").textContent = "";
}

export function initAssistant(getCode: () => string | undefined): void {
  codeOf = getCode;
  $("#assistUrl").textContent = connectorUrl();
  $("#assistCopyUrl").onclick = () => void copy(connectorUrl(), "Address copied. Paste it as the connector URL.");
  $("#assistCopyCode").onclick = () => {
    const code = codeOf();
    if (code) void copy(code, "Sync code copied. Paste it only into Quest Log's own page.");
  };
}
