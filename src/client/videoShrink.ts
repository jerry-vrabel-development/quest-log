/**
 * Shrinks a phone video on the device: plays it into a smaller canvas and records that with the
 * browser's own encoder (MediaRecorder), sound included. It runs in real time, so a 20-second clip
 * takes about 20 seconds. Nothing is played out loud while it works.
 */
import { VIDEO_BITRATE, shrinkSize } from "../core/moments";

/** The best format this browser can record video in: MP4 (H.264/AAC) on Safari, WebM elsewhere. */
function recordType(): string | undefined {
  return [
    "video/mp4;codecs=avc1,mp4a",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ].find((t) => MediaRecorder.isTypeSupported(t));
}

export const canShrink = (): boolean =>
  typeof MediaRecorder !== "undefined" &&
  "captureStream" in HTMLCanvasElement.prototype &&
  typeof AudioContext !== "undefined";

/** Re-encodes `file` smaller. `onProgress` gets 0–1 as it goes. */
export async function shrinkVideo(file: Blob, onProgress: (done: number) => void): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => {
      resolve();
    };
    video.onerror = () => {
      reject(new Error("Couldn't open the video"));
    };
  });

  const { width, height } = shrinkSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");

  // Sound goes to the recording, not the speaker.
  const audio = new AudioContext();
  const sink = audio.createMediaStreamDestination();
  audio.createMediaElementSource(video).connect(sink);
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...sink.stream.getAudioTracks()]);

  const type = recordType();
  const recorder = new MediaRecorder(stream, {
    ...(type ? { mimeType: type } : {}),
    videoBitsPerSecond: VIDEO_BITRATE,
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => {
      resolve();
    };
  });

  let drawing = true;
  const draw = () => {
    if (!drawing) return;
    ctx.drawImage(video, 0, 0, width, height);
    if (video.duration) onProgress(Math.min(1, video.currentTime / video.duration));
    requestAnimationFrame(draw);
  };

  try {
    await audio.resume();
    recorder.start(1000);
    await video.play();
    draw();
    await new Promise<void>((resolve, reject) => {
      video.onended = () => {
        resolve();
      };
      video.onerror = () => {
        reject(new Error("Playback failed"));
      };
    });
    ctx.drawImage(video, 0, 0, width, height);
    recorder.stop();
    await stopped;
  } finally {
    drawing = false;
    for (const t of stream.getTracks()) t.stop();
    void audio.close();
    URL.revokeObjectURL(url);
  }
  onProgress(1);
  return new Blob(chunks, { type: recorder.mimeType || type || "video/webm" });
}
