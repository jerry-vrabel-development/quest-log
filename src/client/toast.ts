/** The reward toast, with a queue so several rewards play one after another. */
import { LOOT } from "../core/rules";
import { $ } from "./dom";

export type ToastItem = [kind: string, title: string, desc: string];

const BIG = new Set(["legendary", "epic", "badge", "memory"]);
const colorFor = (kind: string) =>
  kind === "legendary" ? "legend"
  : kind === "badge" ? "epic"
  : kind in LOOT ? kind
  : "accent";

let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows one toast right away. */
export function toast(kind: string, title: string, desc: string): void {
  const label = $("#trar");
  label.textContent = kind === "memory" ? "from your record" : kind;
  label.style.color = `var(--${colorFor(kind)})`;
  $("#tttl").textContent = title;
  $("#td").textContent = desc;
  const box = $("#toast");
  box.classList.add("show");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => box.classList.remove("show"), BIG.has(kind) ? 6000 : 3500);
}

const queue: ToastItem[] = [];
let queueTimer: ReturnType<typeof setTimeout> | null = null;

/** Plays toasts in order; big rewards stay up longer. */
export function toastQueue(items: ToastItem[]): void {
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
