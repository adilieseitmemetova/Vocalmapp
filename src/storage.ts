import type { Marker, Song } from "./types";

const SONGS_STORAGE_KEY = "vocal-song-markup:songs:v1";
const CUSTOM_MARKERS_STORAGE_KEY = "vocal-song-markup:custom-markers:v1";
const AUDIO_DB_NAME = "vocal-song-markup-audio";
const AUDIO_STORE_NAME = "audio-blobs";

export function loadSongs() {
  try {
    const raw = localStorage.getItem(SONGS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as Song[];
  } catch {
    return [];
  }
}

export function saveSongs(songs: Song[]) {
  localStorage.setItem(SONGS_STORAGE_KEY, JSON.stringify(songs));
}

export function loadCustomMarkers() {
  try {
    const raw = localStorage.getItem(CUSTOM_MARKERS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    return JSON.parse(raw) as Marker[];
  } catch {
    return [];
  }
}

export function saveCustomMarkers(markers: Marker[]) {
  localStorage.setItem(CUSTOM_MARKERS_STORAGE_KEY, JSON.stringify(markers));
}

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUDIO_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
        db.createObjectStore(AUDIO_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putAudioBlob(storageKey: string, blob: Blob) {
  const db = await openAudioDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
    tx.objectStore(AUDIO_STORE_NAME).put(blob, storageKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

export async function getAudioBlob(storageKey: string) {
  const db = await openAudioDb();
  return new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readonly");
    const request = tx.objectStore(AUDIO_STORE_NAME).get(storageKey);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export async function deleteAudioBlob(storageKey: string) {
  const db = await openAudioDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
    tx.objectStore(AUDIO_STORE_NAME).delete(storageKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}
