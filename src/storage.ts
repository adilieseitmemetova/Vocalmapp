import type { Marker, Song } from "./types";

const SONGS_STORAGE_KEY = "vocalmap:songs:v1";
const CUSTOM_MARKERS_STORAGE_KEY = "vocalmap:custom-markers:v1";
const AUDIO_DB_NAME = "vocalmap-audio";
const LEGACY_STORAGE_PREFIX = ["vocal", "song", "markup"].join("-");
const LEGACY_SONGS_STORAGE_KEY = `${LEGACY_STORAGE_PREFIX}:songs:v1`;
const LEGACY_CUSTOM_MARKERS_STORAGE_KEY = `${LEGACY_STORAGE_PREFIX}:custom-markers:v1`;
const LEGACY_AUDIO_DB_NAME = `${LEGACY_STORAGE_PREFIX}-audio`;
const AUDIO_STORE_NAME = "audio-blobs";

export function loadSongs() {
  try {
    const raw = localStorage.getItem(SONGS_STORAGE_KEY) ?? localStorage.getItem(LEGACY_SONGS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const songs = JSON.parse(raw) as Song[];
    if (!localStorage.getItem(SONGS_STORAGE_KEY)) {
      saveSongs(songs);
    }
    return songs;
  } catch {
    return [];
  }
}

export function saveSongs(songs: Song[]) {
  localStorage.setItem(SONGS_STORAGE_KEY, JSON.stringify(songs));
}

export function loadCustomMarkers() {
  try {
    const raw = localStorage.getItem(CUSTOM_MARKERS_STORAGE_KEY) ?? localStorage.getItem(LEGACY_CUSTOM_MARKERS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const markers = JSON.parse(raw) as Marker[];
    if (!localStorage.getItem(CUSTOM_MARKERS_STORAGE_KEY)) {
      saveCustomMarkers(markers);
    }
    return markers;
  } catch {
    return [];
  }
}

export function saveCustomMarkers(markers: Marker[]) {
  localStorage.setItem(CUSTOM_MARKERS_STORAGE_KEY, JSON.stringify(markers));
}

function openNamedAudioDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);

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

function openAudioDb() {
  return openNamedAudioDb(AUDIO_DB_NAME);
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
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readonly");
    const request = tx.objectStore(AUDIO_STORE_NAME).get(storageKey);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());

  if (blob) {
    return blob;
  }

  const legacyDb = await openNamedAudioDb(LEGACY_AUDIO_DB_NAME);
  const legacyBlob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = legacyDb.transaction(AUDIO_STORE_NAME, "readonly");
    const request = tx.objectStore(AUDIO_STORE_NAME).get(storageKey);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  }).finally(() => legacyDb.close());

  if (legacyBlob) {
    await putAudioBlob(storageKey, legacyBlob);
  }

  return legacyBlob;
}

export async function deleteAudioBlob(storageKey: string) {
  const db = await openAudioDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE_NAME, "readwrite");
    tx.objectStore(AUDIO_STORE_NAME).delete(storageKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());

  const legacyDb = await openNamedAudioDb(LEGACY_AUDIO_DB_NAME);
  return new Promise<void>((resolve, reject) => {
    const tx = legacyDb.transaction(AUDIO_STORE_NAME, "readwrite");
    tx.objectStore(AUDIO_STORE_NAME).delete(storageKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }).finally(() => legacyDb.close());
}
