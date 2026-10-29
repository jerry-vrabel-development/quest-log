// The welcome flow (#84): first launch asks your name, what matters and what would help, then
// builds starter quests to fit. Never in the demo, never by surprise for someone already using the app.
import { AREAS, HELPS, applyWelcome, cleanAnswers, shouldWelcome, skipWelcome } from "../core/welcome";
import { DEMO } from "./demo";
import { $, isCancel } from "./dom";
import { render } from "./render";
import { whenBegun } from "./session";
import { S, prefs, save, today } from "./store";

const WELCOME_KEY = "quest-log-welcome";
const dialog = () => $<HTMLDialogElement>("#welcome");

function choice(name: string, value: string, text: string): HTMLLabelElement {
  const label = document.createElement("label");
  const box = Object.assign(document.createElement("input"), { type: "checkbox", name, value });
  label.append(box, ` ${text}`);
  return label;
}

/** Opens the welcome, filled in with any earlier answers. */
export function openWelcome(): void {
  const p = S.profile;
  $<HTMLInputElement>("#welcomeName").value = p?.name ?? "";
  const known = new Set<string>(AREAS.map((a) => a.id));
  $<HTMLInputElement>("#welcomeOther").value = p?.areas.find((a) => !known.has(a)) ?? "";
  for (const box of document.querySelectorAll<HTMLInputElement>("#welcome input[type=checkbox]"))
    box.checked = !!(box.name === "area" ? p?.areas.includes(box.value) : p?.helps.includes(box.value));
  dialog().showModal();
  $<HTMLInputElement>("#welcomeName").focus();
}

export function initWelcome(): void {
  $("#welcomeAreas").append(...AREAS.map((a) => choice("area", a.id, `${a.icon} ${a.id}`)));
  $("#welcomeHelps").append(...HELPS.map((h) => choice("help", h.id, h.label)));

  $<HTMLFormElement>("#welcomeForm").addEventListener("submit", (e) => {
    const now = Date.now();
    if (isCancel(e)) {
      skipWelcome(S, now);
    } else {
      const checked = (name: string) =>
        [...document.querySelectorAll<HTMLInputElement>(`#welcome input[name=${name}]:checked`)].map((b) => b.value);
      const other = $<HTMLInputElement>("#welcomeOther").value;
      applyWelcome(
        S,
        { name: $<HTMLInputElement>("#welcomeName").value, areas: [...checked("area"), other], helps: checked("help") },
        today(),
        now,
      );
    }
    prefs.set(WELCOME_KEY, "0");
    save();
    render();
  });

  const nameBox = $<HTMLInputElement>("#profileName");
  // Settings shows the current name each time it opens (it may have come from the welcome, or another device).
  $("#settingsBtn").addEventListener("click", () => (nameBox.value = S.profile?.name ?? ""));
  nameBox.addEventListener("change", () => {
    const { name } = cleanAnswers({ name: nameBox.value, areas: [], helps: [] });
    S.profile = { areas: [], helps: [], ...S.profile, at: S.profile?.at ?? Date.now(), ...(name ? { name } : {}) };
    if (!name) delete S.profile.name;
    save();
    render();
  });
  $("#profileRerun").onclick = () => {
    $<HTMLDialogElement>("#settings").close();
    openWelcome();
  };

  if (!DEMO && shouldWelcome(S) && prefs.get(WELCOME_KEY) !== "0") whenBegun(openWelcome);
}
