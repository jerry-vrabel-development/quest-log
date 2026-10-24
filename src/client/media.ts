/**
 * Photos for moments, kept in the device's own storage (IndexedDB), keyed by moment id.
 * Images are resized on the device before saving, so a phone photo takes a few hundred KB.
 * (Cloud backup to R2 is a later step; until then images stay on the device that took them.)
 */
const DB = "quest-log-media";
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

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error("IndexedDB request failed"));
    };
  });
}

/** Ids of moments whose photo is on this device (memory drops skip the rest). */
const local = new Set<string>();

export async function loadPhotoIndex(): Promise<void> {
  try {
    for (const k of await run("readonly", (s) => s.getAllKeys())) if (typeof k === "string") local.add(k);
  } catch {
    /* no IndexedDB (private mode): photos just aren't available */
  }
}

export const hasPhoto = (id: string): boolean => local.has(id);

export async function savePhoto(id: string, blob: Blob): Promise<void> {
  await run("readwrite", (s) => s.put(blob, id));
  local.add(id);
  // Ask the browser to keep this storage, so photos aren't cleared to free space.
  if ("storage" in navigator && "persist" in navigator.storage) void navigator.storage.persist();
}

export async function getPhoto(id: string): Promise<Blob | undefined> {
  try {
    return (await run("readonly", (s) => s.get(id))) as Blob | undefined;
  } catch {
    return undefined;
  }
}

export async function deletePhoto(id: string): Promise<void> {
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
  const blob = await getPhoto(id);
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
