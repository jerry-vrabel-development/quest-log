/**
 * Files for moments (photos, music files, recordings), kept in the device's own storage
 * (IndexedDB), keyed by moment id. Photos are resized on the device before saving.
 * (Cloud backup to R2 is a later step; until then files stay on the device that saved them.)
 */
import { NS } from "./demo";

const DB = NS + "quest-log-media";
/** Named "photos" for history; it holds every kind of moment file. */
const STORE = "photos";
/** Longest side of a saved photo, in pixels. */
export const PHOTO_MAX = 1600;

let dbp: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("IndexedDB unavailable"));
    };
  });
  return dbp;
}

/**
 * Runs one request. Writes resolve only once the transaction commits, so a file counts as saved
 * only when it would survive the app closing or reloading right away.
 */
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await db()).transaction(STORE, mode);
  return new Promise((resolve, reject) => {
    const req = fn(tx.objectStore(STORE));
    const fail = () => {
      reject(req.error ?? tx.error ?? new Error("IndexedDB request failed"));
    };
    req.onerror = fail;
    tx.onabort = fail;
    if (mode === "readonly")
      req.onsuccess = () => {
        resolve(req.result);
      };
    else
      tx.oncomplete = () => {
        resolve(req.result);
      };
  });
}

/** Ids of moments whose file is on this device. */
const local = new Set<string>();

let indexLoaded: Promise<void> | undefined;

/** Lists the files on this device (once; later calls wait for the same listing). */
export function loadMediaIndex(): Promise<void> {
  indexLoaded ??= (async () => {
    try {
      for (const k of await run("readonly", (s) => s.getAllKeys())) if (typeof k === "string") local.add(k);
    } catch {
      /* no IndexedDB (private mode): files just aren't available */
    }
  })();
  return indexLoaded;
}

export const hasLocalMedia = (id: string): boolean => local.has(id);

export async function saveMedia(id: string, blob: Blob): Promise<void> {
  await run("readwrite", (s) => s.put(blob, id));
  local.add(id);
  // Ask the browser to keep this storage, so files aren't cleared to free space.
  if ("storage" in navigator && "persist" in navigator.storage) void navigator.storage.persist();
}

export async function getMedia(id: string): Promise<Blob | undefined> {
  try {
    return (await run("readonly", (s) => s.get(id))) as Blob | undefined;
  } catch {
    return undefined;
  }
}

export async function deleteMedia(id: string): Promise<void> {
  local.delete(id);
  try {
    await run("readwrite", (s) => s.delete(id));
  } catch {
    /* already gone */
  }
}

/** Scales a photo so its longest side is at most PHOTO_MAX, as JPEG. */
export async function resizePhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Couldn't process that photo"));
      },
      "image/jpeg",
      0.85,
    );
  });
}

/** Puts a saved photo into an <img>, cleaning up the temporary URL once it has loaded. */
export async function showPhoto(img: HTMLImageElement, id: string): Promise<boolean> {
  const blob = await getMedia(id);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  img.addEventListener(
    "load",
    () => {
      URL.revokeObjectURL(url);
    },
    { once: true },
  );
  img.src = url;
  return true;
}

/**
 * Files recorded in the browser (MediaRecorder WebM) don't store their length, so players show
 * "infinite" and can't seek. Asking for a time past the end makes the browser find the real length.
 */
export function fixDuration(player: HTMLMediaElement): void {
  player.addEventListener(
    "loadedmetadata",
    () => {
      if (player.duration !== Infinity) return;
      player.addEventListener(
        "durationchange",
        () => {
          player.currentTime = 0;
        },
        { once: true },
      );
      player.currentTime = Number.MAX_SAFE_INTEGER;
    },
    { once: true },
  );
}

/** Puts a saved music file, recording or video into a player. (The URL lives as long as the page.) */
export async function showPlayable(player: HTMLMediaElement, id: string): Promise<boolean> {
  const blob = await getMedia(id);
  if (!blob) return false;
  fixDuration(player);
  player.src = URL.createObjectURL(blob);
  return true;
}

export interface VideoInfo {
  seconds: number;
  width: number;
  height: number;
}

/** Reads a video file's length and size (seconds is NaN if the browser can't play it). */
export function videoInfo(file: Blob): Promise<VideoInfo> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const done = (info: VideoInfo) => {
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
      resolve(info);
    };
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      done({ seconds: v.duration, width: v.videoWidth, height: v.videoHeight });
    };
    v.onerror = () => {
      done({ seconds: Number.NaN, width: 0, height: 0 });
    };
    v.src = url;
  });
}
