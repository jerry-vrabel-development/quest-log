// @ts-check
/** The reward toast, with a queue so several rewards play one after another. */
import { LOOT } from "./core/rules.js";
import { $ } from "./dom.js";

/** @typedef {[kind: string, title: string, desc: string]} ToastItem */

const BIG = new Set(["legendary", "epic", "badge"]);
const colorFor = (/** @type {string} */ kind) =>
  kind === "legendary" ? "legend"
  : kind === "badge" ? "epic"
  : kind in LOOT ? kind
  : "accent";

/** @type {ReturnType<typeof setTimeout> | undefined} */
let hideTimer;

/** Shows one toast right away. @param {string} kind @param {string} title @param {string} desc */
export function toast(kind, title, desc) {
  const label = $("#trar");
  label.textContent = kind;
  label.style.color = `var(--${colorFor(kind)})`;
  $("#tttl").textContent = title;
  $("#td").textContent = desc;
  const box = $("#toast");
  box.classList.add("show");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => box.classList.remove("show"), BIG.has(kind) ? 6000 : 3500);
}

/** @type {ToastItem[]} */
const queue = [];
/** @type {ReturnType<typeof setTimeout> | null} */
let queueTimer = null;

/** Plays toasts in order; big rewards stay up longer. @param {ToastItem[]} items */
export function toastQueue(items) {
  queue.push(...items);
  if (queueTimer) return;
  const next = () => {
    const it = queue.shift();
    if (!it) {
      queueTimer = null;
      return;
    }
    toast(...it);
    queueTimer = setTimeout(next, BIG.has(it[0]) ? 6200 : 3700);
  };
  next();
}
