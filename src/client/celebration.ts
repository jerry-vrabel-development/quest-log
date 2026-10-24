/**
 * Turns a celebration tier into what you see, hear and feel:
 *   small   → chime + toast
 *   good    → chord + confetti burst + toast
 *   jackpot → drum roll, a loot chest that shakes and bursts open, fanfare, big confetti
 */
import type { Celebration } from "../core/celebrate";
import type { Memory } from "../core/memories";
import type { LootItem } from "../core/types";
import { confetti, prefersReducedMotion } from "./confetti";
import { el, fmtDay } from "./dom";
import { buzz, playReward } from "./sound";
import { toastQueue, type ToastItem } from "./toast";

/** Pause between the marker click and the payoff, so they read as two beats. */
const REWARD_DELAY_MS = 150;
const CHEST_OPEN_MS = 650;

export interface Payout {
  celebration: Celebration;
  item: LootItem | null;
  /** Shown as toasts for small and good moments (the chest shows the reasons and the loot instead). */
  toasts: ToastItem[];
  /** A memory from the user's own record, if this moment brings one back. */
  memory?: Memory | null;
}

/** "From your record · Fri, Oct 23" */
const memoryLabel = (m: Memory) => `From your record · ${fmtDay(m.day)}`;

export function celebrate({ celebration, item, toasts, memory = null }: Payout): void {
  const { tier } = celebration;
  setTimeout(() => {
    playReward(tier);
    buzz(tier);
    if (tier === "jackpot") {
      openChest(celebration.reasons, item, memory);
      return;
    }
    if (tier === "good") confetti(50);
    toastQueue(memory ? [...toasts, ["memory", `${fmtDay(memory.day)} · ${memory.headline}`, memory.detail]] : toasts);
  }, REWARD_DELAY_MS);
}

let open: HTMLDialogElement | null = null;

/**
 * The full-screen loot chest for jackpots: a native modal <dialog>, so the browser traps focus,
 * closes it on Esc, and returns focus to where it was. Tap anywhere or "Collect" to close.
 */
function openChest(reasons: string[], item: LootItem | null, memory: Memory | null): void {
  open?.close();
  const overlay = el("dialog", "chest-overlay");
  overlay.setAttribute("aria-label", reasons[0] ?? "Jackpot");
  if (item) overlay.dataset.rarity = item.rar;

  const card = el("div", "chest-card");
  const stage = el("div", "chest-stage");
  stage.append(el("div", "chest-rays"), chestArt());
  card.append(stage, el("div", "chest-kicker", "Jackpot"), el("h2", "chest-title", reasons[0] ?? "Jackpot!"));

  if (item) {
    const loot = el("div", `chest-loot r-${item.rar}`);
    loot.append(el("span", "chest-rar", item.rar), el("b", "", item.n), el("span", "chest-desc", item.d));
    card.append(loot);
  }
  if (memory) {
    const mem = el("div", "chest-memory");
    mem.append(el("span", "chest-memory-label", memoryLabel(memory)), el("b", "", memory.headline));
    if (memory.detail) mem.append(el("span", "chest-memory-detail", memory.detail));
    card.append(mem);
  }
  if (reasons.length > 1) {
    const ul = el("ul", "chest-more");
    for (const r of reasons.slice(1)) ul.append(el("li", "", r));
    card.append(ul);
  }
  const collect = el("button", "btn chest-collect", "Collect");
  collect.type = "button";
  card.append(collect);
  overlay.append(card);
  document.body.append(overlay);
  open = overlay;

  overlay.addEventListener("close", () => {
    overlay.remove();
    if (open === overlay) open = null;
  });
  overlay.addEventListener("click", () => {
    overlay.close();
  });
  overlay.showModal();
  collect.focus();

  if (prefersReducedMotion()) {
    overlay.classList.add("opened");
    return;
  }
  setTimeout(() => {
    overlay.classList.add("opened");
    const box = stage.getBoundingClientRect();
    // Draw inside the dialog: a modal dialog sits in the top layer, above anything on <body>.
    confetti(180, { x: box.left + box.width / 2, y: box.top + box.height / 2 }, overlay);
    setTimeout(() => {
      confetti(120, undefined, overlay);
    }, 450);
  }, CHEST_OPEN_MS);
}

/** A treasure chest drawn in CSS: lid, body, lock. */
function chestArt(): HTMLElement {
  const chest = el("div", "chest");
  chest.setAttribute("aria-hidden", "true");
  chest.append(el("div", "chest-lid"), el("div", "chest-body"), el("div", "chest-lock"));
  return chest;
}
