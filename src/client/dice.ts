/**
 * The "Frozen?" dice. When you're stuck, roll and let the die pick one tiny step;
 * you can roll again, or commit to two minutes. Finishing earns the freeze XP and a celebration.
 *
 * The die is a CSS 3D cube. A roll tosses it (a bounce keyframe on the wrapper) while the cube
 * spins whole turns and eases onto the chosen face, with a clack on each bounce.
 */
import { diceCandidates, roll, rollFace, type DicePick } from "../core/dice";
import { finishFreeze } from "./actions";
import { prefersReducedMotion } from "./confetti";
import { $, el } from "./dom";
import { buzz, playClack, playLand, playMarker, playTimeUp } from "./sound";
import { S, today } from "./store";

const ROLL_MS = 1300;
/** When the die hits the table, as fractions of the roll (matches the dice-toss keyframes). */
const BOUNCES = [0.38, 0.62, 0.8, 0.92];
const TWO_MINUTES = 120;

/** Pip positions on a 3x3 grid (0 = top left, 8 = bottom right) for each face. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
/** The cube rotation [x, y] in degrees that brings each face to the front. */
const SHOW: Record<number, [number, number]> = {
  1: [0, 0],
  2: [0, -90],
  3: [-90, 0],
  4: [90, 0],
  5: [0, 90],
  6: [0, 180],
};

const dialog = () => $<HTMLDialogElement>("#dice");
let pick: DicePick | undefined;
let face: number | undefined;
let turns = 0;
let rolling = false;
let timer: ReturnType<typeof setInterval> | undefined;
let pending: ReturnType<typeof setTimeout>[] = [];

function clearTimers(): void {
  clearInterval(timer);
  timer = undefined;
  pending.forEach(clearTimeout);
  pending = [];
}
const later = (ms: number, fn: () => void) => pending.push(setTimeout(fn, ms));

function setStage(stage: "rolling" | "landed" | "doing"): void {
  dialog().dataset.stage = stage;
  $("#diceRoll").hidden = stage === "doing";
  $("#diceGo").hidden = stage !== "landed";
  $("#diceDone").hidden = stage !== "doing";
  $<HTMLButtonElement>("#diceRoll").disabled = stage === "rolling";
  $("#diceTimer").hidden = stage !== "doing";
}

function showPick(p: DicePick): void {
  $("#diceStep").textContent = p.step;
  $("#diceFrom").textContent = p.questName ? `From: ${p.questName}` : "A quick reset";
}

/** Builds the six faces once. */
function buildCube(): void {
  const cube = $("#diceCube");
  if (cube.childElementCount) return;
  for (let f = 1; f <= 6; f++) {
    const side = el("div", `die-face f${f}`);
    for (let i = 0; i < 9; i++) side.append(el("i", PIPS[f].includes(i) ? "pip" : ""));
    cube.append(side);
  }
}

function aim(f: number, spin: number): void {
  const [x, y] = SHOW[f] ?? [0, 0];
  $("#diceCube").style.transform = `rotateX(${x + 360 * spin}deg) rotateY(${y + 360 * spin}deg)`;
}

function doRoll(): void {
  if (rolling) return;
  const next = roll(diceCandidates(S.quests, today()), Math.random, pick);
  const nextFace = rollFace(Math.random, face);
  pick = next;
  face = nextFace;
  const cube = $("#diceCube");
  const toss = $("#diceToss");
  $("#diceStep").textContent = "";
  $("#diceFrom").textContent = "";

  if (prefersReducedMotion()) {
    cube.style.transition = "none";
    aim(nextFace, 0);
    playLand();
    showPick(next);
    setStage("landed");
    return;
  }

  rolling = true;
  setStage("rolling");
  turns += 2; // two whole tumbles on each axis, then ease onto the face
  cube.style.transition = `transform ${ROLL_MS}ms cubic-bezier(0.2, 0.7, 0.25, 1)`;
  aim(nextFace, turns);
  toss.classList.remove("tossing");
  toss.getBoundingClientRect(); // force a reflow so the toss animation restarts
  toss.classList.add("tossing");

  BOUNCES.forEach((at, i) => {
    later(ROLL_MS * at, () => {
      playClack(1 - i * 0.22);
    });
  });
  later(ROLL_MS, () => {
    rolling = false;
    playLand();
    buzz("small");
    showPick(next);
    setStage("landed");
  });
}

function startTwoMinutes(): void {
  playMarker();
  buzz("marker");
  setStage("doing");
  let left = TWO_MINUTES;
  const show = () => {
    $("#diceTimer").textContent =
      left > 0 ?
        `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
      : "Two minutes! Keep going, or call it done.";
  };
  show();
  timer = setInterval(() => {
    left--;
    show();
    if (left <= 0) {
      clearInterval(timer);
      playTimeUp();
      buzz("good");
    }
  }, 1000);
}

function finish(): void {
  const step = pick?.step;
  clearTimers();
  dialog().close();
  finishFreeze(step);
}

export function openDice(): void {
  pick = undefined;
  buildCube();
  dialog().showModal();
  doRoll();
}

export function initDice(): void {
  $("#diceRoll").onclick = doRoll;
  $("#diceGo").onclick = startTwoMinutes;
  $("#diceDone").onclick = finish;
  dialog().addEventListener("close", () => {
    clearTimers();
    rolling = false;
  });
}
