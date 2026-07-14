"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  ExternalLink,
  FileText,
  Library,
  Loader2,
  LogOut,
  Mic,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  Upload,
  UserRound,
  X
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { SongSearch } from "@/components/SongSearch";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import {
  LYRICS_TOKENIZER_VERSION,
  buildLyrics,
  findLyricsForTrack,
  lineWordCountsFromText,
  lyricsToText,
  syncedLyricsToPlainText
} from "@/lyrics";
import type { TablesInsert } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { MARKER_ICON_OPTIONS, markerIcons } from "@/markers";
import type {
  AudioReference,
  InitialVocalMapData,
  LyricsSelection,
  LyricLine,
  LyricWord,
  Marker,
  MarkerIconName,
  SelectedRangeTarget,
  SelectedTarget,
  SelectedWordPoint,
  Song,
  SongDraft,
  TextNote,
  YouTubeVideoSearchResult,
  UserProfile,
  WordAnnotation
} from "@/types";
import type { YouTubePlayerErrorCode } from "@/lib/youtube/types";

const AUDIO_BUCKET = "vocalmap-audio";
const PROFILE_STORAGE_KEY = "vocalmapp:profile:v1";
const MARKER_PREFERENCES_STORAGE_PREFIX = "vocalmapp:marker-preferences";
const ACTIVE_SONG_STORAGE_PREFIX = "vocalmapp:active-song";
const LYRIC_TEXT_SIZE_STORAGE_PREFIX = "vocalmapp:lyric-text-size";
const LYRIC_LINE_SPACING_STORAGE_PREFIX = "vocalmapp:lyric-line-spacing";
const LYRIC_WORD_SPACING_STORAGE_PREFIX = "vocalmapp:lyric-word-spacing";
const DEFAULT_LYRIC_TEXT_SIZE = 18;
const MIN_LYRIC_TEXT_SIZE = 12;
const MAX_LYRIC_TEXT_SIZE = 36;
const DEFAULT_LYRIC_LINE_SPACING = 4;
const MIN_LYRIC_LINE_SPACING = 0;
const MAX_LYRIC_LINE_SPACING = 24;
const DEFAULT_LYRIC_WORD_SPACING = 4;
const MIN_LYRIC_WORD_SPACING = 0;
const MAX_LYRIC_WORD_SPACING = 24;

const EMPTY_DRAFT: SongDraft = {
  title: "",
  artist: "",
  lyricsText: ""
};

const EMPTY_CUSTOM_MARKER: { label: string; meaning: string; color: string; icon: MarkerIconName } = {
  label: "",
  meaning: "",
  color: "#7a48aa",
  icon: "spark"
};
const FALLBACK_MARKER_ICON: MarkerIconName = "spark";
const LEGACY_MARKER_ICONS = new Set<MarkerIconName>(["up", "down", "wave", "line", "breath", "accent", "soft", "strong", "pause", "cut", "repeat", "spark", "volume", "mute"]);

type MarkerDraft = typeof EMPTY_CUSTOM_MARKER;
type MarkerPreferences = {
  hiddenSystemMarkerIds: string[];
  systemOverrides: Record<string, MarkerDraft>;
  markerOrderIds: string[];
};
type SettingsPanel = "markers" | "lyrics";
type AudioProvider = "youtube" | "file";
const systemMarkerCodes = new Set([
  "up",
  "down",
  "vib",
  "hold",
  "breath",
  "accent",
  "soft",
  "strong",
  "slide-up",
  "slide-down",
  "legato",
  "pause",
  "cut",
  "run",
  "mix",
  "head",
  "chest",
  "falsetto",
  "twang",
  "cry",
  "mute"
]);

const primaryButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_26px_rgba(5,150,105,0.22)] transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60";
const secondaryButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-200 hover:bg-emerald-50 active:scale-[0.99] disabled:opacity-60";
const iconButtonClass =
  "inline-grid size-10 flex-none place-items-center rounded-xl border border-stone-200 bg-white text-stone-700 transition hover:border-emerald-200 hover:bg-emerald-50 disabled:opacity-60";
const inputClass =
  "h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100";

function createId() {
  return crypto.randomUUID();
}

function lyricTextSizeStorageKey(userId: string) {
  return `${LYRIC_TEXT_SIZE_STORAGE_PREFIX}:${userId}`;
}

function lyricLineSpacingStorageKey(userId: string) {
  return `${LYRIC_LINE_SPACING_STORAGE_PREFIX}:${userId}`;
}

function lyricWordSpacingStorageKey(userId: string) {
  return `${LYRIC_WORD_SPACING_STORAGE_PREFIX}:${userId}`;
}

function readStoredLyricValue(storageKey: string, fallback: number, clamp: (value: number) => number) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const value = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(value) ? clamp(value) : fallback;
  } catch {
    return fallback;
  }
}

function shouldRetryMarkerIcon(error: { message?: string } | null, icon: MarkerIconName) {
  if (!error || LEGACY_MARKER_ICONS.has(icon)) {
    return false;
  }

  const message = error.message?.toLowerCase() ?? "";
  return message.includes("markers_icon_allowed") || message.includes("check constraint");
}

function applyMarkerOrder(markers: Marker[], markerOrderIds: string[]) {
  if (markerOrderIds.length === 0) {
    return markers;
  }

  const orderIndexById = new Map(markerOrderIds.map((id, index) => [id, index]));
  return [...markers].sort((firstMarker, secondMarker) => {
    const firstIndex = orderIndexById.get(firstMarker.id);
    const secondIndex = orderIndexById.get(secondMarker.id);

    if (firstIndex === undefined && secondIndex === undefined) {
      return 0;
    }

    if (firstIndex === undefined) {
      return 1;
    }

    if (secondIndex === undefined) {
      return -1;
    }

    return firstIndex - secondIndex;
  });
}

function markerIdForPreferenceKey(markers: Marker[], key: string) {
  if (markers.some((marker) => marker.id === key)) {
    return key;
  }

  return markers.find((marker) => marker.isSystem && marker.code === key)?.id ?? key;
}

function normalizeMarkerPreferenceIds(markers: Marker[], markerIds: string[]) {
  const knownMarkerIds = new Set(markers.map((marker) => marker.id));
  const normalizedIds = markerIds.map((id) => markerIdForPreferenceKey(markers, id)).filter((id) => knownMarkerIds.has(id));
  return Array.from(new Set(normalizedIds));
}

function normalizeSystemMarkerOverrides(markers: Marker[], overrides: Record<string, MarkerDraft>) {
  const nextOverrides: Record<string, MarkerDraft> = {};

  for (const [key, value] of Object.entries(overrides)) {
    const markerId = markerIdForPreferenceKey(markers, key);
    const marker = markers.find((item) => item.id === markerId);
    if (marker?.isSystem) {
      nextOverrides[marker.id] = value;
    }
  }

  return nextOverrides;
}

function clampLyricTextSize(size: number) {
  return Math.min(MAX_LYRIC_TEXT_SIZE, Math.max(MIN_LYRIC_TEXT_SIZE, Math.round(size)));
}

function clampLyricLineSpacing(spacing: number) {
  return Math.min(MAX_LYRIC_LINE_SPACING, Math.max(MIN_LYRIC_LINE_SPACING, Math.round(spacing)));
}

function clampLyricWordSpacing(spacing: number) {
  return Math.min(MAX_LYRIC_WORD_SPACING, Math.max(MIN_LYRIC_WORD_SPACING, Math.round(spacing)));
}

function formatDuration(ms?: number) {
  if (!ms) {
    return "0:00";
  }

  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function extensionFromMime(mimeType: string) {
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return "mp3";
  }
  if (mimeType.includes("wav")) {
    return "wav";
  }
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  if (mimeType.includes("mp4") || mimeType.includes("aac")) {
    return "m4a";
  }
  return "webm";
}

function makeMarkerStyle(marker: Marker): CSSProperties {
  return {
    color: marker.color,
    borderColor: `${marker.color}55`,
    backgroundColor: `${marker.color}14`
  };
}

function makeAudioReference(path: string, blob: Blob, label: string, id = createId()): AudioReference {
  const now = new Date().toISOString();

  return {
    id,
    label,
    storagePath: path,
    mimeType: blob.type || "audio/webm",
    sizeBytes: blob.size,
    createdAt: now,
    updatedAt: now
  };
}

function labelFromFileName(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, "").trim();
}

function countMarkedTargets(song: Song) {
  return song.lyrics.reduce((total, line) => {
    const wordCount = line.words.filter((word) => word.annotations.length > 0 || word.audioReference || word.textNote).length;
    return total + wordCount;
  }, 0);
}

function collectAudioPaths(song: Song) {
  const paths = new Set<string>();

  for (const audioReference of song.songAudios) {
    if (audioReference.storagePath) {
      paths.add(audioReference.storagePath);
    }
  }

  for (const line of song.lyrics) {
    for (const word of line.words) {
      if (word.audioReference?.storagePath) {
        paths.add(word.audioReference.storagePath);
      }
    }
  }

  return Array.from(paths);
}

function collectRemovedAudioPaths(previousSong: Song | undefined, nextSong: Song) {
  if (!previousSong) {
    return [];
  }

  const nextPaths = new Set(collectAudioPaths(nextSong));
  return collectAudioPaths(previousSong).filter((path) => !nextPaths.has(path));
}

function getYouTubeVideoId(song: Song) {
  return song.youtubeVideoId ?? "";
}

function markerPreferencesKey(userId: string) {
  return `${MARKER_PREFERENCES_STORAGE_PREFIX}:${userId}`;
}

function activeSongStorageKey(userId: string) {
  return `${ACTIVE_SONG_STORAGE_PREFIX}:${userId}`;
}

function songToDraft(song: Song): SongDraft {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist ?? "",
    lyricsText: lyricsToText(song.lyrics),
    youtubeVideoId: song.youtubeVideoId,
    videoTitle: song.videoTitle,
    channelTitle: song.channelTitle,
    thumbnailUrl: song.thumbnailUrl,
    originalSearchQuery: song.originalSearchQuery,
    selectedVersionType: song.selectedVersionType,
    durationMs: song.durationMs
  };
}

function buildSongFromDraft(draft: SongDraft, fallbackTitle: string, existingSong?: Song): Song {
  const now = new Date().toISOString();
  const id = existingSong?.id ?? createId();
  const lyrics = buildLyrics(draft.lyricsText, existingSong?.lyrics);

  return {
    id,
    trackId: existingSong?.trackId,
    lyricsDocumentId: existingSong?.lyricsDocumentId,
    title: draft.title.trim() || fallbackTitle,
    artist: draft.artist.trim() || undefined,
    youtubeVideoId: draft.youtubeVideoId,
    videoTitle: draft.videoTitle,
    channelTitle: draft.channelTitle,
    thumbnailUrl: draft.thumbnailUrl,
    originalSearchQuery: draft.originalSearchQuery,
    selectedVersionType: draft.selectedVersionType,
    source: draft.youtubeVideoId ? "youtube" : existingSong?.source ?? "manual",
    durationMs: draft.durationMs,
    sourceLyricsText: draft.lyricsText,
    lyrics,
    songAudios: existingSong?.songAudios ?? [],
    createdAt: existingSong?.createdAt ?? now,
    updatedAt: now
  };
}

async function sha256Hex(value: string) {
  if (!crypto.subtle) {
    throw new Error("Web Crypto is required to hash lyrics.");
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

type SelectedWordAddress = {
  line: LyricLine;
  word: LyricWord;
  lineIndex: number;
  wordIndex: number;
};

type TargetCoordinates = {
  userSongId: string;
  lineIndex: number;
  wordIndex: number | null;
};

type SelectedData =
  | {
      type: "word";
      label: string;
      annotations: WordAnnotation[];
      audioReference?: AudioReference;
      textNote?: TextNote;
      timestampMs?: number;
    }
  | {
      type: "range";
      label: string;
      annotations: WordAnnotation[];
      wordTargets: Array<{
        lineId: string;
        wordId: string;
        lineIndex: number;
        wordIndex: number;
        annotations: WordAnnotation[];
        textNote?: TextNote;
      }>;
    };

function selectedTargetKey(target: LyricsSelection | null) {
  if (!target) {
    return "";
  }
  if (target.type === "range") {
    return `${target.songId}:range:${target.anchor.lineId}:${target.anchor.wordId}:${target.focus.lineId}:${target.focus.wordId}`;
  }
  return `${target.songId}:${target.type}:${target.lineId}:${target.wordId ?? ""}`;
}

function sameWordPoint(first: SelectedWordPoint, second: SelectedWordPoint) {
  return first.lineId === second.lineId && first.wordId === second.wordId;
}

function collectWordAddresses(song: Song) {
  const addresses: SelectedWordAddress[] = [];

  song.lyrics.forEach((line, lineIndex) => {
    line.words.forEach((word, wordIndex) => {
      addresses.push({ line, word, lineIndex, wordIndex });
    });
  });

  return addresses;
}

function findWordAddressIndex(addresses: SelectedWordAddress[], point: SelectedWordPoint) {
  return addresses.findIndex((address) => address.line.id === point.lineId && address.word.id === point.wordId);
}

function selectedWordAddresses(song: Song, selection: LyricsSelection | null) {
  if (!selection) {
    return [];
  }

  const addresses = collectWordAddresses(song);
  if (selection.type === "word") {
    const index = findWordAddressIndex(addresses, { lineId: selection.lineId, wordId: selection.wordId });
    return index >= 0 ? [addresses[index]] : [];
  }

  const anchorIndex = findWordAddressIndex(addresses, selection.anchor);
  const focusIndex = findWordAddressIndex(addresses, selection.focus);
  if (anchorIndex < 0 || focusIndex < 0) {
    return [];
  }

  const startIndex = Math.min(anchorIndex, focusIndex);
  const endIndex = Math.max(anchorIndex, focusIndex);
  return addresses.slice(startIndex, endIndex + 1);
}

function getTargetCoordinates(song: Song, target: SelectedTarget): TargetCoordinates | null {
  const lineIndex = song.lyrics.findIndex((line) => line.id === target.lineId);
  if (lineIndex < 0) {
    return null;
  }

  const wordIndex = song.lyrics[lineIndex]?.words.findIndex((word) => word.id === target.wordId) ?? -1;
  if (wordIndex < 0) {
    return null;
  }

  return {
    userSongId: song.id,
    lineIndex,
    wordIndex
  };
}

function buildRangeLabel(addresses: SelectedWordAddress[]) {
  const lineParts: string[] = [];
  let currentLineIndex = -1;

  for (const address of addresses) {
    if (address.lineIndex !== currentLineIndex) {
      currentLineIndex = address.lineIndex;
      lineParts.push(address.word.text);
    } else {
      lineParts[lineParts.length - 1] = `${lineParts[lineParts.length - 1]} ${address.word.text}`;
    }
  }

  return lineParts.join(" / ");
}

function commonRangeAnnotations(addresses: SelectedWordAddress[]) {
  const [firstAddress] = addresses;
  if (!firstAddress) {
    return [];
  }

  return firstAddress.word.annotations.filter((annotation) =>
    addresses.every((address) => address.word.annotations.some((item) => item.markerId === annotation.markerId))
  );
}

function visibleWordAnnotations(line: LyricLine, wordIndex: number) {
  const word = line.words[wordIndex];
  const previousWord = line.words[wordIndex - 1];

  if (!word) {
    return [];
  }

  return word.annotations.filter((annotation) => !previousWord?.annotations.some((previousAnnotation) => previousAnnotation.markerId === annotation.markerId));
}

function continuingWordMarkerIds(line: LyricLine, wordIndex: number) {
  const word = line.words[wordIndex];
  const previousWord = line.words[wordIndex - 1];

  if (!word || !previousWord) {
    return [];
  }

  return word.annotations
    .filter((annotation) => previousWord.annotations.some((previousAnnotation) => previousAnnotation.markerId === annotation.markerId))
    .map((annotation) => annotation.markerId);
}

function selectionShiftAnchor(song: Song | undefined, selection: LyricsSelection | null, songId: string): SelectedWordPoint | null {
  if (!song || !selection || selection.songId !== songId) {
    return null;
  }

  if (selection.type === "word") {
    return { lineId: selection.lineId, wordId: selection.wordId };
  }

  return selection.anchor;
}

function wordPointFromElement(element: Element | null): (SelectedWordPoint & { songId: string }) | null {
  const wordElement = element?.closest<HTMLElement>("[data-song-id][data-line-id][data-word-id]");
  const songId = wordElement?.dataset.songId;
  const lineId = wordElement?.dataset.lineId;
  const wordId = wordElement?.dataset.wordId;

  if (!songId || !lineId || !wordId) {
    return null;
  }

  return { songId, lineId, wordId };
}

function makeWordOrRangeSelection(songId: string, anchor: SelectedWordPoint, focus: SelectedWordPoint, x: number, y: number): LyricsSelection {
  if (sameWordPoint(anchor, focus)) {
    return {
      songId,
      type: "word",
      lineId: focus.lineId,
      wordId: focus.wordId,
      x,
      y
    };
  }

  return {
    songId,
    type: "range",
    anchor,
    focus,
    x,
    y
  };
}

function findSelectedData(song: Song | undefined, selection: LyricsSelection | null): SelectedData | null {
  if (!song || !selection) {
    return null;
  }

  if (selection.type === "range") {
    const addresses = selectedWordAddresses(song, selection);
    if (addresses.length === 0) {
      return null;
    }

    return {
      type: "range",
      label: buildRangeLabel(addresses),
      annotations: commonRangeAnnotations(addresses),
      wordTargets: addresses.map((address) => ({
        lineId: address.line.id,
        wordId: address.word.id,
        lineIndex: address.lineIndex,
        wordIndex: address.wordIndex,
        annotations: address.word.annotations,
        textNote: address.word.textNote
      }))
    };
  }

  const line = song.lyrics.find((item) => item.id === selection.lineId);
  if (!line) {
    return null;
  }

  const word = line.words.find((item) => item.id === selection.wordId);
  if (!word) {
    return null;
  }

  return {
    type: "word" as const,
    label: word.text,
    annotations: word.annotations,
    audioReference: word.audioReference,
    textNote: word.textNote
  };
}

function MarkerBadge({ markerId, markerById, onSeekToTimestamp }: { markerId: string; markerById: Map<string, Marker>; onSeekToTimestamp?: () => void }) {
  const marker = markerById.get(markerId);
  if (!marker) {
    return null;
  }

  const Icon = markerIcons[marker.icon];

  const className = "inline-flex h-5 max-w-28 items-center gap-1 overflow-hidden rounded-full border px-1.5 text-[0.625rem] font-bold leading-none";
  const content = <><Icon size={11} strokeWidth={2.4} /><span className="truncate">{marker.label}</span></>;

  return onSeekToTimestamp ? (
    <button
      className={`${className} transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-emerald-200`}
      type="button"
      style={makeMarkerStyle(marker)}
      title={marker.meaning}
      onClick={(event) => {
        event.stopPropagation();
        onSeekToTimestamp();
      }}
    >
      {content}
    </button>
  ) : (
    <span
      className={className}
      style={makeMarkerStyle(marker)}
      title={marker.meaning}
    >
      {content}
    </span>
  );
}

function AudioDot({ onPlay, title }: { onPlay: () => void; title: string }) {
  return (
    <button
      className="inline-grid size-7 place-items-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100"
      type="button"
      title={title}
      onClick={onPlay}
    >
      <Play size={12} fill="currentColor" />
    </button>
  );
}

function NoteDot({ note, title }: { note: TextNote; title: string }) {
  return (
    <button
      className="inline-grid size-7 place-items-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-100"
      type="button"
      title={`${title}: ${note.text}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <StickyNote size={12} />
    </button>
  );
}

function useAudioUrl(audioReference: AudioReference | undefined, supabase: ReturnType<typeof createClient>) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadAudio() {
      if (!audioReference) {
        setUrl(null);
        return;
      }

      const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(audioReference.storagePath);
      if (error || !data || cancelled) {
        return;
      }

      objectUrl = URL.createObjectURL(data);
      setUrl(objectUrl);
    }

    void loadAudio();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [audioReference, supabase]);

  return url;
}

function LyricsLine({
  line,
  songId,
  onWordPointerDown,
  onWordPointerMove,
  onWordPointerUp,
  onWordPointerCancel,
  onWordKeyboardSelect,
  onSeekToTimestamp,
  onPlayAudio,
  markerById,
  selectedWordIds,
  lyricTextStyle,
  lyricLineStyle,
  lyricWordsStyle,
  labels
}: {
  line: LyricLine;
  songId: string;
  onWordPointerDown: (event: React.PointerEvent<HTMLElement>, lineId: string, wordId: string) => void;
  onWordPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onWordPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onWordPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onWordKeyboardSelect: (lineId: string, wordId: string, element: HTMLElement) => void;
  onSeekToTimestamp: (timestampMs: number) => void;
  onPlayAudio: (audioReference: AudioReference) => void;
  markerById: Map<string, Marker>;
  selectedWordIds: Set<string>;
  lyricTextStyle: CSSProperties;
  lyricLineStyle: CSSProperties;
  lyricWordsStyle: CSSProperties;
  labels: {
    wordAudio: string;
    note: string;
  };
}) {
  return (
    <div
      className="lyrics-line"
      style={lyricLineStyle}
      onDoubleClick={() => {
        const timestampMs = line.words.find((word) => typeof word.timestampMs === "number")?.timestampMs;
        if (typeof timestampMs === "number") onSeekToTimestamp(timestampMs);
      }}
    >
      <div className="flex w-full min-w-0 flex-wrap items-start justify-center gap-y-1 text-[var(--vm-ink)]" style={{ ...lyricTextStyle, ...lyricWordsStyle }}>
          {line.words.length === 0 ? (
            <span className="min-h-[1.7em]" aria-hidden="true" />
          ) : (
            line.words.map((word, wordIndex) => {
            const wordIsSelected = selectedWordIds.has(word.id);
            const hasNextWord = wordIndex < line.words.length - 1;
            const annotationsToShow = visibleWordAnnotations(line, wordIndex);
            const continuingMarkerIds = continuingWordMarkerIds(line, wordIndex);

            return (
              <span className="inline-flex min-w-0 flex-col items-center gap-0.5 rounded-md" key={word.id}>
                <span className="flex min-h-[18px] flex-wrap items-center justify-center gap-1">
                  {continuingMarkerIds.map((markerId) => {
                    const marker = markerById.get(markerId);
                    return (
                      <span
                        className="h-px w-full min-w-8 rounded-full"
                        key={markerId}
                        style={{ backgroundColor: marker?.color ?? "#059669" }}
                        title={marker?.meaning}
                      />
                    );
                  })}
                  {annotationsToShow.map((annotation) => (
                    <MarkerBadge key={annotation.id} markerId={annotation.markerId} markerById={markerById} onSeekToTimestamp={typeof word.timestampMs === "number" ? () => onSeekToTimestamp(word.timestampMs!) : undefined} />
                  ))}
                  {word.audioReference ? <AudioDot onPlay={() => onPlayAudio(word.audioReference!)} title={labels.wordAudio} /> : null}
                  {word.textNote ? <NoteDot note={word.textNote} title={labels.note} /> : null}
                </span>
                <span className="inline-flex items-center">
                  <button
                    className={`max-w-full touch-pan-y select-none rounded-md px-1 py-0.5 leading-tight text-inherit transition focus:outline-none focus:ring-2 focus:ring-emerald-200 ${
                      wordIsSelected ? "bg-emerald-100 ring-2 ring-emerald-200" : "hover:bg-emerald-50 hover:ring-2 hover:ring-emerald-100 focus:bg-emerald-50"
                    }`}
                    type="button"
                    data-song-id={songId}
                    data-line-id={line.id}
                    data-word-id={word.id}
                    onPointerDown={(event) => onWordPointerDown(event, line.id, word.id)}
                    onPointerMove={onWordPointerMove}
                    onPointerUp={onWordPointerUp}
                    onPointerCancel={onWordPointerCancel}
                    onLostPointerCapture={onWordPointerCancel}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (event.detail === 0) {
                        onWordKeyboardSelect(line.id, word.id, event.currentTarget);
                      }
                    }}
                    onDoubleClick={(event) => {
                      if (typeof word.timestampMs === "number") {
                        event.stopPropagation();
                        onSeekToTimestamp(word.timestampMs);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        onWordKeyboardSelect(line.id, word.id, event.currentTarget);
                      }
                    }}
                  >
                    {word.text}
                  </button>
                  {hasNextWord ? (
                    <button
                      className="h-[1.7em] w-3 touch-pan-y select-none rounded transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                      type="button"
                      tabIndex={-1}
                      aria-hidden="true"
                      data-song-id={songId}
                      data-line-id={line.id}
                      data-word-id={word.id}
                      onPointerDown={(event) => onWordPointerDown(event, line.id, word.id)}
                      onPointerMove={onWordPointerMove}
                      onPointerUp={onWordPointerUp}
                      onPointerCancel={onWordPointerCancel}
                      onLostPointerCapture={onWordPointerCancel}
                      onClick={(event) => event.stopPropagation()}
                    />
                  ) : null}
                </span>
              </span>
            );
            })
          )}
      </div>
    </div>
  );
}

function SongMenuCard({
  song,
  onEdit,
  onDelete,
  optionsOpen,
  onToggleOptions,
  labels
}: {
  song: Song;
  onEdit: (song: Song) => void;
  onDelete: (song: Song) => void;
  optionsOpen: boolean;
  onToggleOptions: () => void;
  labels: {
    coverAlt: string;
    noArtist: string;
    lines: string;
    markers: string;
    youtube: string;
    workspaceHint: string;
    edit: string;
    delete: string;
    options: string;
  };
}) {
  return (
    <section className="relative grid gap-3 border-t border-stone-200/80 pt-4 pb-1">
      <div className="relative aspect-square w-full overflow-hidden rounded-[1.125rem] border border-stone-200 bg-stone-100 shadow-[0_10px_24px_rgba(33,63,53,0.10)]">
        {song.thumbnailUrl ? (
          <Image className="size-full object-cover" src={song.thumbnailUrl} alt={labels.coverAlt} width={640} height={640} priority loading="eager" />
        ) : (
          <div className="grid size-full place-items-center bg-stone-50 text-stone-500">
            <Music2 size={28} />
          </div>
        )}
      </div>

      <div className="relative min-w-0 self-center pr-9" data-song-options-menu="true">
        <p className="truncate text-[0.625rem] font-bold uppercase tracking-[0.12em] text-stone-500">{song.artist ?? labels.noArtist}</p>
        <h2 className="mt-1 line-clamp-2 min-w-0 text-base font-semibold leading-5 tracking-[-0.02em] text-stone-950">{song.title}</h2>
        <p className="mt-1.5 truncate text-xs text-stone-500">
          {labels.lines} · {labels.markers}
        </p>
        <button
          className={`absolute right-0 top-0 inline-grid size-7 place-items-center rounded-full border bg-white text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 ${
            optionsOpen ? "border-stone-300 bg-stone-50" : "border-stone-200"
          }`}
          type="button"
          onClick={onToggleOptions}
          aria-expanded={optionsOpen}
          aria-haspopup="menu"
          aria-label={labels.options}
          title={labels.options}
        >
          <Ellipsis size={15} />
        </button>
        {optionsOpen ? (
          <div className="absolute right-0 top-8 z-30 w-48 rounded-xl border border-stone-200 bg-white p-1.5" role="menu">
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-stone-700 transition hover:bg-stone-50"
              type="button"
              onClick={() => onEdit(song)}
              role="menuitem"
            >
              <Pencil size={13} />
              {labels.edit}
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-700 transition hover:bg-red-50"
              type="button"
              onClick={() => onDelete(song)}
              role="menuitem"
            >
              <Trash2 size={13} />
              {labels.delete}
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        {song.youtubeVideoId ? (
          <a
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full bg-stone-950 px-3 text-xs font-semibold text-white transition hover:bg-stone-800"
            href={`https://www.youtube.com/watch?v=${encodeURIComponent(song.youtubeVideoId)}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={13} />
            {labels.youtube}
          </a>
        ) : null}
        <p className="text-center text-[0.6875rem] font-medium leading-4 text-stone-400">{labels.workspaceHint}</p>
      </div>

    </section>
  );
}

function SongPlayerDock({
  song,
  provider,
  selectedAudioId,
  onProviderChange,
  onSelectedAudioChange,
  onUpload,
  onRemove,
  seekRequest,
  onTimeUpdate,
  onPlayerError,
  supabase,
  labels
}: {
  song: Song;
  provider: AudioProvider;
  selectedAudioId: string | null;
  onProviderChange: (provider: AudioProvider) => void;
  onSelectedAudioChange: (audioId: string) => void;
  onUpload: (song: Song, file: File, label: string) => void;
  onRemove: (song: Song, audioReference: AudioReference) => void;
  seekRequest?: { id: number; timeMs: number };
  onTimeUpdate: (timeMs: number) => void;
  onPlayerError: (errorCode: YouTubePlayerErrorCode) => void;
  supabase: ReturnType<typeof createClient>;
  labels: {
    nowPlaying: string;
    youtube: string;
    file: string;
    fileSelect: string;
    noFile: string;
    deleteAudio: string;
    addFile: string;
    audioNameTitle: string;
    audioNameLabel: string;
    audioNamePlaceholder: string;
    audioNameInstrumental: string;
    audioNameOriginal: string;
    audioNameCover: string;
    audioNameRequired: string;
    audioUploadDialogBody: string;
    chooseAudioFile: string;
    changeAudioFile: string;
    noAudioFile: string;
    cancel: string;
    close: string;
    youtubeTitle: string;
    audioNotice: string;
    expand: string;
    collapse: string;
  };
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [pendingUploadLabel, setPendingUploadLabel] = useState("");
  const videoId = getYouTubeVideoId(song);
  const hasYouTube = Boolean(videoId);
  const hasFiles = song.songAudios.length > 0;
  const hasActiveProvider = (provider === "youtube" && hasYouTube) || (provider === "file" && hasFiles);
  const activeAudio = song.songAudios.find((audioReference) => audioReference.id === selectedAudioId) ?? song.songAudios[0];
  const fileUrl = useAudioUrl(provider === "file" ? activeAudio : undefined, supabase);

  useEffect(() => {
    if (!isUploadDialogOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsUploadDialogOpen(false);
        setPendingUpload(null);
        setPendingUploadLabel("");
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isUploadDialogOpen]);

  return (
    <div className="audio-provider-dock">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {song.thumbnailUrl ? <Image className="size-11 flex-none rounded-[0.8rem] object-cover" src={song.thumbnailUrl} alt={labels.nowPlaying} width={44} height={44} /> : <span className="grid size-11 flex-none place-items-center rounded-[0.8rem] bg-stone-100"><Music2 className="text-stone-500" size={20} /></span>}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-[-0.01em] text-stone-950">{song.title}</p>
            <p className="truncate text-xs text-stone-500">{provider === "file" && activeAudio ? activeAudio.label : song.artist ?? labels.nowPlaying}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {hasYouTube ? (
            <button
              className={`inline-flex h-8 items-center justify-center rounded-full border px-2.5 text-[0.6875rem] font-semibold transition sm:px-3 sm:text-xs ${
                provider === "youtube" ? "border-stone-950 bg-stone-950 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"
              }`}
              type="button"
              onClick={() => onProviderChange("youtube")}
            >
              {labels.youtube}
            </button>
          ) : null}
          {hasFiles ? (
            <button
              className={`inline-flex h-8 max-w-36 items-center justify-center rounded-full border px-2.5 text-[0.6875rem] font-semibold transition sm:px-3 sm:text-xs ${
                provider === "file" ? "border-emerald-600 bg-emerald-600 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"
              }`}
              type="button"
              onClick={() => onProviderChange("file")}
              title={activeAudio?.label ?? labels.file}
            >
              <span className="truncate">{activeAudio?.label ?? labels.file}</span>
            </button>
          ) : null}
          <button
            className="audio-provider-upload"
            type="button"
            title={labels.addFile}
            onClick={() => {
              setPendingUpload(null);
              setPendingUploadLabel("");
              setIsUploadDialogOpen(true);
            }}
          >
            <Upload size={14} />
            <span>{labels.addFile}</span>
          </button>
          {hasActiveProvider ? (
            <button
              className="inline-grid size-8 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:border-emerald-200 hover:bg-emerald-50 lg:hidden"
              type="button"
              onClick={() => setIsExpanded((current) => !current)}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? labels.collapse : labels.expand}
              title={isExpanded ? labels.collapse : labels.expand}
            >
              {isExpanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
            </button>
          ) : null}
        </div>
      </div>

      <div className={`audio-provider-body ${hasActiveProvider ? "mt-2" : ""} ${isExpanded ? "is-expanded" : ""}`}>
        {provider === "youtube" && videoId ? (
          <div className="grid gap-2">
            <YouTubePlayer
              videoId={videoId}
              title={labels.youtubeTitle}
              seekRequest={seekRequest}
              onTimeUpdate={onTimeUpdate}
              onError={onPlayerError}
              labels={{
                play: "Play",
                pause: "Pause",
                rewind: "Back 10 seconds",
                forward: "Forward 10 seconds",
                speed: "Playback speed",
                loopStart: "Set loop start",
                loopEnd: "Set loop end",
                clearLoop: "Clear loop",
                playerUnavailable: "Loading the official YouTube player..."
              }}
            />
            <p className="text-xs leading-5 text-stone-500">{labels.audioNotice}</p>
          </div>
        ) : null}
        {provider === "file" && hasFiles ? (
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="flex min-w-0 items-center gap-2">
              {fileUrl ? <audio className="h-10 min-w-0 flex-1" controls src={fileUrl} /> : <p className="min-w-0 flex-1 text-sm text-stone-500">{labels.noFile}</p>}
              {activeAudio ? (
                <button className={`${iconButtonClass} size-10 flex-none rounded-full text-red-700`} type="button" onClick={() => onRemove(song, activeAudio)} title={labels.deleteAudio}>
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
            {song.songAudios.length > 1 ? (
              <select
                className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                value={activeAudio?.id ?? ""}
                onChange={(event) => onSelectedAudioChange(event.target.value)}
                aria-label={labels.fileSelect}
              >
                {song.songAudios.map((audioReference) => (
                  <option key={audioReference.id} value={audioReference.id}>
                    {audioReference.label}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}
      </div>

      {isUploadDialogOpen && typeof document !== "undefined"
        ? createPortal(
        <div
          className="audio-upload-dialog-backdrop"
          onMouseDown={() => {
            setIsUploadDialogOpen(false);
            setPendingUpload(null);
            setPendingUploadLabel("");
          }}
        >
          <section
            className="audio-upload-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`audio-upload-title-${song.id}`}
            aria-describedby={`audio-upload-description-${song.id}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="audio-upload-dialog-header">
              <div>
                <h2 id={`audio-upload-title-${song.id}`}>{labels.audioNameTitle}</h2>
                <p id={`audio-upload-description-${song.id}`}>{labels.audioUploadDialogBody}</p>
              </div>
              <button
                className="audio-upload-dialog-close"
                type="button"
                onClick={() => {
                  setIsUploadDialogOpen(false);
                  setPendingUpload(null);
                  setPendingUploadLabel("");
                }}
                aria-label={labels.close}
                title={labels.close}
              >
                <X size={18} />
              </button>
            </div>

            <form
              className="audio-upload-dialog-form"
              onSubmit={(event) => {
                event.preventDefault();
                const label = pendingUploadLabel.trim();
                if (!pendingUpload || !label) {
                  return;
                }
                onUpload(song, pendingUpload, label);
                setIsUploadDialogOpen(false);
                setPendingUpload(null);
                setPendingUploadLabel("");
              }}
            >
              <label className="audio-upload-file-picker">
                <Upload size={17} />
                <span>{pendingUpload ? labels.changeAudioFile : labels.chooseAudioFile}</span>
                <input
                  className="sr-only"
                  type="file"
                  accept="audio/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      setPendingUpload(file);
                    }
                    event.target.value = "";
                  }}
                />
              </label>
              <p className={`audio-upload-selected-file ${pendingUpload ? "is-selected" : ""}`} aria-live="polite">
                {pendingUpload?.name ?? labels.noAudioFile}
              </p>

              <div className="grid gap-2">
                <label className="text-sm font-semibold text-stone-800" htmlFor={`audio-name-${song.id}`}>{labels.audioNameLabel}</label>
                <input
                  className="audio-upload-name-input"
                  id={`audio-name-${song.id}`}
                  type="text"
                  value={pendingUploadLabel}
                  onChange={(event) => setPendingUploadLabel(event.target.value)}
                  placeholder={labels.audioNamePlaceholder}
                  autoFocus
                />
                <div className="audio-upload-type-options" aria-label={labels.audioNameLabel}>
                  {[labels.audioNameInstrumental, labels.audioNameOriginal, labels.audioNameCover].map((option) => (
                    <button
                      className={pendingUploadLabel === option ? "is-selected" : ""}
                      type="button"
                      key={option}
                      onClick={() => setPendingUploadLabel(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              {!pendingUploadLabel.trim() ? <p className="audio-upload-name-hint">{labels.audioNameRequired}</p> : null}
              <div className="audio-upload-dialog-actions">
                <button
                  className="audio-upload-cancel"
                  type="button"
                  onClick={() => {
                    setIsUploadDialogOpen(false);
                    setPendingUpload(null);
                    setPendingUploadLabel("");
                  }}
                >
                  {labels.cancel}
                </button>
                <button className="audio-upload-submit" type="submit" disabled={!pendingUpload || !pendingUploadLabel.trim()}>
                  {labels.addFile}
                </button>
              </div>
            </form>
          </section>
        </div>,
        document.body
      )
        : null}
    </div>
  );
}

export function VocalMapApp({
  initialData,
  initialProfile,
  userEmail,
  userId,
  signOutAction
}: {
  initialData: InitialVocalMapData;
  initialProfile: UserProfile;
  userEmail: string;
  userId: string;
  signOutAction: () => Promise<void>;
}) {
  const t = useTranslations("app");
  const common = useTranslations("common");
  const markerIconLabels = useTranslations("markerIcons");
  const supabase = useMemo(() => createClient(), []);
  const translatedInitialMarkers = useMemo(
    () =>
      initialData.markers.map((marker) => {
        const markerCode = marker.code;
        return marker.isSystem && markerCode && systemMarkerCodes.has(markerCode)
          ? {
              ...marker,
              label: t(`systemMarkers.${markerCode}.label`),
              meaning: t(`systemMarkers.${markerCode}.meaning`)
            }
          : marker;
      }),
    [initialData.markers, t]
  );
  const [songs, setSongs] = useState<Song[]>(initialData.songs);
  const [markers, setMarkers] = useState<Marker[]>(translatedInitialMarkers);
  const [markerOrderIds, setMarkerOrderIds] = useState<string[]>(() => translatedInitialMarkers.map((marker) => marker.id));
  const [customMarkerDraft, setCustomMarkerDraft] = useState(EMPTY_CUSTOM_MARKER);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileLibraryOpen, setIsMobileLibraryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsPanel, setActiveSettingsPanel] = useState<SettingsPanel>("markers");
  const [isMarkerFormOpen, setIsMarkerFormOpen] = useState(false);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [hiddenSystemMarkerIds, setHiddenSystemMarkerIds] = useState<Set<string>>(() => new Set());
  const [systemMarkerOverrides, setSystemMarkerOverrides] = useState<Record<string, MarkerDraft>>({});
  const [activeSongId, setActiveSongId] = useState<string | null>(initialData.songs[0]?.id ?? null);
  const [localSearch, setLocalSearch] = useState("");
  const [isLibrarySearchOpen, setIsLibrarySearchOpen] = useState(false);
  const [draft, setDraft] = useState<SongDraft>(EMPTY_DRAFT);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [pendingSongAudioFile, setPendingSongAudioFile] = useState<File | null>(null);
  const [selection, setSelection] = useState<LyricsSelection | null>(null);
  const [isSelectingWords, setIsSelectingWords] = useState(false);
  const [playerTimeMs, setPlayerTimeMs] = useState(0);
  const [playerSeekRequest, setPlayerSeekRequest] = useState<{ id: number; timeMs: number } | undefined>();
  const [recordingTarget, setRecordingTarget] = useState("");
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [lyricTextSize, setLyricTextSize] = useState(DEFAULT_LYRIC_TEXT_SIZE);
  const [lyricLineSpacing, setLyricLineSpacing] = useState(DEFAULT_LYRIC_LINE_SPACING);
  const [lyricWordSpacing, setLyricWordSpacing] = useState(DEFAULT_LYRIC_WORD_SPACING);
  const [areLyricPreferencesReady, setAreLyricPreferencesReady] = useState(false);
  const [preferredAudioProvider, setPreferredAudioProvider] = useState<AudioProvider>("youtube");
  const [selectedSongAudioId, setSelectedSongAudioId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [profileDraft, setProfileDraft] = useState({
    displayName: initialProfile.displayName ?? "",
    vocalGoal: initialProfile.vocalGoal ?? ""
  });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [openSongOptionsId, setOpenSongOptionsId] = useState<string | null>(null);
  const [isProfileGateReady, setIsProfileGateReady] = useState(initialProfile.onboardingCompleted);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const librarySearchInputRef = useRef<HTMLInputElement | null>(null);
  const recordingSelectionRef = useRef<SelectedTarget | null>(null);
  const wordSelectionDragRef = useRef<{
    pointerId: number;
    songId: string;
    anchor: SelectedWordPoint;
    focus: SelectedWordPoint;
  } | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsNoteEditorOpen(false);
        setNoteDraft("");
        setOpenSongOptionsId(null);
        setSelection(null);
        setIsSettingsOpen(false);
        setIsMobileLibraryOpen(false);
      }
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (!target.closest("[data-profile-menu]")) {
        setIsProfileMenuOpen(false);
      }

      if (!target.closest("[data-song-options-menu]")) {
        setOpenSongOptionsId(null);
      }

      if (target.closest("[data-lyric-selection-surface], [data-marker-popover]")) {
        return;
      }

      setIsNoteEditorOpen(false);
      setNoteDraft("");
      setSelection(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const storedProfile = localStorage.getItem(PROFILE_STORAGE_KEY);
      if (!storedProfile) {
        setIsProfileModalOpen(!initialProfile.onboardingCompleted);
        setIsProfileGateReady(true);
        return;
      }

      try {
        const parsedProfile = JSON.parse(storedProfile) as Partial<UserProfile>;
        if (parsedProfile.id !== userId || !parsedProfile.onboardingCompleted) {
          setIsProfileModalOpen(!initialProfile.onboardingCompleted);
          setIsProfileGateReady(true);
          return;
        }

        setProfile((currentProfile) => {
          const nextProfile: UserProfile = {
            id: userId,
            email: currentProfile.email ?? userEmail,
            displayName: currentProfile.displayName ?? parsedProfile.displayName ?? null,
            vocalGoal: currentProfile.vocalGoal ?? parsedProfile.vocalGoal ?? null,
            onboardingCompleted: currentProfile.onboardingCompleted || Boolean(parsedProfile.onboardingCompleted)
          };

          setProfileDraft({
            displayName: nextProfile.displayName ?? "",
            vocalGoal: nextProfile.vocalGoal ?? ""
          });

          if (nextProfile.onboardingCompleted) {
            setIsProfileModalOpen(false);
          }

          return nextProfile;
        });
        setIsProfileGateReady(true);
      } catch {
        localStorage.removeItem(PROFILE_STORAGE_KEY);
        setIsProfileModalOpen(!initialProfile.onboardingCompleted);
        setIsProfileGateReady(true);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [initialProfile.onboardingCompleted, userEmail, userId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const storedPreferences = localStorage.getItem(markerPreferencesKey(userId));
      if (!storedPreferences) {
        return;
      }

      try {
        const parsedPreferences = JSON.parse(storedPreferences) as Partial<MarkerPreferences>;
        const nextHiddenIds = new Set(normalizeMarkerPreferenceIds(translatedInitialMarkers, parsedPreferences.hiddenSystemMarkerIds ?? []));
        const nextOverrides = normalizeSystemMarkerOverrides(translatedInitialMarkers, parsedPreferences.systemOverrides ?? {});
        const nextOrderIds = normalizeMarkerPreferenceIds(translatedInitialMarkers, parsedPreferences.markerOrderIds ?? []);

        setHiddenSystemMarkerIds(nextHiddenIds);
        setSystemMarkerOverrides(nextOverrides);
        setMarkerOrderIds((currentOrderIds) => (nextOrderIds.length > 0 ? nextOrderIds : currentOrderIds));
        setMarkers((currentMarkers) =>
          applyMarkerOrder(
            currentMarkers.map((marker) => {
              const override = nextOverrides[marker.id];
              return marker.isSystem && override ? { ...marker, ...override } : marker;
            }),
            nextOrderIds
          )
        );
      } catch {
        localStorage.removeItem(markerPreferencesKey(userId));
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [translatedInitialMarkers, userId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const size = readStoredLyricValue(lyricTextSizeStorageKey(userId), DEFAULT_LYRIC_TEXT_SIZE, clampLyricTextSize);
      const lineSpacing = readStoredLyricValue(lyricLineSpacingStorageKey(userId), DEFAULT_LYRIC_LINE_SPACING, clampLyricLineSpacing);
      const wordSpacing = readStoredLyricValue(lyricWordSpacingStorageKey(userId), DEFAULT_LYRIC_WORD_SPACING, clampLyricWordSpacing);

      setLyricTextSize(size);
      setLyricLineSpacing(lineSpacing);
      setLyricWordSpacing(wordSpacing);
      setAreLyricPreferencesReady(true);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [userId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const storedSongId = window.localStorage.getItem(activeSongStorageKey(userId));
        if (storedSongId) {
          setActiveSongId(storedSongId);
        }
      } catch {
        // Keeping the server-provided initial song is the safe fallback when storage is unavailable.
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [userId]);

  useEffect(() => {
    if (isLibrarySearchOpen) {
      librarySearchInputRef.current?.focus();
    }
  }, [isLibrarySearchOpen]);

  useEffect(() => {
    if (!statusMessage || statusMessage === t("recording")) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setStatusMessage("");
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [statusMessage, t]);

  const effectiveActiveSongId = songs.some((song) => song.id === activeSongId) ? activeSongId : songs[0]?.id ?? null;
  const activeSong = useMemo(() => songs.find((song) => song.id === effectiveActiveSongId), [effectiveActiveSongId, songs]);
  const activeSongHasYouTube = Boolean(activeSong && getYouTubeVideoId(activeSong));
  const activeSongHasFiles = Boolean(activeSong && activeSong.songAudios.length > 0);
  const activeAudioProvider: AudioProvider =
    preferredAudioProvider === "youtube" && activeSongHasYouTube
      ? "youtube"
      : preferredAudioProvider === "file" && activeSongHasFiles
        ? "file"
        : activeSongHasYouTube
          ? "youtube"
          : "file";
  const markerById = useMemo(() => new Map(markers.map((marker) => [marker.id, marker])), [markers]);
  const orderedMarkers = useMemo(() => applyMarkerOrder(markers, markerOrderIds), [markerOrderIds, markers]);
  const visibleMarkers = useMemo(() => orderedMarkers.filter((marker) => !marker.isSystem || !hiddenSystemMarkerIds.has(marker.id)), [hiddenSystemMarkerIds, orderedMarkers]);
  const selectedMarker = useMemo(() => visibleMarkers.find((marker) => marker.id === selectedMarkerId) ?? null, [selectedMarkerId, visibleMarkers]);
  const selectedMarkerIndex = useMemo(() => visibleMarkers.findIndex((marker) => marker.id === selectedMarkerId), [selectedMarkerId, visibleMarkers]);
  const selectedData = useMemo(() => findSelectedData(activeSong, selection), [activeSong, selection]);
  const selectedWordIds = useMemo(() => new Set(activeSong ? selectedWordAddresses(activeSong, selection).map((address) => address.word.id) : []), [activeSong, selection]);
  const currentTargetKey = selectedTargetKey(selection);
  const songDraftIsComplete = Boolean(draft.title.trim() && draft.youtubeVideoId);
  const songDraftHasImportedDetails = Boolean(draft.youtubeVideoId && draft.videoTitle && draft.channelTitle);
  const lyricTextStyle = useMemo<CSSProperties>(
    () => ({
      fontSize: `${lyricTextSize}px`,
      lineHeight: 1.35
    }),
    [lyricTextSize]
  );
  const lyricLineStyle = useMemo<CSSProperties>(
    () => ({
      paddingTop: `${lyricLineSpacing}px`,
      paddingBottom: `${lyricLineSpacing}px`
    }),
    [lyricLineSpacing]
  );
  const lyricWordsStyle = useMemo<CSSProperties>(
    () => ({
      columnGap: `${lyricWordSpacing}px`
    }),
    [lyricWordSpacing]
  );

  const filteredSongs = useMemo(() => {
    const query = localSearch.trim().toLowerCase();
    if (!query) {
      return songs;
    }

    return songs.filter((song) => `${song.title} ${song.artist ?? ""}`.toLowerCase().includes(query));
  }, [localSearch, songs]);

  async function deleteStoragePaths(paths: string[]) {
    const uniquePaths = Array.from(new Set(paths));
    if (uniquePaths.length === 0) {
      return;
    }
    await supabase.storage.from(AUDIO_BUCKET).remove(uniquePaths);
  }

  useEffect(() => {
    async function purgeLineTargets() {
      const audioResult = await supabase
        .from("audio_references")
        .select("storage_path")
        .eq("user_id", userId)
        .eq("target_type", "line");

      const [annotationsResult, notesResult, audioDeleteResult] = await Promise.all([
        supabase.from("annotations").delete().eq("user_id", userId).eq("target_type", "line"),
        supabase.from("target_notes").delete().eq("user_id", userId).eq("target_type", "line"),
        supabase.from("audio_references").delete().eq("user_id", userId).eq("target_type", "line")
      ]);

      if (annotationsResult.error || notesResult.error || audioDeleteResult.error || audioResult.error) {
        return;
      }

      const storagePaths = (audioResult.data ?? []).map((audio) => audio.storage_path);
      if (storagePaths.length > 0) {
        await supabase.storage.from(AUDIO_BUCKET).remove(storagePaths);
      }
    }

    void purgeLineTargets();
  }, [supabase, userId]);

  function closeNoteEditor() {
    setIsNoteEditorOpen(false);
    setNoteDraft("");
  }

  function activateSong(songId: string | null) {
    setActiveSongId(songId);

    try {
      if (songId) {
        window.localStorage.setItem(activeSongStorageKey(userId), songId);
      } else {
        window.localStorage.removeItem(activeSongStorageKey(userId));
      }
    } catch {
      // The active song still works for this session if storage is unavailable.
    }
  }

  function updateLyricTextSize(nextSize: number) {
    const size = clampLyricTextSize(nextSize);
    setLyricTextSize(size);
    localStorage.setItem(lyricTextSizeStorageKey(userId), String(size));
  }

  function updateLyricLineSpacing(nextSpacing: number) {
    const spacing = clampLyricLineSpacing(nextSpacing);
    setLyricLineSpacing(spacing);
    localStorage.setItem(lyricLineSpacingStorageKey(userId), String(spacing));
  }

  function updateLyricWordSpacing(nextSpacing: number) {
    const spacing = clampLyricWordSpacing(nextSpacing);
    setLyricWordSpacing(spacing);
    localStorage.setItem(lyricWordSpacingStorageKey(userId), String(spacing));
  }

  function openManualDraft() {
    setEditingSongId("new");
    setDraft(EMPTY_DRAFT);
    setPendingSongAudioFile(null);
    closeNoteEditor();
    setSelection(null);
  }

  function openSongEditor(song: Song) {
    setEditingSongId(song.id);
    setDraft(songToDraft(song));
    setPendingSongAudioFile(null);
    closeNoteEditor();
    setSelection(null);
  }

  function persistMarkerPreferences(nextHiddenIds: Set<string>, nextOverrides: Record<string, MarkerDraft>, nextOrderIds = markerOrderIds) {
    const preferences: MarkerPreferences = {
      hiddenSystemMarkerIds: Array.from(nextHiddenIds),
      systemOverrides: nextOverrides,
      markerOrderIds: nextOrderIds
    };
    localStorage.setItem(markerPreferencesKey(userId), JSON.stringify(preferences));
  }

  async function persistCustomMarkerOrder(nextMarkers: Marker[]) {
    const results = await Promise.all(
      nextMarkers.map((marker, index) =>
        marker.isSystem ? Promise.resolve({ error: null }) : supabase.from("markers").update({ sort_order: index + 1 }).eq("id", marker.id).eq("user_id", userId)
      )
    );

    if (results.some((result) => result.error)) {
      setStatusMessage(t("saveFailed"));
    }
  }

  function moveMarker(markerId: string, offset: -1 | 1) {
    const currentIndex = visibleMarkers.findIndex((marker) => marker.id === markerId);
    const targetIndex = currentIndex + offset;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= visibleMarkers.length) {
      return;
    }

    const nextVisibleMarkers = [...visibleMarkers];
    [nextVisibleMarkers[currentIndex], nextVisibleMarkers[targetIndex]] = [nextVisibleMarkers[targetIndex], nextVisibleMarkers[currentIndex]];

    const visibleMarkerIds = new Set(nextVisibleMarkers.map((marker) => marker.id));
    const nextOrderIds = [...nextVisibleMarkers.map((marker) => marker.id), ...orderedMarkers.filter((marker) => !visibleMarkerIds.has(marker.id)).map((marker) => marker.id)];
    const nextMarkers = applyMarkerOrder(markers, nextOrderIds);

    setMarkerOrderIds(nextOrderIds);
    setMarkers(nextMarkers);
    persistMarkerPreferences(hiddenSystemMarkerIds, systemMarkerOverrides, nextOrderIds);
    void persistCustomMarkerOrder(nextMarkers);
  }

  function openMarkerCreate() {
    setIsSettingsOpen(true);
    setEditingMarkerId(null);
    setSelectedMarkerId(null);
    setCustomMarkerDraft(EMPTY_CUSTOM_MARKER);
    setIsMarkerFormOpen(true);
  }

  function openMarkerEdit(marker: Marker) {
    setIsSettingsOpen(true);
    setSelectedMarkerId(marker.id);
    setEditingMarkerId(marker.id);
    setCustomMarkerDraft({
      label: marker.label,
      meaning: marker.meaning,
      color: marker.color,
      icon: marker.icon
    });
    setIsMarkerFormOpen(true);
  }

  function closeMarkerForm() {
    setEditingMarkerId(null);
    setIsMarkerFormOpen(false);
    setCustomMarkerDraft(EMPTY_CUSTOM_MARKER);
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = profileDraft.displayName.trim();
    const vocalGoal = profileDraft.vocalGoal.trim();

    if (displayName.length < 2) {
      setProfileError(t("profileNameRequired"));
      return;
    }

    setIsSavingProfile(true);
    setProfileError("");

    const nextProfile: UserProfile = {
      id: userId,
      email: userEmail || null,
      displayName,
      vocalGoal: vocalGoal || null,
      onboardingCompleted: true
    };
    const profileRow: TablesInsert<"profiles"> = {
      id: userId,
      email: userEmail || null,
      display_name: displayName,
      vocal_goal: vocalGoal || null,
      onboarding_completed: true
    };

    const { error } = await supabase.from("profiles").upsert(profileRow, { onConflict: "id" });

    if (error) {
      const legacyProfileRow: TablesInsert<"profiles"> = {
        id: userId,
        email: userEmail || null,
        display_name: displayName
      };
      const { error: legacyError } = await supabase.from("profiles").upsert(legacyProfileRow, { onConflict: "id" });

      if (legacyError) {
        setProfileError(t("profileSaveFailed"));
        setIsSavingProfile(false);
        return;
      }
    }

    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
    setProfile(nextProfile);
    setIsSavingProfile(false);
    setIsProfileModalOpen(false);
  }

  async function findOrCreateTrack(song: Song) {
    const source = song.youtubeVideoId ? "youtube" : "manual";
    const sourceTrackId = song.youtubeVideoId ?? null;

    if (sourceTrackId) {
      const existingTrack = await supabase
        .from("tracks")
        .select("id")
        .eq("created_by", userId)
        .eq("source", source)
        .eq("source_track_id", sourceTrackId)
        .maybeSingle();
      if (existingTrack.error) {
        throw existingTrack.error;
      }
      if (existingTrack.data?.id) {
        return existingTrack.data.id;
      }

      const existingVideoTrack = await supabase.from("tracks").select("id").eq("created_by", userId).eq("youtube_video_id", sourceTrackId).maybeSingle();
      if (existingVideoTrack.error) throw existingVideoTrack.error;
      if (existingVideoTrack.data?.id) return existingVideoTrack.data.id;
    }

    const trackRow: TablesInsert<"tracks"> = {
      created_by: userId,
      source,
      source_track_id: sourceTrackId,
      title: song.title,
      artist: song.artist ?? null,
      duration_ms: song.durationMs ?? null,
      youtube_video_id: song.youtubeVideoId ?? null,
      video_title: song.videoTitle ?? null,
      channel_title: song.channelTitle ?? null,
      thumbnail_url: song.thumbnailUrl ?? null,
      original_search_query: song.originalSearchQuery ?? null,
      selected_version_type: song.selectedVersionType ?? null
    };
    const insertedTrack = await supabase.from("tracks").insert(trackRow).select("id").single();

    if (!insertedTrack.error && insertedTrack.data?.id) {
      return insertedTrack.data.id;
    }

    if (sourceTrackId) {
      const retryTrack = await supabase
        .from("tracks")
        .select("id")
        .eq("created_by", userId)
        .eq("source", source)
        .eq("source_track_id", sourceTrackId)
        .maybeSingle();
      if (!retryTrack.error && retryTrack.data?.id) {
        return retryTrack.data.id;
      }

      const retryVideoTrack = await supabase.from("tracks").select("id").eq("created_by", userId).eq("youtube_video_id", sourceTrackId).maybeSingle();
      if (!retryVideoTrack.error && retryVideoTrack.data?.id) return retryVideoTrack.data.id;
    }

    throw insertedTrack.error ?? new Error("Track insert failed.");
  }

  async function findOrCreateLyricsDocument(song: Song, trackId: string) {
    const lyricsHash = await sha256Hex(song.sourceLyricsText);
    const existingDocument = await supabase
      .from("lyrics_documents")
      .select("id")
      .eq("created_by", userId)
      .eq("lyrics_hash", lyricsHash)
      .eq("tokenizer_version", LYRICS_TOKENIZER_VERSION)
      .maybeSingle();

    if (existingDocument.error) {
      throw existingDocument.error;
    }

    if (existingDocument.data?.id) {
      return existingDocument.data.id;
    }

    const documentRow: TablesInsert<"lyrics_documents"> = {
      created_by: userId,
      track_id: trackId,
      provider: song.youtubeVideoId ? "youtube" : "manual",
      lyrics_text: song.sourceLyricsText,
      lyrics_hash: lyricsHash,
      tokenizer_version: LYRICS_TOKENIZER_VERSION,
      line_word_counts: lineWordCountsFromText(song.sourceLyricsText)
    };
    const insertedDocument = await supabase.from("lyrics_documents").insert(documentRow).select("id").single();

    if (!insertedDocument.error && insertedDocument.data?.id) {
      return insertedDocument.data.id;
    }

    const retryDocument = await supabase
      .from("lyrics_documents")
      .select("id")
      .eq("created_by", userId)
      .eq("lyrics_hash", lyricsHash)
      .eq("tokenizer_version", LYRICS_TOKENIZER_VERSION)
      .maybeSingle();
    if (!retryDocument.error && retryDocument.data?.id) {
      return retryDocument.data.id;
    }

    throw insertedDocument.error ?? new Error("Lyrics document insert failed.");
  }

  async function persistSong(song: Song) {
    const trackId = await findOrCreateTrack(song);
    const lyricsDocumentId = await findOrCreateLyricsDocument(song, trackId);
    const songRow: TablesInsert<"user_songs"> = {
      id: song.id,
      user_id: userId,
      track_id: trackId,
      lyrics_document_id: lyricsDocumentId,
      title: song.title,
      artist: song.artist ?? null,
      duration_ms: song.durationMs ?? null,
      source: song.source,
      youtube_video_id: song.youtubeVideoId ?? null,
      video_title: song.videoTitle ?? null,
      channel_title: song.channelTitle ?? null,
      thumbnail_url: song.thumbnailUrl ?? null,
      original_search_query: song.originalSearchQuery ?? null,
      selected_version_type: song.selectedVersionType ?? null
    };

    const { error } = await supabase.from("user_songs").upsert(songRow, { onConflict: "id" });
    if (error) {
      throw error;
    }

    return { trackId, lyricsDocumentId };
  }

  async function saveDraft() {
    const existingSong = editingSongId && editingSongId !== "new" ? songs.find((song) => song.id === editingSongId) : undefined;
    const song = buildSongFromDraft(draft, common("untitledSong"), existingSong);

    setIsSaving(true);
    try {
      const persistedSong = await persistSong(song);
      await deleteStoragePaths(collectRemovedAudioPaths(existingSong, song));
      let nextSong = {
        ...song,
        trackId: persistedSong.trackId,
        lyricsDocumentId: persistedSong.lyricsDocumentId
      };
      let audioUploadFailed = false;

      if (pendingSongAudioFile) {
        try {
          const audioReference = await persistAudioReference(
            { songId: song.id, type: "song" },
            pendingSongAudioFile,
            labelFromFileName(pendingSongAudioFile.name) || t("audioNameFallback")
          );
          setSelectedSongAudioId(audioReference.id);
          setPreferredAudioProvider("file");
          nextSong = {
            ...nextSong,
            songAudios: [...nextSong.songAudios, audioReference],
            updatedAt: new Date().toISOString()
          };
        } catch {
          audioUploadFailed = true;
        }
      }

      setSongs((currentSongs) => {
        if (existingSong) {
          return currentSongs.map((item) => (item.id === existingSong.id ? nextSong : item));
        }
        return [nextSong, ...currentSongs];
      });

      setPendingSongAudioFile(null);
      activateSong(nextSong.id);
      setEditingSongId(null);
      closeNoteEditor();
      setSelection(null);
      setStatusMessage(audioUploadFailed ? t("songSavedAudioFailed") : t("songSaved"));
    } catch {
      setStatusMessage(t("saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteSong(song: Song) {
    const confirmed = window.confirm(t("confirmDeleteSong", { title: song.title }));
    if (!confirmed) {
      return;
    }

    const { error } = await supabase.from("user_songs").delete().eq("id", song.id).eq("user_id", userId);

    if (error) {
      setStatusMessage(t("deleteFailed"));
      return;
    }

    await deleteStoragePaths(collectAudioPaths(song));
    setSongs((currentSongs) => currentSongs.filter((item) => item.id !== song.id));
    if (effectiveActiveSongId === song.id) {
      activateSong(null);
    }
    closeNoteEditor();
    setSelection(null);
    setStatusMessage(t("songDeleted"));
  }

  async function saveMarker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = customMarkerDraft.label.trim();
    const meaning = customMarkerDraft.meaning.trim();

    if (!label) {
      setStatusMessage(t("markerNameRequired"));
      return;
    }

    const existingMarker = editingMarkerId ? markers.find((item) => item.id === editingMarkerId) : undefined;
    const markerPayload = {
      label: label.slice(0, 14),
      meaning: meaning || t("customMarkerDefaultMeaning"),
      color: customMarkerDraft.color,
      icon: customMarkerDraft.icon
    };

    if (existingMarker?.isSystem) {
      const nextOverrides = {
        ...systemMarkerOverrides,
        [existingMarker.id]: markerPayload
      };

      setSystemMarkerOverrides(nextOverrides);
      persistMarkerPreferences(hiddenSystemMarkerIds, nextOverrides);
      setMarkers((currentMarkers) => currentMarkers.map((marker) => (marker.id === existingMarker.id ? { ...marker, ...markerPayload } : marker)));
      setSelectedMarkerId(existingMarker.id);
      closeMarkerForm();
      setStatusMessage(t("markerUpdated"));
      return;
    }

    if (existingMarker) {
      let persistedMarkerPayload = markerPayload;
      let { error } = await supabase
        .from("markers")
        .update({
          label: persistedMarkerPayload.label,
          meaning: persistedMarkerPayload.meaning,
          color: persistedMarkerPayload.color,
          icon: persistedMarkerPayload.icon
        })
        .eq("id", existingMarker.id)
        .eq("user_id", userId);

      if (shouldRetryMarkerIcon(error, markerPayload.icon)) {
        persistedMarkerPayload = { ...markerPayload, icon: FALLBACK_MARKER_ICON };
        const retryResult = await supabase
          .from("markers")
          .update({
            label: persistedMarkerPayload.label,
            meaning: persistedMarkerPayload.meaning,
            color: persistedMarkerPayload.color,
            icon: persistedMarkerPayload.icon
          })
          .eq("id", existingMarker.id)
          .eq("user_id", userId);
        error = retryResult.error;
      }

      if (error) {
        setStatusMessage(t("saveFailed"));
        return;
      }

      setMarkers((currentMarkers) => currentMarkers.map((marker) => (marker.id === existingMarker.id ? { ...marker, ...persistedMarkerPayload } : marker)));
      setSelectedMarkerId(existingMarker.id);
      closeMarkerForm();
      setStatusMessage(t("markerUpdated"));
      return;
    }

    const markerId = createId();
    let persistedMarkerPayload = markerPayload;
    let { error } = await supabase.from("markers").insert({
      id: markerId,
      user_id: userId,
      label: persistedMarkerPayload.label,
      meaning: persistedMarkerPayload.meaning,
      color: persistedMarkerPayload.color,
      icon: persistedMarkerPayload.icon,
      is_system: false,
      sort_order: markers.length + 1
    });

    if (shouldRetryMarkerIcon(error, markerPayload.icon)) {
      persistedMarkerPayload = { ...markerPayload, icon: FALLBACK_MARKER_ICON };
      const retryResult = await supabase.from("markers").insert({
        id: markerId,
        user_id: userId,
        label: persistedMarkerPayload.label,
        meaning: persistedMarkerPayload.meaning,
        color: persistedMarkerPayload.color,
        icon: persistedMarkerPayload.icon,
        is_system: false,
        sort_order: markers.length + 1
      });
      error = retryResult.error;
    }

    if (error) {
      setStatusMessage(t("saveFailed"));
      return;
    }

    const marker: Marker = {
      id: markerId,
      ...persistedMarkerPayload,
      isSystem: false
    };

    setMarkers((currentMarkers) => [...currentMarkers, marker]);
    setMarkerOrderIds((currentOrderIds) => {
      const nextOrderIds = [...currentOrderIds.filter((id) => id !== marker.id), marker.id];
      persistMarkerPreferences(hiddenSystemMarkerIds, systemMarkerOverrides, nextOrderIds);
      return nextOrderIds;
    });
    setSelectedMarkerId(marker.id);
    closeMarkerForm();
    setStatusMessage(t("markerAdded"));
  }

  async function removeMarker(markerId: string) {
    const marker = markers.find((item) => item.id === markerId);
    if (!marker) {
      return;
    }

    const confirmed = window.confirm(t(marker.isSystem ? "confirmHideSystemMarker" : "confirmDeleteMarker", { label: marker.label }));
    if (!confirmed) {
      return;
    }

    if (marker.isSystem) {
      const nextHiddenIds = new Set(hiddenSystemMarkerIds);
      nextHiddenIds.add(marker.id);
      setHiddenSystemMarkerIds(nextHiddenIds);
      persistMarkerPreferences(nextHiddenIds, systemMarkerOverrides, markerOrderIds);

      if (editingMarkerId === marker.id) {
        closeMarkerForm();
      }

      setSelectedMarkerId(null);
      setStatusMessage(t("markerHidden"));
      return;
    }

    const { error } = await supabase.from("markers").delete().eq("id", markerId).eq("user_id", userId);
    if (error) {
      setStatusMessage(t("deleteFailed"));
      return;
    }

    setMarkers((currentMarkers) => currentMarkers.filter((item) => item.id !== markerId));
    setMarkerOrderIds((currentOrderIds) => {
      const nextOrderIds = currentOrderIds.filter((id) => id !== markerId);
      persistMarkerPreferences(hiddenSystemMarkerIds, systemMarkerOverrides, nextOrderIds);
      return nextOrderIds;
    });
    setSelectedMarkerId(null);
    setSongs((currentSongs) =>
      currentSongs.map((song) => ({
        ...song,
        lyrics: song.lyrics.map((line) => ({
          ...line,
          words: line.words.map((word) => ({
            ...word,
            annotations: word.annotations.filter((annotation) => annotation.markerId !== markerId)
          }))
        })),
        updatedAt: new Date().toISOString()
      }))
    );
    setStatusMessage(t("markerDeleted"));
  }

  function resetSystemMarkers() {
    const nextHiddenIds = new Set<string>();
    const nextOverrides: Record<string, MarkerDraft> = {};

    setHiddenSystemMarkerIds(nextHiddenIds);
    setSystemMarkerOverrides(nextOverrides);
    localStorage.removeItem(markerPreferencesKey(userId));
    setMarkerOrderIds((currentOrderIds) => {
      const currentMarkerIds = new Set(markers.map((marker) => marker.id));
      const resetOrderIds = [
        ...translatedInitialMarkers.map((marker) => marker.id).filter((id) => currentMarkerIds.has(id)),
        ...currentOrderIds.filter((id) => currentMarkerIds.has(id) && !translatedInitialMarkers.some((marker) => marker.id === id))
      ];
      return resetOrderIds;
    });
    setSelectedMarkerId(null);
    setMarkers((currentMarkers) =>
      currentMarkers.map((marker) => {
        const initialMarker = translatedInitialMarkers.find((item) => item.id === marker.id);
        return marker.isSystem && initialMarker ? initialMarker : marker;
      })
    );
    closeMarkerForm();
    setStatusMessage(t("markerDefaultsReset"));
  }

  async function importYouTubeVideo(video: YouTubeVideoSearchResult, originalSearchQuery: string) {
    const isReplacingExistingSong = Boolean(editingSongId && editingSongId !== "new");
    let lyricsText = draft.lyricsText;

    if (!isReplacingExistingSong) {
      setStatusMessage(t("findLyrics"));
      try {
        const match = await findLyricsForTrack({
          title: video.title,
          artist: video.artistName,
          durationMs: video.durationMs
        });
        if (match?.plainLyrics) {
          lyricsText = match.plainLyrics;
          setStatusMessage(t("lyricsFound"));
        } else if (match?.syncedLyrics) {
          lyricsText = syncedLyricsToPlainText(match.syncedLyrics);
          setStatusMessage(t("syncedLyricsFound"));
        } else {
          setStatusMessage(t("lyricsNotFound"));
        }
      } catch {
        setStatusMessage(t("lyricsFetchFailed"));
      }
    }

    setDraft((currentDraft) => ({
      ...currentDraft,
      title: isReplacingExistingSong ? currentDraft.title : video.title,
      artist: isReplacingExistingSong ? currentDraft.artist : video.artistName,
      lyricsText,
      youtubeVideoId: video.youtubeVideoId,
      videoTitle: video.title,
      channelTitle: video.channelTitle,
      thumbnailUrl: video.thumbnailUrl,
      originalSearchQuery,
      selectedVersionType: video.versionType,
      durationMs: video.durationMs
    }));
    setPreferredAudioProvider("youtube");
    closeNoteEditor();
    setSelection(null);
  }

  function handleYouTubePlayerError(errorCode: YouTubePlayerErrorCode) {
    const messageKey: Record<YouTubePlayerErrorCode, "youtubeInvalidVideo" | "youtubeVideoUnavailable" | "youtubeEmbeddingRestricted" | "youtubePlayerLoadFailed"> = {
      invalidVideo: "youtubeInvalidVideo",
      videoUnavailable: "youtubeVideoUnavailable",
      embeddingRestricted: "youtubeEmbeddingRestricted",
      playerLoadFailed: "youtubePlayerLoadFailed"
    };
    setStatusMessage(t(messageKey[errorCode]));
  }

  function beginWordSelection(event: React.PointerEvent<HTMLElement>, lineId: string, wordId: string) {
    if (!activeSong) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is a progressive enhancement for touch/mouse drag stability.
    }

    const focus = { lineId, wordId };
    const anchor = event.shiftKey ? selectionShiftAnchor(activeSong, selection, activeSong.id) ?? focus : focus;

    wordSelectionDragRef.current = {
      pointerId: event.pointerId,
      songId: activeSong.id,
      anchor,
      focus
    };

    setIsSelectingWords(true);
    closeNoteEditor();
    setSelection(makeWordOrRangeSelection(activeSong.id, anchor, focus, event.clientX, event.clientY));
  }

  function updateWordSelectionFromPointer(event: React.PointerEvent<HTMLElement>) {
    const dragState = wordSelectionDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const hoveredWord = wordPointFromElement(document.elementFromPoint(event.clientX, event.clientY));
    if (!hoveredWord || hoveredWord.songId !== dragState.songId) {
      return;
    }

    const focus = { lineId: hoveredWord.lineId, wordId: hoveredWord.wordId };
    if (sameWordPoint(dragState.focus, focus)) {
      return;
    }

    wordSelectionDragRef.current = {
      ...dragState,
      focus
    };
    closeNoteEditor();
    setSelection(makeWordOrRangeSelection(dragState.songId, dragState.anchor, focus, event.clientX, event.clientY));
  }

  function finishWordSelection(event: React.PointerEvent<HTMLElement>) {
    const dragState = wordSelectionDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    updateWordSelectionFromPointer(event);
    wordSelectionDragRef.current = null;
    setIsSelectingWords(false);

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already be released by the browser.
    }
  }

  function cancelWordSelection(event: React.PointerEvent<HTMLElement>) {
    const dragState = wordSelectionDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    wordSelectionDragRef.current = null;
    setIsSelectingWords(false);
  }

  function selectWordFromKeyboard(lineId: string, wordId: string, element: HTMLElement) {
    if (!activeSong) {
      return;
    }

    const rect = element.getBoundingClientRect();
    closeNoteEditor();
    setSelection({
      songId: activeSong.id,
      type: "word",
      lineId,
      wordId,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
  }

  function updateSelectedTarget(
    target: SelectedTarget,
    updater: (payload: {
      annotations: WordAnnotation[];
      audioReference?: AudioReference;
      textNote?: TextNote;
      timestampMs?: number;
    }) => {
      annotations?: WordAnnotation[];
      audioReference?: AudioReference;
      removeAudio?: boolean;
      textNote?: TextNote;
      removeTextNote?: boolean;
      timestampMs?: number;
    }
  ) {
    const now = new Date().toISOString();

    setSongs((currentSongs) =>
      currentSongs.map((song) => {
        if (song.id !== target.songId) {
          return song;
        }

        const lyrics = song.lyrics.map((line) => {
          if (line.id !== target.lineId) {
            return line;
          }

          return {
            ...line,
            words: line.words.map((word) => {
              if (word.id !== target.wordId) {
                return word;
              }

              const result = updater({
                annotations: word.annotations,
                audioReference: word.audioReference,
                textNote: word.textNote,
                timestampMs: word.timestampMs
              });

              return {
                ...word,
                annotations: result.annotations ?? word.annotations,
                audioReference: result.removeAudio ? undefined : result.audioReference ?? word.audioReference,
                textNote: result.removeTextNote ? undefined : result.textNote ?? word.textNote,
                timestampMs: result.timestampMs ?? word.timestampMs
              };
            })
          };
        });

        return {
          ...song,
          lyrics,
          updatedAt: now
        };
      })
    );
  }

  function updateSelectedRangeTarget(
    target: SelectedRangeTarget,
    updater: (payload: {
      lineId: string;
      wordId: string;
      lineIndex: number;
      wordIndex: number;
      annotations: WordAnnotation[];
      textNote?: TextNote;
      timestampMs?: number;
    }) => {
      annotations?: WordAnnotation[];
      textNote?: TextNote;
      removeTextNote?: boolean;
      timestampMs?: number;
    }
  ) {
    const now = new Date().toISOString();

    setSongs((currentSongs) =>
      currentSongs.map((song) => {
        if (song.id !== target.songId) {
          return song;
        }

        const selectedWordAddressById = new Map(selectedWordAddresses(song, target).map((address) => [address.word.id, address]));
        if (selectedWordAddressById.size === 0) {
          return song;
        }

        return {
          ...song,
          lyrics: song.lyrics.map((line) => ({
            ...line,
            words: line.words.map((word) => {
              const selectedAddress = selectedWordAddressById.get(word.id);
              if (!selectedAddress) {
                return word;
              }

              const result = updater({
                lineId: line.id,
                wordId: word.id,
                lineIndex: selectedAddress.lineIndex,
                wordIndex: selectedAddress.wordIndex,
                annotations: word.annotations,
                textNote: word.textNote,
                timestampMs: word.timestampMs
              });

              return {
                ...word,
                annotations: result.annotations ?? word.annotations,
                textNote: result.removeTextNote ? undefined : result.textNote ?? word.textNote,
                timestampMs: result.timestampMs ?? word.timestampMs
              };
            })
          })),
          updatedAt: now
        };
      })
    );
  }

  function currentNoteText() {
    if (!selectedData) {
      return "";
    }

    if (selectedData.type === "range") {
      const notes = selectedData.wordTargets.map((target) => target.textNote?.text ?? "");
      const [firstNote = ""] = notes;
      return notes.every((note) => note === firstNote) ? firstNote : "";
    }

    return selectedData.textNote?.text ?? "";
  }

  function hasSelectedTextNote() {
    if (!selectedData) {
      return false;
    }

    if (selectedData.type === "range") {
      return selectedData.wordTargets.some((target) => Boolean(target.textNote));
    }

    return Boolean(selectedData.textNote);
  }

  function seekToTimestamp(timestampMs: number) {
    setPlayerSeekRequest({ id: Date.now(), timeMs: timestampMs });
    setPreferredAudioProvider("youtube");
  }

  async function syncSelectionToPlayer() {
    if (!selection || !activeSong) {
      return;
    }

    const targets = selectedWordAddresses(activeSong, selection);
    if (targets.length === 0) {
      return;
    }

    const timestampMs = Math.max(0, Math.round(playerTimeMs));
    const rows: TablesInsert<"lyric_timestamps">[] = targets.map((target) => ({
      user_id: userId,
      user_song_id: activeSong.id,
      line_index: target.lineIndex,
      word_index: target.wordIndex,
      timestamp_ms: timestampMs
    }));
    const { error } = await supabase.from("lyric_timestamps").upsert(rows, {
      onConflict: "user_id,user_song_id,line_index,word_index"
    });
    if (error) {
      setStatusMessage(t("syncSaveFailed"));
      return;
    }

    if (selection.type === "range") {
      updateSelectedRangeTarget(selection, () => ({ timestampMs }));
    } else {
      updateSelectedTarget(selection, () => ({ timestampMs }));
    }
    setStatusMessage(t("syncSaved", { time: formatDuration(timestampMs) }));
  }

  function seekToSelectedTimestamp() {
    if (!selection || !activeSong) {
      return;
    }

    const timestampMs = selectedWordAddresses(activeSong, selection).find((target) => typeof target.word.timestampMs === "number")?.word.timestampMs;
    if (typeof timestampMs === "number") {
      seekToTimestamp(timestampMs);
    }
  }

  function openNoteEditor() {
    setNoteDraft(currentNoteText());
    setIsNoteEditorOpen(true);
  }

  async function deleteTextNoteFromSelection() {
    if (!selection || !selectedData) {
      return;
    }

    if (selection.type === "range") {
      if (selectedData.type !== "range") {
        return;
      }

      const noteIds = selectedData.wordTargets.flatMap((target) => (target.textNote ? [target.textNote.id] : []));
      if (noteIds.length > 0) {
        const { error } = await supabase.from("target_notes").delete().eq("user_id", userId).in("id", noteIds);
        if (error) {
          setStatusMessage(t("noteSaveFailed"));
          return;
        }
      }

      updateSelectedRangeTarget(selection, () => ({ removeTextNote: true }));
      setNoteDraft("");
      setIsNoteEditorOpen(false);
      setStatusMessage(t("noteDeleted"));
      return;
    }

    if (selectedData.type === "range" || !selectedData.textNote) {
      setNoteDraft("");
      setIsNoteEditorOpen(false);
      return;
    }

    const { error } = await supabase.from("target_notes").delete().eq("id", selectedData.textNote.id).eq("user_id", userId);
    if (error) {
      setStatusMessage(t("noteSaveFailed"));
      return;
    }

    updateSelectedTarget(selection, () => ({ removeTextNote: true }));
    setNoteDraft("");
    setIsNoteEditorOpen(false);
    setStatusMessage(t("noteDeleted"));
  }

  async function saveTextNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || !selectedData) {
      return;
    }

    const text = noteDraft.trim();
    if (!text) {
      await deleteTextNoteFromSelection();
      return;
    }

    const now = new Date().toISOString();

    if (selection.type === "range") {
      if (selectedData.type !== "range" || selectedData.wordTargets.length === 0) {
        return;
      }
      if (!activeSong) {
        return;
      }

      const noteByWordId = new Map<string, TextNote>();
      const rows: TablesInsert<"target_notes">[] = selectedData.wordTargets.map((target) => {
        const note: TextNote = {
          id: target.textNote?.id ?? createId(),
          text,
          createdAt: target.textNote?.createdAt ?? now,
          updatedAt: now
        };
        noteByWordId.set(target.wordId, note);

        return {
          id: note.id,
          user_id: userId,
          user_song_id: selection.songId,
          line_index: target.lineIndex,
          word_index: target.wordIndex,
          target_type: "word",
          text
        };
      });

      const { error } = await supabase.from("target_notes").upsert(rows, {
        onConflict: "user_id,target_type,user_song_id,line_index,word_index"
      });
      if (error) {
        setStatusMessage(t("noteSaveFailed"));
        return;
      }

      updateSelectedRangeTarget(selection, ({ wordId }) => {
        const textNote = noteByWordId.get(wordId);
        return textNote ? { textNote } : {};
      });
      setIsNoteEditorOpen(false);
      setStatusMessage(t("noteSaved"));
      return;
    }

    if (selectedData.type === "range") {
      return;
    }

    if (!activeSong) {
      return;
    }

    const targetCoordinates = getTargetCoordinates(activeSong, selection);
    if (!targetCoordinates) {
      setStatusMessage(t("noteSaveFailed"));
      return;
    }

    const textNote: TextNote = {
      id: selectedData.textNote?.id ?? createId(),
      text,
      createdAt: selectedData.textNote?.createdAt ?? now,
      updatedAt: now
    };
    const row: TablesInsert<"target_notes"> = {
      id: textNote.id,
      user_id: userId,
      user_song_id: targetCoordinates.userSongId,
      line_index: targetCoordinates.lineIndex,
      word_index: targetCoordinates.wordIndex,
      target_type: selection.type,
      text
    };

    const { error } = await supabase.from("target_notes").upsert(row, {
      onConflict: "user_id,target_type,user_song_id,line_index,word_index"
    });
    if (error) {
      setStatusMessage(t("noteSaveFailed"));
      return;
    }

    updateSelectedTarget(selection, () => ({ textNote }));
    setIsNoteEditorOpen(false);
    setStatusMessage(t("noteSaved"));
  }

  async function toggleMarker(markerId: string) {
    if (!selection || !activeSong || !selectedData) {
      return;
    }

    if (selection.type === "range") {
      if (selectedData.type !== "range" || selectedData.wordTargets.length === 0) {
        return;
      }

      const markerIsActiveEverywhere = selectedData.wordTargets.every((target) => target.annotations.some((annotation) => annotation.markerId === markerId));

      if (markerIsActiveEverywhere) {
        const annotationIds = selectedData.wordTargets.flatMap((target) => target.annotations.filter((annotation) => annotation.markerId === markerId).map((annotation) => annotation.id));
        if (annotationIds.length === 0) {
          return;
        }

        const { error } = await supabase.from("annotations").delete().eq("user_id", userId).in("id", annotationIds);
        if (error) {
          setStatusMessage(t("saveFailed"));
          return;
        }

        updateSelectedRangeTarget(selection, ({ annotations }) => ({
          annotations: annotations.filter((annotation) => annotation.markerId !== markerId)
        }));
        return;
      }

      const missingTargets = selectedData.wordTargets.filter((target) => !target.annotations.some((annotation) => annotation.markerId === markerId));
      if (missingTargets.length === 0) {
        return;
      }

      const annotationByWordId = new Map<string, string>();
      const annotationRows: TablesInsert<"annotations">[] = missingTargets.map((target) => {
        const annotationId = createId();
        annotationByWordId.set(target.wordId, annotationId);

        return {
          id: annotationId,
          user_id: userId,
          user_song_id: selection.songId,
          line_index: target.lineIndex,
          word_index: target.wordIndex,
          target_type: "word",
          marker_id: markerId
        };
      });

      const { error } = await supabase.from("annotations").insert(annotationRows);
      if (error) {
        setStatusMessage(t("saveFailed"));
        return;
      }

      updateSelectedRangeTarget(selection, ({ wordId, annotations }) => {
        const annotationId = annotationByWordId.get(wordId);
        if (!annotationId || annotations.some((annotation) => annotation.markerId === markerId)) {
          return {};
        }

        return {
          annotations: [...annotations, { id: annotationId, markerId }]
        };
      });
      return;
    }

    const existing = selectedData.annotations.find((annotation) => annotation.markerId === markerId);
    if (existing) {
      const { error } = await supabase.from("annotations").delete().eq("id", existing.id).eq("user_id", userId);
      if (error) {
        setStatusMessage(t("saveFailed"));
        return;
      }
      updateSelectedTarget(selection, ({ annotations }) => ({
        annotations: annotations.filter((annotation) => annotation.id !== existing.id)
      }));
      return;
    }

    const annotationId = createId();
    const targetCoordinates = getTargetCoordinates(activeSong, selection);
    if (!targetCoordinates) {
      setStatusMessage(t("saveFailed"));
      return;
    }

    const annotationRow: TablesInsert<"annotations"> = {
      id: annotationId,
      user_id: userId,
      user_song_id: targetCoordinates.userSongId,
      line_index: targetCoordinates.lineIndex,
      word_index: targetCoordinates.wordIndex,
      target_type: selection.type,
      marker_id: markerId
    };
    const { error } = await supabase.from("annotations").insert(annotationRow);
    if (error) {
      setStatusMessage(t("saveFailed"));
      return;
    }

    updateSelectedTarget(selection, ({ annotations }) => ({
      annotations: [...annotations, { id: annotationId, markerId }]
    }));
  }

  async function persistAudioReference(target: SelectedTarget | { songId: string; type: "song" }, blob: Blob, label: string) {
    const normalizedLabel = label.trim();
    if (!normalizedLabel) {
      throw new Error("Audio label is required.");
    }
    const audioId = createId();
    const mimeType = blob.type || "audio/webm";
    const targetSong = songs.find((song) => song.id === target.songId);
    const targetCoordinates = target.type === "song" || !targetSong ? null : getTargetCoordinates(targetSong, target);
    if (target.type !== "song" && !targetCoordinates) {
      throw new Error("Missing target coordinates.");
    }

    const targetId =
      target.type === "song" ? target.songId : `word-${targetCoordinates!.lineIndex}-${targetCoordinates!.wordIndex}`;
    const storagePath = `${userId}/${target.songId}/${target.type}-${targetId}/${audioId}.${extensionFromMime(mimeType)}`;
    const { error: uploadError } = await supabase.storage.from(AUDIO_BUCKET).upload(storagePath, blob, {
      contentType: mimeType,
      upsert: false
    });

    if (uploadError) {
      throw uploadError;
    }

    const audioReference = makeAudioReference(storagePath, blob, normalizedLabel, audioId);
    const existingSelectedData = target.type === "song" ? null : findSelectedData(songs.find((song) => song.id === target.songId), target);
    const existingAudio = target.type === "song" ? undefined : existingSelectedData?.type === "range" ? undefined : existingSelectedData?.audioReference;

    if (existingAudio) {
      const { error } = await supabase.from("audio_references").delete().eq("id", existingAudio.id).eq("user_id", userId);
      if (error) {
        throw error;
      }
    }

    const row: TablesInsert<"audio_references"> = {
      id: audioReference.id,
      user_id: userId,
      user_song_id: target.songId,
      line_index: targetCoordinates?.lineIndex ?? null,
      word_index: targetCoordinates?.wordIndex ?? null,
      target_type: target.type,
      label: audioReference.label,
      storage_path: audioReference.storagePath,
      mime_type: audioReference.mimeType,
      size_bytes: audioReference.sizeBytes ?? null
    };

    const { error } = await supabase.from("audio_references").insert(row);

    if (error) {
      throw error;
    }

    if (existingAudio?.storagePath) {
      await deleteStoragePaths([existingAudio.storagePath]);
    }

    return audioReference;
  }

  async function removeAudioReferenceFromSelection() {
    if (!selection || selection.type === "range" || selectedData?.type === "range" || !selectedData?.audioReference) {
      return;
    }

    const storagePath = selectedData.audioReference.storagePath;
    const { error } = await supabase.from("audio_references").delete().eq("id", selectedData.audioReference.id).eq("user_id", userId);
    if (error) {
      setStatusMessage(t("deleteFailed"));
      return;
    }

    updateSelectedTarget(selection, () => ({ removeAudio: true }));
    await deleteStoragePaths([storagePath]);
    setStatusMessage(t("audioRemoved"));
  }

  async function startRecording() {
    if (!selection || selection.type === "range") {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatusMessage(t("unsupportedRecording"));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recordingSelectionRef.current = selection;
      recorderStreamRef.current = stream;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const recordedTarget = recordingSelectionRef.current;
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });

        recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
        recorderStreamRef.current = null;
        recorderRef.current = null;
        recordingSelectionRef.current = null;
        setRecordingTarget("");

        if (!recordedTarget || blob.size === 0) {
          return;
        }

        try {
          const audioReference = await persistAudioReference(recordedTarget, blob, t("recordingAudioName"));
          updateSelectedTarget(recordedTarget, () => ({ audioReference }));
          setStatusMessage(t("audioSaved"));
        } catch {
          setStatusMessage(t("uploadFailed"));
        }
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecordingTarget(selectedTargetKey(selection));
      setStatusMessage(t("recording"));
    } catch {
      setStatusMessage(t("microphoneDenied"));
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  async function playAudioReference(audioReference: AudioReference) {
    const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(audioReference.storagePath);
    if (error || !data) {
      setStatusMessage(t("audioMissing"));
      return;
    }

    const url = URL.createObjectURL(data);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => URL.revokeObjectURL(url);
    await audio.play();
  }

  async function uploadSongAudio(song: Song, file: File, label: string) {
    try {
      const audioReference = await persistAudioReference({ songId: song.id, type: "song" }, file, label);
      setSongs((currentSongs) =>
        currentSongs.map((item) => (item.id === song.id ? { ...item, songAudios: [...item.songAudios, audioReference], updatedAt: new Date().toISOString() } : item))
      );
      setSelectedSongAudioId(audioReference.id);
      setPreferredAudioProvider("file");
      setStatusMessage(t("songAudioSaved"));
    } catch {
      setStatusMessage(t("uploadFailed"));
    }
  }

  async function removeSongAudio(song: Song, audioReference: AudioReference) {
    const { error } = await supabase.from("audio_references").delete().eq("id", audioReference.id).eq("user_id", userId);
    if (error) {
      setStatusMessage(t("deleteFailed"));
      return;
    }

    await deleteStoragePaths([audioReference.storagePath]);
    setSongs((currentSongs) =>
      currentSongs.map((item) =>
        item.id === song.id ? { ...item, songAudios: item.songAudios.filter((itemAudio) => itemAudio.id !== audioReference.id), updatedAt: new Date().toISOString() } : item
      )
    );
    setStatusMessage(t("songAudioRemoved"));
  }

  const popoverStyle = selection
    ? ({
        "--popover-left": `${selection.x + 12}px`,
        "--popover-top": `${selection.y + 12}px`
      } as CSSProperties)
    : undefined;
  const profileDisplayName = profile.displayName?.trim() || userEmail || t("profileFallbackName");
  const profileMeta = profile.vocalGoal?.trim() || t("profileFallbackMeta");

  return (
    <div
      className="vocalmap-shell"
      data-sidebar-collapsed={isSidebarCollapsed}
    >
      <div className="vocalmap-backdrop" />

      <header className="mobile-app-bar lg:hidden">
        <button
          className="flex min-w-0 items-center gap-2 rounded-xl px-1 py-1 text-left transition hover:bg-white/70 active:scale-[0.98]"
          type="button"
          onClick={() => {
            setIsSidebarCollapsed(false);
            setIsMobileLibraryOpen(true);
          }}
          aria-label={t("openLibrary")}
          title={t("openLibrary")}
        >
          <span className="grid size-10 flex-none place-items-center rounded-xl bg-[var(--vm-ink)] text-white">
            <Library size={18} />
          </span>
          <span className="min-w-0">
            <Image className="h-auto w-28" src="/images/vocalmapp-logo-green.svg" alt={common("appName")} width={196} height={93} priority />
            <span className="mt-0.5 block truncate text-[0.625rem] font-bold uppercase tracking-[0.13em] text-stone-500">{t("libraryTitle")}</span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          <button
            className={`mobile-app-bar-action ${isSettingsOpen ? "is-active" : ""}`}
            type="button"
            onClick={() => {
              setIsSettingsOpen((isOpen) => !isOpen);
              setActiveSettingsPanel("markers");
              setIsMarkerFormOpen(false);
              setEditingMarkerId(null);
              setSelectedMarkerId(null);
            }}
            aria-expanded={isSettingsOpen}
            aria-label={t("settingsTitle")}
            title={t("settingsTitle")}
          >
            <Settings2 size={18} />
          </button>
          <button className="mobile-app-bar-action is-primary" type="button" onClick={openManualDraft} aria-label={t("newSong")} title={t("newSong")}>
            <Plus size={19} />
          </button>
        </div>
      </header>

      {isMobileLibraryOpen ? (
        <button className="mobile-library-backdrop lg:hidden" type="button" onClick={() => setIsMobileLibraryOpen(false)} aria-label={t("closeLibrary")} />
      ) : null}

      <aside
        className="vocalmap-library"
        data-collapsed={isSidebarCollapsed}
        data-mobile-open={isMobileLibraryOpen}
        aria-label={t("libraryTitle")}
      >
        {isSidebarCollapsed ? (
          <div className="hidden w-full items-center justify-between gap-2 lg:flex lg:w-10 lg:flex-col lg:justify-start">
            <button
              className="grid h-10 w-12 flex-none place-items-center rounded-xl px-1 transition hover:bg-emerald-50"
              type="button"
              onClick={() => setIsSidebarCollapsed(false)}
              aria-label={t("expandLibrary")}
              title={t("expandLibrary")}
            >
              <Image className="h-auto w-full" src="/images/vocalmapp-sidebar-logo.svg" alt={common("appName")} width={286} height={36} priority />
            </button>
            <div className="flex items-center gap-2 lg:w-10 lg:flex-col lg:items-center">
              <button
                className="inline-grid size-9 flex-none place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:border-stone-300 hover:bg-stone-50"
                type="button"
                onClick={() => setIsSidebarCollapsed(false)}
                aria-label={t("expandLibrary")}
                title={t("expandLibrary")}
              >
                <PanelLeftOpen size={17} />
              </button>
              <button
                className={`inline-grid size-9 flex-none place-items-center rounded-full border bg-white text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 ${
                  isSettingsOpen ? "border-stone-300 bg-stone-50 text-stone-950" : "border-stone-200"
                }`}
                type="button"
                onClick={() => {
                  setIsSettingsOpen((isOpen) => !isOpen);
                  setActiveSettingsPanel("markers");
                  setIsMarkerFormOpen(false);
                  setEditingMarkerId(null);
                  setSelectedMarkerId(null);
                  setIsMobileLibraryOpen(false);
                }}
                aria-expanded={isSettingsOpen}
                aria-label={t("settingsTitle")}
                title={t("settingsTitle")}
              >
                <Settings2 size={17} />
              </button>
              <button
                className="inline-grid size-9 flex-none place-items-center rounded-full border border-emerald-200 bg-emerald-600 text-white transition hover:bg-emerald-700"
                type="button"
                onClick={openManualDraft}
                aria-label={t("newSong")}
                title={t("newSong")}
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
        ) : (
          <>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Image className="h-auto w-44 flex-none" src="/images/vocalmapp-sidebar-logo.svg" alt={common("appName")} width={286} height={36} priority />
          </div>
          <div className="flex flex-none items-center gap-2">
              <button
                className={`inline-grid size-9 flex-none place-items-center rounded-full border bg-white text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 ${
                  isSettingsOpen ? "border-stone-300 bg-stone-50 text-stone-950" : "border-stone-200"
                }`}
                type="button"
                onClick={() => {
                  setIsSettingsOpen((isOpen) => !isOpen);
                  setActiveSettingsPanel("markers");
                  setIsMarkerFormOpen(false);
                  setEditingMarkerId(null);
                  setSelectedMarkerId(null);
                  setIsMobileLibraryOpen(false);
                }}
                aria-expanded={isSettingsOpen}
                aria-label={t("settingsTitle")}
                title={t("settingsTitle")}
              >
                <Settings2 size={17} />
              </button>
            <button
              className="inline-grid size-9 flex-none place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 lg:hidden"
              type="button"
              onClick={() => setIsMobileLibraryOpen(false)}
              aria-label={t("closeLibrary")}
              title={t("closeLibrary")}
            >
              <X size={17} />
            </button>
            <button
              className="hidden size-9 flex-none place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 lg:inline-grid"
              type="button"
              onClick={() => setIsSidebarCollapsed(true)}
              aria-label={t("collapseLibrary")}
              title={t("collapseLibrary")}
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
        </div>

        {activeSong ? (
          <SongMenuCard
            song={activeSong}
            onEdit={(song) => {
              setOpenSongOptionsId(null);
              setIsMobileLibraryOpen(false);
              openSongEditor(song);
            }}
            onDelete={(song) => {
              setOpenSongOptionsId(null);
              void deleteSong(song);
            }}
            optionsOpen={openSongOptionsId === `active:${activeSong.id}`}
            onToggleOptions={() => setOpenSongOptionsId((currentId) => (currentId === `active:${activeSong.id}` ? null : `active:${activeSong.id}`))}
            labels={{
              coverAlt: t("coverAlt", { title: activeSong.title }),
              noArtist: common("noArtist"),
              lines: t("linesCount", { count: activeSong.lyrics.length }),
              markers: t("markersCount", { count: countMarkedTargets(activeSong) }),
              youtube: common("youtube"),
              workspaceHint: t("workspaceHint"),
              edit: common("edit"),
              delete: common("delete"),
              options: t("songOptions")
            }}
          />
        ) : null}

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t border-stone-200 pt-3 pr-1">
        <section className="grid min-h-0 gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase text-stone-500">
              <Library size={14} />
              <span className="truncate">{t("libraryTitle")}</span>
            </div>
            <button
              className={`inline-grid size-8 flex-none place-items-center rounded-full border bg-white text-stone-700 transition hover:border-emerald-200 hover:bg-emerald-50 ${
                isLibrarySearchOpen || localSearch ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-stone-200"
              }`}
              type="button"
              onClick={() => {
                if (isLibrarySearchOpen && !localSearch) {
                  setIsLibrarySearchOpen(false);
                  return;
                }

                setIsLibrarySearchOpen(true);
              }}
              aria-label={t("librarySearchPlaceholder")}
              title={t("librarySearchPlaceholder")}
            >
              <Search size={15} />
            </button>
          </div>
          {isLibrarySearchOpen ? (
            <input
              ref={librarySearchInputRef}
              className={inputClass}
              value={localSearch}
              onChange={(event) => setLocalSearch(event.target.value)}
              placeholder={t("librarySearchPlaceholder")}
            />
          ) : null}
          <div className="grid min-h-0 gap-1 pr-1">
            {filteredSongs.map((song) => (
              <div
                className={`relative grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-1 rounded-md border transition ${
                  song.id === effectiveActiveSongId ? "border-emerald-200 bg-emerald-50" : "border-transparent hover:border-emerald-100 hover:bg-emerald-50/60"
                }`}
                key={song.id}
                data-song-options-menu="true"
              >
                <button
                  className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2 px-2 py-1.5 text-left"
                  type="button"
                  onClick={() => {
                    activateSong(song.id);
                    setEditingSongId(null);
                    setIsMobileLibraryOpen(false);
                    closeNoteEditor();
                    setOpenSongOptionsId(null);
                    setSelection(null);
                  }}
                >
                  {song.thumbnailUrl ? (
                    <Image className="rounded object-cover" src={song.thumbnailUrl} alt={t("coverAlt", { title: song.title })} width={28} height={28} />
                  ) : (
                    <FileText className="text-stone-500" size={17} />
                  )}
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-semibold text-stone-950">{song.title}</strong>
                    <small className="block truncate text-xs text-stone-500">
                      {t("songListMeta", {
                        artist: song.artist ?? common("noArtist"),
                        count: countMarkedTargets(song)
                      })}
                    </small>
                  </span>
                </button>
                <button
                  className={`mr-1 inline-grid size-7 place-items-center rounded-full border bg-white text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 ${
                    openSongOptionsId === `library:${song.id}` ? "border-stone-300 bg-stone-50" : "border-stone-200"
                  }`}
                  type="button"
                  onClick={() => setOpenSongOptionsId((currentId) => (currentId === `library:${song.id}` ? null : `library:${song.id}`))}
                  aria-expanded={openSongOptionsId === `library:${song.id}`}
                  aria-haspopup="menu"
                  aria-label={t("songOptions")}
                  title={t("songOptions")}
                >
                  <Ellipsis size={15} />
                </button>
                {openSongOptionsId === `library:${song.id}` ? (
                  <div className="absolute right-1 top-9 z-30 w-48 rounded-xl border border-stone-200 bg-white p-1.5" role="menu">
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-stone-700 transition hover:bg-stone-50"
                      type="button"
                      onClick={() => {
                        setOpenSongOptionsId(null);
                        openSongEditor(song);
                      }}
                      role="menuitem"
                    >
                      <Pencil size={13} />
                      {common("edit")}
                    </button>
                    <button
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-700 transition hover:bg-red-50"
                      type="button"
                      onClick={() => {
                        setOpenSongOptionsId(null);
                        void deleteSong(song);
                      }}
                      role="menuitem"
                    >
                      <Trash2 size={13} />
                      {common("delete")}
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
            {filteredSongs.length === 0 ? <p className="text-sm text-stone-500">{t("emptyLibrary")}</p> : null}
          </div>
        </section>
        </div>

        <button
          className={`${primaryButtonClass} w-full flex-none`}
          type="button"
          onClick={() => {
            setIsMobileLibraryOpen(false);
            openManualDraft();
          }}
        >
          <Plus size={16} />
          {t("newSong")}
        </button>

        <div className="relative flex flex-none items-center gap-2 border-t border-stone-200 px-1 py-3" data-profile-menu="true">
          <button
            className="flex min-w-0 flex-1 items-center gap-3 text-left transition hover:bg-stone-50/70"
            type="button"
            onClick={() => {
              setProfileDraft({
                displayName: profile.displayName ?? "",
                vocalGoal: profile.vocalGoal ?? ""
              });
              setProfileError("");
              setIsProfileMenuOpen(false);
              setIsMobileLibraryOpen(false);
              setIsProfileModalOpen(true);
            }}
          >
            <span className="grid size-10 flex-none place-items-center rounded-xl border border-stone-200 bg-white text-stone-600">
              <UserRound size={18} />
            </span>
            <span className="min-w-0">
              <strong className="block truncate text-sm font-bold text-stone-950">{profileDisplayName}</strong>
              <small className="block truncate text-xs leading-5 text-stone-500">{profileMeta}</small>
            </span>
          </button>
          <button
            className={`inline-grid size-9 flex-none place-items-center rounded-full border bg-white text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 ${
              isProfileMenuOpen ? "border-stone-300 bg-stone-50" : "border-stone-200"
            }`}
            type="button"
            onClick={() => setIsProfileMenuOpen((isOpen) => !isOpen)}
            aria-expanded={isProfileMenuOpen}
            aria-haspopup="menu"
            aria-label={t("profileMenu")}
            title={t("profileMenu")}
          >
            <Ellipsis size={18} />
          </button>
          {isProfileMenuOpen ? (
            <div className="absolute bottom-[calc(100%+0.5rem)] right-1 z-30 w-44 rounded-xl border border-stone-200 bg-white p-1.5 shadow-[0_18px_45px_rgba(28,25,23,0.14)]" role="menu">
              <form action={signOutAction}>
                <button className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-red-700 transition hover:bg-red-50" type="submit" role="menuitem">
                  <LogOut size={16} />
                  {common("signOut")}
                </button>
              </form>
            </div>
          ) : null}
        </div>
          </>
        )}
      </aside>

      <section className={`vocalmap-workspace ${activeAudioProvider && !editingSongId ? "has-audio-dock" : ""}`}>
        {editingSongId ? (
          <div className="song-editor-card mx-auto max-w-6xl rounded-[1.5rem] border border-white/70 bg-white/[0.96] p-4 shadow-[0_28px_80px_rgba(0,104,83,0.16)] backdrop-blur-md sm:p-5">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-stone-500">{editingSongId === "new" ? t("editorNew") : t("editorEdit")}</p>
                <h1 className="mt-1 text-3xl font-bold leading-tight text-stone-950 sm:text-4xl">{draft.title || common("untitledSong")}</h1>
              </div>
            </div>

            <div className="mb-4">
              <SongSearch
                onSelect={importYouTubeVideo}
                labels={{
                  placeholder: t("musicSearchPlaceholder"),
                  search: common("search"),
                  queryRequired: t("queryRequired"),
                  noResults: t("youtubeNoResults"),
                  authRequired: t("youtubeAuthRequired"),
                  queryTooLong: t("youtubeQueryTooLong"),
                  rateLimited: t("youtubeRateLimited"),
                  missingApiKey: t("youtubeMissingApiKey"),
                  invalidApiKey: t("youtubeInvalidApiKey"),
                  quotaExceeded: t("youtubeQuotaExceeded"),
                  searchFailed: t("youtubeSearchFailed"),
                  unavailable: t("youtubeUnavailable"),
                  resultCount: (count) => t("searchResultsCount", { count })
                }}
              />
            </div>

            <section className="grid gap-4 rounded-2xl border border-stone-200 bg-white p-3 sm:p-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-bold uppercase text-stone-500">
                  <span className="grid size-5 place-items-center rounded-full bg-emerald-600 text-[11px] leading-none text-white">2</span>
                  {t("songFlowDetailsTitle")}
                </p>
                <p className="mt-1 text-sm leading-5 text-stone-600">{t("songFlowDetailsBody")}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-semibold text-stone-700">
                  {t("titleLabel")}
                  <input className={inputClass} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label className="grid gap-2 text-sm font-semibold text-stone-700">
                  {t("artistLabel")}
                  <input className={inputClass} value={draft.artist} onChange={(event) => setDraft((current) => ({ ...current, artist: event.target.value }))} />
                </label>
              </div>

              {songDraftHasImportedDetails ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                  {draft.thumbnailUrl ? <Image className="rounded-md object-cover" src={draft.thumbnailUrl} alt={draft.title ? t("coverAlt", { title: draft.title }) : t("importedCoverAlt")} width={96} height={54} /> : null}
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase text-stone-500">{t("importedFromYouTube")}</p>
                    <p className="mt-1 text-sm text-stone-600">
                      {draft.channelTitle ?? ""} · {formatDuration(draft.durationMs)}
                    </p>
                    {draft.youtubeVideoId ? (
                      <a className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700" href={`https://www.youtube.com/watch?v=${encodeURIComponent(draft.youtubeVideoId)}`} target="_blank" rel="noreferrer">
                        {common("openOnYouTube")} <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <label className="grid gap-2 text-sm font-semibold text-stone-700">
                {t("lyricsLabel")}
                <textarea
                  className="min-h-[34dvh] w-full resize-y rounded-xl border border-stone-200 bg-white p-4 text-base leading-7 text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  value={draft.lyricsText}
                  onChange={(event) => setDraft((current) => ({ ...current, lyricsText: event.target.value }))}
                  placeholder={t("lyricsPlaceholder")}
                />
              </label>
            </section>

            <section className="mt-4 grid gap-3 rounded-2xl border border-stone-200 bg-white p-3 sm:p-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-bold uppercase text-stone-500">
                  <span className={`grid size-5 place-items-center rounded-full text-[11px] leading-none text-white ${songDraftIsComplete ? "bg-emerald-600" : "bg-stone-300"}`}>3</span>
                  {t("songFlowAudioTitle")}
                </p>
                <p className="mt-1 text-sm leading-5 text-stone-600">{t("songFlowAudioBody")}</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className={`${secondaryButtonClass} min-h-11 cursor-pointer ${!songDraftIsComplete ? "pointer-events-none opacity-60" : ""}`}>
                  <Upload size={16} />
                  {pendingSongAudioFile ? t("replaceAudioFile") : t("chooseAudioFile")}
                  <input
                    className="sr-only"
                    type="file"
                    accept="audio/*"
                    disabled={!songDraftIsComplete}
                    onChange={(event) => setPendingSongAudioFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                {draft.youtubeVideoId ? (
                  <a className={`${secondaryButtonClass} min-h-11`} href={`https://www.youtube.com/watch?v=${encodeURIComponent(draft.youtubeVideoId)}`} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} />
                    {common("openOnYouTube")}
                  </a>
                ) : (
                  <p className="flex min-h-11 items-center rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm leading-5 text-stone-500">
                    {t("youtubeSelectionRequired")}
                  </p>
                )}
              </div>
              {pendingSongAudioFile ? <p className="text-sm font-medium text-emerald-700">{t("selectedAudioFile", { name: pendingSongAudioFile.name })}</p> : null}
            </section>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className={secondaryButtonClass} type="button" onClick={() => setEditingSongId(null)}>
                <X size={16} />
                {common("close")}
              </button>
              <button className={`${primaryButtonClass} min-w-28`} type="button" onClick={() => void saveDraft()} disabled={!songDraftIsComplete || isSaving}>
                {isSaving ? <Loader2 className="spin size-4" /> : null}
                {isSaving ? common("saving") : common("save")}
              </button>
            </div>
          </div>
        ) : activeSong ? (
          <article className="lyrics-document" style={areLyricPreferencesReady ? undefined : { visibility: "hidden" }}>
            <div className="lyrics-sheet">
              {activeSong.lyrics.length === 0 || activeSong.lyrics.every((line) => line.text.trim().length === 0) ? (
                <div className="grid min-h-72 place-items-center content-center gap-3 text-center text-stone-500">
                  <FileText size={24} />
                  <p>{t("emptyDocument")}</p>
                </div>
              ) : (
                activeSong.lyrics.map((line) => (
                  <LyricsLine
                    key={line.id}
                    line={line}
                    songId={activeSong.id}
                    onWordPointerDown={beginWordSelection}
                    onWordPointerMove={updateWordSelectionFromPointer}
                    onWordPointerUp={finishWordSelection}
                    onWordPointerCancel={cancelWordSelection}
                    onWordKeyboardSelect={selectWordFromKeyboard}
                    onSeekToTimestamp={seekToTimestamp}
                    onPlayAudio={(audioReference) => void playAudioReference(audioReference)}
                    markerById={markerById}
                    selectedWordIds={selectedWordIds}
                    lyricTextStyle={lyricTextStyle}
                    lyricLineStyle={lyricLineStyle}
                    lyricWordsStyle={lyricWordsStyle}
                    labels={{
                      wordAudio: t("wordAudioTitle"),
                      note: t("noteTitle")
                    }}
                  />
                ))
              )}
            </div>
          </article>
        ) : (
          <div className="mx-auto grid h-full min-h-[24rem] max-w-lg place-items-center content-center">
            <div className="grid w-full justify-items-center gap-4 rounded-[1.5rem] border border-white/70 bg-white/[0.92] p-8 text-center shadow-[0_28px_80px_rgba(0,104,83,0.18)] backdrop-blur-md">
              <Image className="h-auto w-40" src="/images/vocalmapp-logo-green.svg" alt={common("appName")} width={196} height={93} priority />
              <h1 className="text-2xl font-bold text-stone-950 sm:text-3xl">{t("emptyWorkspaceTitle")}</h1>
              <p className="max-w-md text-sm leading-6 text-stone-600 sm:text-base sm:leading-7">{t("emptyWorkspaceBody")}</p>
              <button className={`${primaryButtonClass} min-w-36`} type="button" onClick={openManualDraft}>
                <Plus size={16} />
                {t("newSong")}
              </button>
            </div>
          </div>
        )}
      </section>

      {activeSong && !editingSongId ? (
        <SongPlayerDock
          song={activeSong}
          provider={activeAudioProvider}
          selectedAudioId={selectedSongAudioId}
          onProviderChange={setPreferredAudioProvider}
          onSelectedAudioChange={setSelectedSongAudioId}
          onUpload={(song, file, label) => void uploadSongAudio(song, file, label)}
          onRemove={(song, audioReference) => void removeSongAudio(song, audioReference)}
          seekRequest={playerSeekRequest}
          onTimeUpdate={setPlayerTimeMs}
          onPlayerError={handleYouTubePlayerError}
          supabase={supabase}
          labels={{
            nowPlaying: t("audioDockNowPlaying"),
            youtube: common("youtube"),
            file: t("audioDockFile"),
            fileSelect: t("audioDockFileSelect"),
            noFile: t("audioDockNoFile"),
            deleteAudio: t("deleteSongAudio"),
            addFile: t("addAudioFile"),
            audioNameTitle: t("audioNameTitle"),
            audioNameLabel: t("audioNameLabel"),
            audioNamePlaceholder: t("audioNamePlaceholder"),
            audioNameInstrumental: t("audioNameInstrumental"),
            audioNameOriginal: t("audioNameOriginal"),
            audioNameCover: t("audioNameCover"),
            audioNameRequired: t("audioNameRequired"),
            audioUploadDialogBody: t("audioUploadDialogBody"),
            chooseAudioFile: t("chooseAudioFile"),
            changeAudioFile: t("changeAudioFile"),
            noAudioFile: t("noAudioFile"),
            cancel: common("cancel"),
            close: common("close"),
            youtubeTitle: t("youtubePlayerTitle", { title: activeSong.title }),
            audioNotice: t("youtubeAudioNotice"),
            expand: t("expandPlayer"),
            collapse: t("collapsePlayer")
          }}
        />
      ) : null}

      {isSettingsOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-stone-950/30 px-4 py-6 backdrop-blur-sm">
          <section className="grid h-[calc(100dvh-3rem)] max-h-[54rem] w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-stone-200 bg-white" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-stone-950" id="settings-title">{t("settingsTitle")}</h2>
                <p className="mt-0.5 text-xs text-stone-500">{t("settingsSubtitle")}</p>
              </div>
              <button
                className="inline-grid size-8 flex-none place-items-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-950"
                type="button"
                onClick={() => {
                  setIsSettingsOpen(false);
                  setIsMarkerFormOpen(false);
                  setEditingMarkerId(null);
                  setSelectedMarkerId(null);
                  setActiveSettingsPanel("markers");
                }}
                title={common("close")}
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid min-h-0 grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)]">
              <nav className="flex overflow-x-auto border-b border-stone-200 bg-white md:block md:overflow-visible md:border-b-0 md:border-r">
                <button
                  className={`flex min-w-48 items-center justify-between gap-3 border-r border-stone-200 px-3 py-3 text-left transition md:w-full md:border-b md:border-r-0 ${
                    activeSettingsPanel === "markers" ? "bg-emerald-50/50" : "bg-white hover:bg-stone-50"
                  }`}
                  type="button"
                  onClick={() => setActiveSettingsPanel("markers")}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="grid size-7 flex-none place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                      <Sparkles size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-stone-950">{t("markerPanelTitle")}</span>
                      <span className="block truncate text-xs text-stone-500">{t("markerCount", { count: visibleMarkers.length })}</span>
                    </span>
                  </span>
                </button>
                <button
                  className={`flex min-w-48 items-center justify-between gap-3 border-r border-stone-200 px-3 py-3 text-left transition md:w-full md:border-b md:border-r-0 ${
                    activeSettingsPanel === "lyrics" ? "bg-emerald-50/50" : "bg-white hover:bg-stone-50"
                  }`}
                  type="button"
                  onClick={() => {
                    setActiveSettingsPanel("lyrics");
                    setIsMarkerFormOpen(false);
                    setEditingMarkerId(null);
                    setSelectedMarkerId(null);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="grid size-7 flex-none place-items-center rounded-lg bg-stone-50 text-stone-700">
                      <FileText size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-stone-950">{t("songTextSettingsTitle")}</span>
                      <span className="block truncate text-xs text-stone-500">{t("songTextSettingsSummary", { size: lyricTextSize, lineSpacing: lyricLineSpacing, wordSpacing: lyricWordSpacing })}</span>
                    </span>
                  </span>
                </button>
              </nav>

              <div className="min-h-0 overflow-auto">
                {activeSettingsPanel === "markers" ? (
                <div className="grid divide-y divide-stone-200">
                  <div className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-stone-950">{t("markerPanelTitle")}</h3>
                      <p className="mt-1 text-xs leading-5 text-stone-500">{t("markerPanelHint")}</p>
                    </div>
                    <button
                      className="inline-flex h-7 flex-none items-center justify-center gap-1 rounded-full bg-emerald-600 px-2.5 text-[0.6875rem] font-semibold text-white transition hover:bg-emerald-700"
                      type="button"
                      onClick={openMarkerCreate}
                    >
                      <Plus size={12} />
                      {t("markerAddAction")}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1 p-4">
                    {visibleMarkers.map((marker) => {
                      const Icon = markerIcons[marker.icon];
                      const isSelected = selectedMarkerId === marker.id;
                      return (
                        <button
                          className={`inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border px-2 text-[0.6875rem] font-medium leading-none transition ${
                            isSelected ? "ring-1 ring-emerald-300 ring-offset-1 ring-offset-white" : ""
                          }`}
                          type="button"
                          key={marker.id}
                          style={makeMarkerStyle(marker)}
                          onClick={() => {
                            setSelectedMarkerId((currentId) => (currentId === marker.id ? null : marker.id));
                            setIsMarkerFormOpen(false);
                            setEditingMarkerId(null);
                          }}
                          title={marker.meaning}
                          aria-pressed={isSelected}
                        >
                          <Icon size={10} strokeWidth={2.2} />
                          <span className="truncate">{marker.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedMarker && !isMarkerFormOpen ? (
                    <div className="grid gap-2 bg-stone-50/70 p-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="size-3 flex-none rounded-full" style={{ backgroundColor: selectedMarker.color }} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-stone-950">{selectedMarker.label}</p>
                          <p className="truncate text-xs leading-5 text-stone-500">{selectedMarker.meaning}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button className={`${secondaryButtonClass} min-h-9 px-3 py-1.5 text-xs`} type="button" onClick={() => moveMarker(selectedMarker.id, -1)} disabled={selectedMarkerIndex <= 0}>
                          <ArrowUp size={13} />
                          {t("markerMoveUp")}
                        </button>
                        <button className={`${secondaryButtonClass} min-h-9 px-3 py-1.5 text-xs`} type="button" onClick={() => moveMarker(selectedMarker.id, 1)} disabled={selectedMarkerIndex < 0 || selectedMarkerIndex >= visibleMarkers.length - 1}>
                          <ArrowDown size={13} />
                          {t("markerMoveDown")}
                        </button>
                        <button className={`${secondaryButtonClass} min-h-9 px-3 py-1.5 text-xs`} type="button" onClick={() => openMarkerEdit(selectedMarker)}>
                          <Pencil size={13} />
                          {common("edit")}
                        </button>
                        <button className={`${secondaryButtonClass} min-h-9 px-3 py-1.5 text-xs text-red-700 hover:border-red-200 hover:bg-red-50`} type="button" onClick={() => void removeMarker(selectedMarker.id)}>
                          <Trash2 size={13} />
                          {selectedMarker.isSystem ? t("markerHide") : common("delete")}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {hiddenSystemMarkerIds.size > 0 || Object.keys(systemMarkerOverrides).length > 0 ? (
                    <button className="justify-self-start p-4 text-xs font-semibold text-emerald-700 transition hover:text-emerald-900" type="button" onClick={resetSystemMarkers}>
                      {t("markerResetDefaults")}
                    </button>
                  ) : null}

                  {isMarkerFormOpen ? (
                    <form className="grid gap-2.5 bg-white p-4" onSubmit={(event) => void saveMarker(event)}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[0.6875rem] font-semibold uppercase text-stone-500">{editingMarkerId ? t("markerEditTitle") : t("markerCreateTitle")}</p>
                        <button className="inline-grid size-7 place-items-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-950" type="button" onClick={closeMarkerForm} title={common("close")}>
                          <X size={14} />
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          className={`${inputClass} h-9 rounded-xl px-3 text-sm`}
                          value={customMarkerDraft.label}
                          onChange={(event) => setCustomMarkerDraft((current) => ({ ...current, label: event.target.value }))}
                          placeholder={t("markerNamePlaceholder")}
                          maxLength={14}
                        />
                        <input
                          className={`${inputClass} h-9 rounded-xl px-3 text-sm`}
                          value={customMarkerDraft.meaning}
                          onChange={(event) => setCustomMarkerDraft((current) => ({ ...current, meaning: event.target.value }))}
                          placeholder={t("markerMeaningPlaceholder")}
                        />
                      </div>
                      <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50/70 p-2">
                        <div className="flex items-center gap-2">
                          <label className="relative grid size-9 flex-none cursor-pointer place-items-center overflow-hidden rounded-xl border border-stone-200 bg-white p-1" title={t("markerColorTitle")}>
                            <span className="size-full rounded-lg" style={{ backgroundColor: customMarkerDraft.color }} />
                            <input
                              className="absolute inset-0 cursor-pointer opacity-0"
                              type="color"
                              value={customMarkerDraft.color}
                              onChange={(event) => setCustomMarkerDraft((current) => ({ ...current, color: event.target.value }))}
                              aria-label={t("markerColorTitle")}
                            />
                          </label>
                          <span
                            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border bg-white px-2.5 py-1.5 text-xs font-medium"
                            style={{
                              color: customMarkerDraft.color,
                              borderColor: `${customMarkerDraft.color}55`,
                              backgroundColor: `${customMarkerDraft.color}10`
                            }}
                          >
                            {(() => {
                              const Icon = markerIcons[customMarkerDraft.icon];
                              return <Icon size={14} strokeWidth={2.2} />;
                            })()}
                            <span className="truncate">{customMarkerDraft.label.trim() || t("markerNamePlaceholder")}</span>
                          </span>
                        </div>
                        <div className="grid grid-cols-7 gap-1 sm:flex sm:flex-wrap" role="radiogroup" aria-label="Marker icon">
                          {MARKER_ICON_OPTIONS.map((option) => {
                            const Icon = markerIcons[option.value];
                            const isIconSelected = customMarkerDraft.icon === option.value;

                            return (
                              <button
                                className={`grid size-7 place-items-center rounded-lg border transition hover:border-stone-300 hover:bg-white ${
                                  isIconSelected ? "border-stone-800 bg-white ring-1 ring-stone-200" : "border-stone-200 bg-stone-50"
                                }`}
                                type="button"
                                key={option.value}
                                onClick={() => setCustomMarkerDraft((current) => ({ ...current, icon: option.value }))}
                                role="radio"
                                aria-checked={isIconSelected}
                                aria-label={markerIconLabels(option.value)}
                                title={markerIconLabels(option.value)}
                              >
                                <Icon size={14} strokeWidth={2.2} />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <button className={`${secondaryButtonClass} min-h-9 rounded-xl px-3 py-1.5 text-sm font-medium`} type="button" onClick={closeMarkerForm}>
                          {common("cancel")}
                        </button>
                        <button className={`${primaryButtonClass} min-h-9 rounded-xl px-3 py-1.5 text-sm font-medium`} type="submit">
                          {editingMarkerId ? t("markerUpdate") : common("add")}
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
                ) : (
                  <div className="grid gap-4 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-stone-950">{t("songTextSettingsTitle")}</h3>
                        <p className="mt-1 text-xs leading-5 text-stone-500">{t("songTextSettingsHint")}</p>
                      </div>
                      <span className="flex-none rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-semibold text-stone-700">
                        {t("songTextSettingsSummary", { size: lyricTextSize, lineSpacing: lyricLineSpacing, wordSpacing: lyricWordSpacing })}
                      </span>
                    </div>

                    <div className="grid gap-5 rounded-xl border border-stone-200 bg-stone-50/70 p-3">
                      <label className="grid gap-2 text-xs font-semibold uppercase text-stone-500">
                        {t("songTextSizeLabel")}
                        <input
                          className="accent-emerald-600"
                          type="range"
                          min={MIN_LYRIC_TEXT_SIZE}
                          max={MAX_LYRIC_TEXT_SIZE}
                          step={1}
                          value={lyricTextSize}
                          onChange={(event) => updateLyricTextSize(Number(event.target.value))}
                        />
                      </label>
                      <div className="flex items-center justify-between text-[0.6875rem] font-medium text-stone-500">
                        <span>{MIN_LYRIC_TEXT_SIZE}px</span>
                        <span>{MAX_LYRIC_TEXT_SIZE}px</span>
                      </div>

                      <label className="grid gap-2 text-xs font-semibold uppercase text-stone-500">
                        {t("songTextLineSpacingLabel")}
                        <input
                          className="accent-emerald-600"
                          type="range"
                          min={MIN_LYRIC_LINE_SPACING}
                          max={MAX_LYRIC_LINE_SPACING}
                          step={1}
                          value={lyricLineSpacing}
                          onChange={(event) => updateLyricLineSpacing(Number(event.target.value))}
                        />
                      </label>
                      <div className="flex items-center justify-between text-[0.6875rem] font-medium text-stone-500">
                        <span>{MIN_LYRIC_LINE_SPACING}px</span>
                        <span>{MAX_LYRIC_LINE_SPACING}px</span>
                      </div>

                      <label className="grid gap-2 text-xs font-semibold uppercase text-stone-500">
                        {t("songTextWordSpacingLabel")}
                        <input
                          className="accent-emerald-600"
                          type="range"
                          min={MIN_LYRIC_WORD_SPACING}
                          max={MAX_LYRIC_WORD_SPACING}
                          step={1}
                          value={lyricWordSpacing}
                          onChange={(event) => updateLyricWordSpacing(Number(event.target.value))}
                        />
                      </label>
                      <div className="flex items-center justify-between text-[0.6875rem] font-medium text-stone-500">
                        <span>{MIN_LYRIC_WORD_SPACING}px</span>
                        <span>{MAX_LYRIC_WORD_SPACING}px</span>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <p className="text-xs font-semibold uppercase text-stone-500">{t("songTextSizeLabel")}</p>
                      <div className="flex flex-wrap gap-2">
                      {[12, 16, 18].map((size) => (
                        <button
                          className={`inline-flex min-h-8 items-center justify-center rounded-full border px-3 text-xs font-medium transition ${
                            lyricTextSize === size ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                          }`}
                          type="button"
                          key={size}
                          onClick={() => updateLyricTextSize(size)}
                        >
                          {t("songTextSizeValue", { size })}
                        </button>
                      ))}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <p className="text-xs font-semibold uppercase text-stone-500">{t("songTextLineSpacingLabel")}</p>
                      <div className="flex flex-wrap gap-2">
                        {[2, 4, 8].map((spacing) => (
                          <button
                            className={`inline-flex min-h-8 items-center justify-center rounded-full border px-3 text-xs font-medium transition ${
                              lyricLineSpacing === spacing ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                            }`}
                            type="button"
                            key={spacing}
                            onClick={() => updateLyricLineSpacing(spacing)}
                          >
                            {t("songTextLineSpacingValue", { spacing })}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <p className="text-xs font-semibold uppercase text-stone-500">{t("songTextWordSpacingLabel")}</p>
                      <div className="flex flex-wrap gap-2">
                        {[2, 4, 8].map((spacing) => (
                          <button
                            className={`inline-flex min-h-8 items-center justify-center rounded-full border px-3 text-xs font-medium transition ${
                              lyricWordSpacing === spacing ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
                            }`}
                            type="button"
                            key={spacing}
                            onClick={() => updateLyricWordSpacing(spacing)}
                          >
                            {t("songTextWordSpacingValue", { spacing })}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-stone-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase text-stone-500">{t("songTextPreviewLabel")}</p>
                      <div className="mt-3 grid text-stone-950">
                        {["I took your heart", "I did things to you", "Only lovers would do in the dark"].map((line) => (
                          <p className="flex flex-wrap" key={line} style={{ ...lyricTextStyle, ...lyricLineStyle, ...lyricWordsStyle }}>
                            {line.split(" ").map((word, wordIndex) => (
                              <span key={`${line}-${wordIndex}`}>{word}</span>
                            ))}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {selection && selectedData && !isSelectingWords ? (
        <div
          className={`marker-composer ${activeAudioProvider ? "with-audio" : ""}`}
          data-marker-popover="true"
          style={popoverStyle}
          role="dialog"
          aria-label={selectedData.type === "range" ? t("selectedRange") : t("selectedWord")}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-stone-500">{selectedData.type === "range" ? t("selectedRange") : t("selectedWord")}</p>
              <strong className="block truncate text-sm leading-6 text-stone-950" title={selectedData.label}>
                {selectedData.type === "range" ? t("selectedRangeCount", { count: selectedData.wordTargets.length }) : selectedData.label}
              </strong>
              {selectedData.type === "range" ? <span className="block truncate text-xs leading-5 text-stone-500">{selectedData.label}</span> : null}
            </div>
            <button
              className={`${iconButtonClass} size-8 border-transparent`}
              type="button"
              onClick={() => {
                closeNoteEditor();
                setSelection(null);
              }}
              title={common("close")}
            >
              <X size={15} />
            </button>
          </div>

          {currentNoteText() ? (
            <div className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-stone-800">
              <StickyNote className="mt-0.5 flex-none text-amber-700" size={13} />
              <p className="min-w-0 whitespace-pre-wrap break-words">{currentNoteText()}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-1">
            {visibleMarkers.map((marker) => {
              const Icon = markerIcons[marker.icon];
              const active = selectedData.annotations.some((annotation) => annotation.markerId === marker.id);

              return (
                <button
                  className={`inline-flex min-h-6 max-w-full items-center gap-1 rounded-full border px-2 text-[0.6875rem] font-medium leading-none transition ${active ? "ring-1 ring-offset-1" : ""}`}
                  type="button"
                  key={marker.id}
                  style={makeMarkerStyle(marker)}
                  onClick={() => void toggleMarker(marker.id)}
                  aria-pressed={active}
                  title={active ? t("markerActiveTitle", { meaning: marker.meaning }) : t("markerInactiveTitle", { meaning: marker.meaning })}
                >
                  <Icon size={10} strokeWidth={2.2} />
                  <span className="truncate">{marker.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
            {selectedData.type !== "range" ? (
              <>
                {recordingTarget === currentTargetKey ? (
                  <button className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800" type="button" onClick={stopRecording}>
                    <Square size={15} fill="currentColor" />
                    {common("stop")}
                  </button>
                ) : (
                  <button className={secondaryButtonClass} type="button" onClick={() => void startRecording()}>
                    <Mic size={15} />
                    {common("recordAudio")}
                  </button>
                )}

                {selectedData.audioReference ? (
                  <>
                    <button className={secondaryButtonClass} type="button" onClick={() => void playAudioReference(selectedData.audioReference!)}>
                      <Play size={15} fill="currentColor" />
                      {common("play")}
                    </button>
                    <button className={`${iconButtonClass} text-red-700`} type="button" onClick={() => void removeAudioReferenceFromSelection()} title={common("delete")}>
                      <Trash2 size={15} />
                    </button>
                  </>
                ) : null}
              </>
            ) : null}

            <button className={secondaryButtonClass} type="button" onClick={() => void syncSelectionToPlayer()} disabled={!activeSong?.youtubeVideoId}>
              <Music2 size={15} />
              {t("syncToPlayer", { time: formatDuration(playerTimeMs) })}
            </button>
            <button className={secondaryButtonClass} type="button" onClick={seekToSelectedTimestamp} disabled={!activeSong?.youtubeVideoId}>
              <Play size={15} fill="currentColor" />
              {t("seekToSync")}
            </button>

            <button className={secondaryButtonClass} type="button" onClick={openNoteEditor}>
              <StickyNote size={15} />
              {hasSelectedTextNote() ? t("editNote") : t("addNote")}
            </button>
          </div>

          {isNoteEditorOpen ? (
            <form className="mt-3 grid gap-2 border-t border-stone-200 pt-3" onSubmit={(event) => void saveTextNote(event)}>
              <textarea
                className="min-h-24 w-full resize-y rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm leading-5 text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                placeholder={t("notePlaceholder")}
                maxLength={800}
                autoFocus
              />
              <div className="flex flex-wrap justify-end gap-2">
                {hasSelectedTextNote() ? (
                  <button className={`${secondaryButtonClass} min-h-9 px-3 py-1.5 text-xs text-red-700 hover:border-red-200 hover:bg-red-50`} type="button" onClick={() => void deleteTextNoteFromSelection()}>
                    <Trash2 size={13} />
                    {common("delete")}
                  </button>
                ) : null}
                <button className={`${secondaryButtonClass} min-h-9 px-3 py-1.5 text-xs`} type="button" onClick={() => setIsNoteEditorOpen(false)}>
                  {common("cancel")}
                </button>
                <button className={`${primaryButtonClass} min-h-9 px-3 py-1.5 text-xs`} type="submit">
                  {common("save")}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {isProfileGateReady && isProfileModalOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-emerald-950/35 px-4 backdrop-blur-sm">
          <form
            className="relative grid w-full max-w-md gap-5 rounded-[1.5rem] border border-white/80 bg-white p-6 text-center shadow-[0_28px_90px_rgba(0,80,68,0.28)]"
            onSubmit={(event) => void saveProfile(event)}
          >
            {profile.onboardingCompleted ? (
              <button className={`${iconButtonClass} absolute right-4 top-4 size-9`} type="button" onClick={() => setIsProfileModalOpen(false)} title={common("close")}>
                <X size={15} />
              </button>
            ) : null}

            <div className="mx-auto grid size-12 place-items-center rounded-xl bg-emerald-600 text-white shadow-[0_12px_26px_rgba(5,150,105,0.24)]">
              <UserRound size={22} />
            </div>
            <div>
              <h2 className="text-2xl font-bold leading-tight text-stone-950">{t("profileTitle")}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-500">{t("profileSubtitle")}</p>
            </div>

            <div className="grid gap-3 text-left">
              <label className="grid gap-2 text-sm font-semibold text-stone-700">
                {t("profileNickname")}
                <input
                  className={inputClass}
                  value={profileDraft.displayName}
                  onChange={(event) => setProfileDraft((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder={t("profileNicknamePlaceholder")}
                  maxLength={40}
                  autoFocus
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-stone-700">
                {t("profileGoal")}
                <textarea
                  className="min-h-24 w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm leading-6 text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  value={profileDraft.vocalGoal}
                  onChange={(event) => setProfileDraft((current) => ({ ...current, vocalGoal: event.target.value }))}
                  placeholder={t("profileGoalPlaceholder")}
                  maxLength={160}
                />
              </label>
            </div>

            {profileError ? <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{profileError}</p> : null}

            <button className={`${primaryButtonClass} w-full`} type="submit" disabled={isSavingProfile}>
              {isSavingProfile ? <Loader2 className="spin size-4" /> : null}
              {isSavingProfile ? t("profileSaving") : t("profileSave")}
            </button>
          </form>
        </div>
      ) : null}

      {statusMessage ? (
        <button
          className={`status-toast ${activeAudioProvider ? "with-audio" : ""}`}
          type="button"
          onClick={() => setStatusMessage("")}
          role="status"
          aria-live="polite"
        >
          {statusMessage}
        </button>
      ) : null}
    </div>
  );
}
