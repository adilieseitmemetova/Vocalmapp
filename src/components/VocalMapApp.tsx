"use client";

import {
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

import {
  buildLyrics,
  findLyricsForTrack,
  lyricsTextFromMatch,
  lyricsToText,
  searchLyricsCatalog,
  syncedLyricsToPlainText
} from "@/lyrics";
import type { TablesInsert } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/client";
import { MARKER_ICON_OPTIONS, markerIcons } from "@/markers";
import type {
  AudioReference,
  InitialVocalMapData,
  LineAnnotation,
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
  SpotifyTrackResult,
  TextNote,
  UserProfile,
  WordAnnotation
} from "@/types";

const AUDIO_BUCKET = "vocalmap-audio";
const PROFILE_STORAGE_KEY = "vocalmapp:profile:v1";
const MARKER_PREFERENCES_STORAGE_PREFIX = "vocalmapp:marker-preferences";
const TEXT_NOTES_STORAGE_PREFIX = "vocalmapp:text-notes";
const LYRIC_TEXT_SIZE_STORAGE_PREFIX = "vocalmapp:lyric-text-size";
const LYRIC_LINE_SPACING_STORAGE_PREFIX = "vocalmapp:lyric-line-spacing";
const LYRIC_WORD_SPACING_STORAGE_PREFIX = "vocalmapp:lyric-word-spacing";
const DEFAULT_LYRIC_TEXT_SIZE = 24;
const MIN_LYRIC_TEXT_SIZE = 16;
const MAX_LYRIC_TEXT_SIZE = 36;
const DEFAULT_LYRIC_LINE_SPACING = 8;
const MIN_LYRIC_LINE_SPACING = 0;
const MAX_LYRIC_LINE_SPACING = 24;
const DEFAULT_LYRIC_WORD_SPACING = 8;
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

type MarkerDraft = typeof EMPTY_CUSTOM_MARKER;
type MarkerPreferences = {
  hiddenSystemMarkerIds: string[];
  systemOverrides: Record<string, MarkerDraft>;
};
type SettingsPanel = "markers" | "lyrics";
type AudioProvider = "spotify" | "file";
type StoredTextNote = {
  id: string;
  songId: string;
  lineId: string;
  wordId: string | null;
  targetType: "line" | "word";
  text: string;
  createdAt: string;
  updatedAt: string;
};
type SpotifySearchErrorCode = "authRequired" | "queryRequired" | "queryTooLong" | "searchFailed" | "missingCredentials" | "unavailable";

const spotifySearchErrorMessageKeys: Record<SpotifySearchErrorCode, string> = {
  authRequired: "spotifyAuthRequired",
  queryRequired: "queryRequired",
  queryTooLong: "spotifyQueryTooLong",
  searchFailed: "spotifySearchFailed",
  missingCredentials: "spotifyMissingCredentials",
  unavailable: "spotifyUnavailable"
};
const systemMarkerIds = new Set([
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

function textNotesStorageKey(userId: string) {
  return `${TEXT_NOTES_STORAGE_PREFIX}:${userId}`;
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

function clampLyricTextSize(size: number) {
  return Math.min(MAX_LYRIC_TEXT_SIZE, Math.max(MIN_LYRIC_TEXT_SIZE, Math.round(size)));
}

function clampLyricLineSpacing(spacing: number) {
  return Math.min(MAX_LYRIC_LINE_SPACING, Math.max(MIN_LYRIC_LINE_SPACING, Math.round(spacing)));
}

function clampLyricWordSpacing(spacing: number) {
  return Math.min(MAX_LYRIC_WORD_SPACING, Math.max(MIN_LYRIC_WORD_SPACING, Math.round(spacing)));
}

function textNoteTargetKey(note: Pick<StoredTextNote, "songId" | "lineId" | "wordId" | "targetType">) {
  return `${note.targetType}:${note.songId}:${note.lineId}:${note.wordId ?? ""}`;
}

function readStoredTextNotes(userId: string) {
  try {
    const rawNotes = localStorage.getItem(textNotesStorageKey(userId));
    if (!rawNotes) {
      return [];
    }

    const parsedNotes = JSON.parse(rawNotes) as Partial<StoredTextNote>[];
    return parsedNotes.filter((note): note is StoredTextNote => Boolean(note.id && note.songId && note.lineId && note.targetType && note.text));
  } catch {
    localStorage.removeItem(textNotesStorageKey(userId));
    return [];
  }
}

function writeStoredTextNotes(userId: string, notes: StoredTextNote[]) {
  localStorage.setItem(textNotesStorageKey(userId), JSON.stringify(notes));
}

function saveStoredTextNotes(userId: string, notes: StoredTextNote[]) {
  const incomingKeys = new Set(notes.map(textNoteTargetKey));
  const nextNotes = readStoredTextNotes(userId).filter((note) => !incomingKeys.has(textNoteTargetKey(note)));
  writeStoredTextNotes(userId, [...nextNotes, ...notes]);
}

function removeStoredTextNotes(userId: string, noteIds: string[]) {
  if (noteIds.length === 0) {
    return;
  }

  const noteIdSet = new Set(noteIds);
  writeStoredTextNotes(
    userId,
    readStoredTextNotes(userId).filter((note) => !noteIdSet.has(note.id))
  );
}

function mergeStoredTextNotesIntoSongs(songs: Song[], storedNotes: StoredTextNote[]) {
  const notesByLine = new Map<string, TextNote>();
  const notesByWord = new Map<string, TextNote>();

  for (const note of storedNotes) {
    const textNote: TextNote = {
      id: note.id,
      text: note.text,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt
    };

    if (note.targetType === "line") {
      notesByLine.set(note.lineId, textNote);
    } else if (note.wordId) {
      notesByWord.set(note.wordId, textNote);
    }
  }

  return songs.map((song) => ({
    ...song,
    lyrics: song.lyrics.map((line) => ({
      ...line,
      textNote: notesByLine.get(line.id) ?? line.textNote,
      words: line.words.map((word) => ({
        ...word,
        textNote: notesByWord.get(word.id) ?? word.textNote
      }))
    }))
  }));
}

function isMissingTargetNotesError(error: { message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("target_notes") || message.includes("schema cache");
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

function makeAudioReference(path: string, blob: Blob, id = createId()): AudioReference {
  const now = new Date().toISOString();

  return {
    id,
    storagePath: path,
    mimeType: blob.type || "audio/webm",
    sizeBytes: blob.size,
    createdAt: now,
    updatedAt: now
  };
}

function countMarkedTargets(song: Song) {
  return song.lyrics.reduce((total, line) => {
    const lineCount = line.annotations.length > 0 || line.audioReference || line.textNote ? 1 : 0;
    const wordCount = line.words.filter((word) => word.annotations.length > 0 || word.audioReference || word.textNote).length;
    return total + lineCount + wordCount;
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
    if (line.audioReference?.storagePath) {
      paths.add(line.audioReference.storagePath);
    }

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

function getSpotifyTrackEmbedId(song: Song) {
  if (song.spotifyTrackId) {
    return song.spotifyTrackId;
  }

  if (!song.spotifyUrl) {
    return "";
  }

  try {
    const url = new URL(song.spotifyUrl);
    const [, type, id] = url.pathname.split("/");
    return type === "track" ? id : "";
  } catch {
    return "";
  }
}

function markerPreferencesKey(userId: string) {
  return `${MARKER_PREFERENCES_STORAGE_PREFIX}:${userId}`;
}

function songToDraft(song: Song): SongDraft {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist ?? "",
    lyricsText: lyricsToText(song.lyrics),
    albumName: song.albumName,
    albumArtUrl: song.albumArtUrl,
    spotifyTrackId: song.spotifyTrackId,
    spotifyUrl: song.spotifyUrl,
    durationMs: song.durationMs
  };
}

function buildSongFromDraft(draft: SongDraft, fallbackTitle: string, existingSong?: Song): Song {
  const now = new Date().toISOString();
  const lyrics = buildLyrics(draft.lyricsText, existingSong?.lyrics);

  return {
    id: existingSong?.id ?? createId(),
    title: draft.title.trim() || fallbackTitle,
    artist: draft.artist.trim() || undefined,
    albumName: draft.albumName,
    albumArtUrl: draft.albumArtUrl,
    spotifyTrackId: draft.spotifyTrackId,
    spotifyUrl: draft.spotifyUrl,
    durationMs: draft.durationMs,
    sourceLyricsText: draft.lyricsText,
    lyrics,
    songAudios: existingSong?.songAudios ?? [],
    createdAt: existingSong?.createdAt ?? now,
    updatedAt: now
  };
}

type SelectedWordAddress = {
  line: LyricLine;
  word: LyricWord;
  lineIndex: number;
  wordIndex: number;
};

type SelectedData =
  | {
      type: "line";
      label: string;
      annotations: LineAnnotation[];
      audioReference?: AudioReference;
      textNote?: TextNote;
    }
  | {
      type: "word";
      label: string;
      annotations: WordAnnotation[];
      audioReference?: AudioReference;
      textNote?: TextNote;
    }
  | {
      type: "range";
      label: string;
      annotations: WordAnnotation[];
      wordTargets: Array<{
        lineId: string;
        wordId: string;
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
  if (!selection || selection.type === "line") {
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

  if (selection.type === "range") {
    return selection.anchor;
  }

  const line = song.lyrics.find((item) => item.id === selection.lineId);
  const firstWord = line?.words[0];
  return firstWord ? { lineId: line.id, wordId: firstWord.id } : null;
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

function findSelectedData(song: Song | undefined, selection: LyricsSelection | null, emptyLineLabel: string): SelectedData | null {
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
        annotations: address.word.annotations,
        textNote: address.word.textNote
      }))
    };
  }

  const line = song.lyrics.find((item) => item.id === selection.lineId);
  if (!line) {
    return null;
  }

  if (selection.type === "line") {
    return {
      type: "line" as const,
      label: line.text.trim() || emptyLineLabel,
      annotations: line.annotations,
      audioReference: line.audioReference,
      textNote: line.textNote
    };
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

function MarkerBadge({ markerId, markerById }: { markerId: string; markerById: Map<string, Marker> }) {
  const marker = markerById.get(markerId);
  if (!marker) {
    return null;
  }

  const Icon = markerIcons[marker.icon];

  return (
    <span
      className="inline-flex h-[18px] max-w-24 items-center gap-1 overflow-hidden rounded-full border px-1.5 text-[10px] font-bold leading-none"
      style={makeMarkerStyle(marker)}
      title={marker.meaning}
    >
      <Icon size={11} strokeWidth={2.4} />
      <span className="truncate">{marker.label}</span>
    </span>
  );
}

function AudioDot({ onPlay, title }: { onPlay: () => void; title: string }) {
  return (
    <button
      className="inline-grid size-[18px] place-items-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 transition hover:bg-emerald-100"
      type="button"
      title={title}
      onClick={onPlay}
    >
      <Play size={10} fill="currentColor" />
    </button>
  );
}

function NoteDot({ note, title }: { note: TextNote; title: string }) {
  return (
    <button
      className="inline-grid size-[18px] place-items-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-100"
      type="button"
      title={`${title}: ${note.text}`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <StickyNote size={10} />
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
  onLineSelect,
  onWordPointerDown,
  onWordPointerMove,
  onWordPointerUp,
  onWordPointerCancel,
  onWordKeyboardSelect,
  onPlayAudio,
  markerById,
  selectedLineId,
  selectedWordIds,
  lyricTextStyle,
  lyricLineStyle,
  lyricWordsStyle,
  labels
}: {
  line: LyricLine;
  songId: string;
  onLineSelect: (lineId: string, element: HTMLElement) => void;
  onWordPointerDown: (event: React.PointerEvent<HTMLElement>, lineId: string, wordId: string) => void;
  onWordPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onWordPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onWordPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onWordKeyboardSelect: (lineId: string, wordId: string, element: HTMLElement) => void;
  onPlayAudio: (audioReference: AudioReference) => void;
  markerById: Map<string, Marker>;
  selectedLineId: string | null;
  selectedWordIds: Set<string>;
  lyricTextStyle: CSSProperties;
  lyricLineStyle: CSSProperties;
  lyricWordsStyle: CSSProperties;
  labels: {
    emptyLine: string;
    lineAudio: string;
    wordAudio: string;
    note: string;
  };
}) {
  const lineIsSelected = selectedLineId === line.id;
  const lineHasRangeSelection = selectedWordIds.size > 1 && line.words.some((word) => selectedWordIds.has(word.id));

  return (
    <div
      data-lyric-selection-surface="true"
      className={`grid cursor-pointer grid-cols-1 gap-1 rounded-xl border px-3 transition lg:grid-cols-[9.5rem_minmax(0,1fr)] lg:gap-4 ${
        lineIsSelected || lineHasRangeSelection ? "border-emerald-200 bg-emerald-50" : "border-transparent hover:border-emerald-100 hover:bg-emerald-50/60"
      }`}
      style={lyricLineStyle}
      onClick={(event) => onLineSelect(line.id, event.currentTarget)}
    >
      <div className="flex flex-wrap items-start gap-1 pt-0.5 lg:justify-end">
        {line.annotations.map((annotation) => (
          <MarkerBadge key={annotation.id} markerId={annotation.markerId} markerById={markerById} />
        ))}
        {line.audioReference ? <AudioDot onPlay={() => onPlayAudio(line.audioReference!)} title={labels.lineAudio} /> : null}
        {line.textNote ? <NoteDot note={line.textNote} title={labels.note} /> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-y-1 text-stone-950" style={{ ...lyricTextStyle, ...lyricWordsStyle }}>
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
                    <MarkerBadge key={annotation.id} markerId={annotation.markerId} markerById={markerById} />
                  ))}
                  {word.audioReference ? <AudioDot onPlay={() => onPlayAudio(word.audioReference!)} title={labels.wordAudio} /> : null}
                  {word.textNote ? <NoteDot note={word.textNote} title={labels.note} /> : null}
                </span>
                <span className="inline-flex items-center">
                  <button
                    className={`max-w-full touch-none select-none rounded px-1 py-0.5 leading-tight text-inherit transition focus:outline-none focus:ring-2 focus:ring-emerald-200 ${
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
                      className="h-[1.7em] w-3 touch-none select-none rounded transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-100"
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
  onUpload,
  onRemove,
  onEdit,
  onDelete,
  optionsOpen,
  onToggleOptions,
  labels
}: {
  song: Song;
  onUpload: (song: Song, file: File) => void;
  onRemove: (song: Song, audioReference: AudioReference) => void;
  onEdit: (song: Song) => void;
  onDelete: (song: Song) => void;
  optionsOpen: boolean;
  onToggleOptions: () => void;
  labels: {
    coverAlt: string;
    noArtist: string;
    lines: string;
    markers: string;
    spotify: string;
    addFile: string;
    edit: string;
    delete: string;
    deleteAudio: string;
  };
}) {
  return (
    <section className="relative grid gap-3 border-t border-stone-200 pt-3 pb-1">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-stone-200 bg-stone-100">
        {song.albumArtUrl ? (
          <Image className="size-full object-cover" src={song.albumArtUrl} alt={labels.coverAlt} width={640} height={640} priority loading="eager" />
        ) : (
          <div className="grid size-full place-items-center bg-stone-50 text-stone-500">
            <Music2 size={28} />
          </div>
        )}
      </div>

      <div className="relative min-w-0 pr-9" data-song-options-menu="true">
        <p className="truncate text-[0.6875rem] font-semibold uppercase text-stone-500">{song.artist ?? labels.noArtist}</p>
        <h2 className="mt-0.5 line-clamp-2 min-w-0 text-sm font-semibold leading-5 text-stone-950">{song.title}</h2>
        <p className="mt-1 truncate text-xs text-stone-500">
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
          aria-label="Song options"
          title="Song options"
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

      <div className="grid grid-cols-2 gap-2">
        {song.spotifyUrl ? (
          <a className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full bg-stone-950 px-3 text-xs font-semibold text-white transition hover:bg-stone-800" href={song.spotifyUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={13} />
            {labels.spotify}
          </a>
        ) : null}
        <label className="relative inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 overflow-hidden rounded-full bg-emerald-600 px-3 text-xs font-semibold text-white transition hover:bg-emerald-700">
          <Upload size={13} />
          <span>{labels.addFile}</span>
          <input className="absolute inset-0 cursor-pointer opacity-0" type="file" accept="audio/*" onChange={(event) => event.target.files?.[0] && onUpload(song, event.target.files[0])} />
        </label>
      </div>

      {song.songAudios.length > 0 ? (
        <div className="grid gap-2">
          {song.songAudios.map((audioReference, index) => (
            <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50 px-2 py-1.5" key={audioReference.id}>
              <span className="truncate text-xs font-medium text-stone-700">
                {labels.addFile} {index + 1}
              </span>
              <button className={`${iconButtonClass} size-8 rounded-full text-red-700`} type="button" onClick={() => onRemove(song, audioReference)} title={labels.deleteAudio}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AudioProviderDock({
  song,
  provider,
  selectedAudioId,
  sidebarCollapsed,
  onProviderChange,
  onSelectedAudioChange,
  supabase,
  labels
}: {
  song: Song;
  provider: AudioProvider;
  selectedAudioId: string | null;
  sidebarCollapsed: boolean;
  onProviderChange: (provider: AudioProvider) => void;
  onSelectedAudioChange: (audioId: string) => void;
  supabase: ReturnType<typeof createClient>;
  labels: {
    nowPlaying: string;
    spotify: string;
    file: string;
    fileSelect: string;
    noFile: string;
    spotifyTitle: string;
  };
}) {
  const trackId = getSpotifyTrackEmbedId(song);
  const hasSpotify = Boolean(trackId);
  const hasFiles = song.songAudios.length > 0;
  const activeAudio = song.songAudios.find((audioReference) => audioReference.id === selectedAudioId) ?? song.songAudios[0];
  const fileUrl = useAudioUrl(provider === "file" ? activeAudio : undefined, supabase);

  if (!hasSpotify && !hasFiles) {
    return null;
  }

  return (
    <div
      className={`fixed inset-x-3 bottom-3 z-30 rounded-2xl border border-stone-200 bg-white p-2 ${
        sidebarCollapsed ? "md:left-[calc(4.75rem+1.5rem)] md:right-5" : "md:left-[calc(22rem+1.5rem)] md:right-5"
      }`}
    >
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="flex min-w-0 items-center gap-3">
          {song.albumArtUrl ? <Image className="size-11 flex-none rounded-lg object-cover" src={song.albumArtUrl} alt={labels.nowPlaying} width={44} height={44} /> : <Music2 className="flex-none text-stone-500" size={22} />}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-stone-950">{song.title}</p>
            <p className="truncate text-xs text-stone-500">{song.artist ?? labels.nowPlaying}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasSpotify ? (
            <button
              className={`inline-flex h-9 items-center justify-center rounded-full border px-3 text-xs font-semibold transition ${
                provider === "spotify" ? "border-stone-950 bg-stone-950 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"
              }`}
              type="button"
              onClick={() => onProviderChange("spotify")}
            >
              {labels.spotify}
            </button>
          ) : null}
          {hasFiles ? (
            <button
              className={`inline-flex h-9 items-center justify-center rounded-full border px-3 text-xs font-semibold transition ${
                provider === "file" ? "border-emerald-600 bg-emerald-600 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"
              }`}
              type="button"
              onClick={() => onProviderChange("file")}
            >
              {labels.file}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2">
        {provider === "spotify" && trackId ? (
          <iframe
            className="block h-20 w-full rounded-xl"
            title={labels.spotifyTitle}
            src={`https://open.spotify.com/embed/track/${encodeURIComponent(trackId)}?utm_source=generator`}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
          />
        ) : null}
        {provider === "file" ? (
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            {fileUrl ? <audio className="h-10 w-full" controls src={fileUrl} /> : <p className="text-sm text-stone-500">{labels.noFile}</p>}
            {song.songAudios.length > 1 ? (
              <select
                className="h-10 rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-800 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                value={activeAudio?.id ?? ""}
                onChange={(event) => onSelectedAudioChange(event.target.value)}
                aria-label={labels.fileSelect}
              >
                {song.songAudios.map((audioReference, index) => (
                  <option key={audioReference.id} value={audioReference.id}>
                    {labels.file} {index + 1}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ) : null}
      </div>
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
      initialData.markers.map((marker) =>
        marker.isSystem && systemMarkerIds.has(marker.id)
          ? {
              ...marker,
              label: t(`systemMarkers.${marker.id}.label`),
              meaning: t(`systemMarkers.${marker.id}.meaning`)
            }
          : marker
      ),
    [initialData.markers, t]
  );
  const [songs, setSongs] = useState<Song[]>(initialData.songs);
  const [markers, setMarkers] = useState<Marker[]>(translatedInitialMarkers);
  const [customMarkerDraft, setCustomMarkerDraft] = useState(EMPTY_CUSTOM_MARKER);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
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
  const [spotifyQuery, setSpotifyQuery] = useState("");
  const [spotifyResults, setSpotifyResults] = useState<SpotifyTrackResult[]>([]);
  const [spotifyMessage, setSpotifyMessage] = useState("");
  const [isSearchingSpotify, setIsSearchingSpotify] = useState(false);
  const [importingTrackId, setImportingTrackId] = useState<string | null>(null);
  const [recordingTarget, setRecordingTarget] = useState("");
  const [isNoteEditorOpen, setIsNoteEditorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [lyricTextSize, setLyricTextSize] = useState(DEFAULT_LYRIC_TEXT_SIZE);
  const [lyricLineSpacing, setLyricLineSpacing] = useState(DEFAULT_LYRIC_LINE_SPACING);
  const [lyricWordSpacing, setLyricWordSpacing] = useState(DEFAULT_LYRIC_WORD_SPACING);
  const [preferredAudioProvider, setPreferredAudioProvider] = useState<AudioProvider>("file");
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
      if (window.matchMedia("(max-width: 767px)").matches) {
        setIsSidebarCollapsed(true);
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
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
        const nextHiddenIds = new Set(parsedPreferences.hiddenSystemMarkerIds ?? []);
        const nextOverrides = parsedPreferences.systemOverrides ?? {};

        setHiddenSystemMarkerIds(nextHiddenIds);
        setSystemMarkerOverrides(nextOverrides);
        setMarkers((currentMarkers) =>
          currentMarkers.map((marker) => {
            const override = nextOverrides[marker.id];
            return marker.isSystem && override ? { ...marker, ...override } : marker;
          })
        );
      } catch {
        localStorage.removeItem(markerPreferencesKey(userId));
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [userId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const storedNotes = readStoredTextNotes(userId);
      if (storedNotes.length > 0) {
        setSongs((currentSongs) => mergeStoredTextNotesIntoSongs(currentSongs, storedNotes));
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [userId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const storedSize = Number(localStorage.getItem(lyricTextSizeStorageKey(userId)));
      if (Number.isFinite(storedSize)) {
        setLyricTextSize(clampLyricTextSize(storedSize));
      }

      const storedSpacing = Number(localStorage.getItem(lyricLineSpacingStorageKey(userId)));
      if (Number.isFinite(storedSpacing)) {
        setLyricLineSpacing(clampLyricLineSpacing(storedSpacing));
      }

      const storedWordSpacing = Number(localStorage.getItem(lyricWordSpacingStorageKey(userId)));
      if (Number.isFinite(storedWordSpacing)) {
        setLyricWordSpacing(clampLyricWordSpacing(storedWordSpacing));
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

  const effectiveActiveSongId = activeSongId ?? songs[0]?.id ?? null;
  const activeSong = useMemo(() => songs.find((song) => song.id === effectiveActiveSongId), [effectiveActiveSongId, songs]);
  const activeSongHasSpotify = Boolean(activeSong && getSpotifyTrackEmbedId(activeSong));
  const activeSongHasFiles = Boolean(activeSong && activeSong.songAudios.length > 0);
  const activeAudioProvider: AudioProvider | null =
    preferredAudioProvider === "file" && activeSongHasFiles
      ? "file"
      : preferredAudioProvider === "spotify" && activeSongHasSpotify
        ? "spotify"
        : activeSongHasFiles
          ? "file"
          : activeSongHasSpotify
            ? "spotify"
            : null;
  const markerById = useMemo(() => new Map(markers.map((marker) => [marker.id, marker])), [markers]);
  const visibleMarkers = useMemo(() => markers.filter((marker) => !marker.isSystem || !hiddenSystemMarkerIds.has(marker.id)), [hiddenSystemMarkerIds, markers]);
  const selectedMarker = useMemo(() => visibleMarkers.find((marker) => marker.id === selectedMarkerId) ?? null, [selectedMarkerId, visibleMarkers]);
  const selectedData = useMemo(() => findSelectedData(activeSong, selection, common("emptyLine")), [activeSong, common, selection]);
  const selectedWordIds = useMemo(() => new Set(activeSong ? selectedWordAddresses(activeSong, selection).map((address) => address.word.id) : []), [activeSong, selection]);
  const selectedLineId = selection?.type === "line" ? selection.lineId : null;
  const currentTargetKey = selectedTargetKey(selection);
  const songDraftIsComplete = Boolean(draft.title.trim() && draft.artist.trim() && draft.lyricsText.trim());
  const songDraftHasImportedDetails = Boolean(draft.spotifyTrackId || draft.spotifyUrl || draft.albumName || draft.albumArtUrl);
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

  function closeNoteEditor() {
    setIsNoteEditorOpen(false);
    setNoteDraft("");
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
    setSpotifyQuery("");
    setSpotifyResults([]);
    setSpotifyMessage("");
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

  function persistMarkerPreferences(nextHiddenIds: Set<string>, nextOverrides: Record<string, MarkerDraft>) {
    const preferences: MarkerPreferences = {
      hiddenSystemMarkerIds: Array.from(nextHiddenIds),
      systemOverrides: nextOverrides
    };
    localStorage.setItem(markerPreferencesKey(userId), JSON.stringify(preferences));
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

  async function persistSong(song: Song, existingSong?: Song) {
    const songRow: TablesInsert<"songs"> = {
      id: song.id,
      user_id: userId,
      title: song.title,
      artist: song.artist ?? null,
      album_name: song.albumName ?? null,
      album_art_url: song.albumArtUrl ?? null,
      spotify_track_id: song.spotifyTrackId ?? null,
      spotify_url: song.spotifyUrl ?? null,
      duration_ms: song.durationMs ?? null,
      source_lyrics_text: song.sourceLyricsText
    };

    const keepLineIds = song.lyrics.map((line) => line.id);
    const keepWordIds = song.lyrics.flatMap((line) => line.words.map((word) => word.id));
    const lineRows: TablesInsert<"lyric_lines">[] = song.lyrics.map((line, position) => ({
      id: line.id,
      song_id: song.id,
      user_id: userId,
      position,
      text: line.text
    }));
    const wordRows: TablesInsert<"lyric_words">[] = song.lyrics.flatMap((line) =>
      line.words.map((word, position) => ({
        id: word.id,
        line_id: line.id,
        song_id: song.id,
        user_id: userId,
        position,
        text: word.text
      }))
    );

    const { error: songError } = await supabase.from("songs").upsert(songRow);
    if (songError) {
      throw songError;
    }

    if (existingSong) {
      if (keepWordIds.length > 0) {
        const { error } = await supabase.from("lyric_words").delete().eq("song_id", song.id).not("id", "in", `(${keepWordIds.join(",")})`);
        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase.from("lyric_words").delete().eq("song_id", song.id);
        if (error) {
          throw error;
        }
      }

      if (keepLineIds.length > 0) {
        const { error } = await supabase.from("lyric_lines").delete().eq("song_id", song.id).not("id", "in", `(${keepLineIds.join(",")})`);
        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase.from("lyric_lines").delete().eq("song_id", song.id);
        if (error) {
          throw error;
        }
      }
    }

    if (lineRows.length > 0) {
      const { error } = await supabase.from("lyric_lines").upsert(lineRows);
      if (error) {
        throw error;
      }
    }

    if (wordRows.length > 0) {
      const { error } = await supabase.from("lyric_words").upsert(wordRows);
      if (error) {
        throw error;
      }
    }
  }

  async function saveDraft() {
    const existingSong = editingSongId && editingSongId !== "new" ? songs.find((song) => song.id === editingSongId) : undefined;
    const song = buildSongFromDraft(draft, common("untitledSong"), existingSong);

    setIsSaving(true);
    try {
      await persistSong(song, existingSong);
      await deleteStoragePaths(collectRemovedAudioPaths(existingSong, song));
      let nextSong = song;
      let audioUploadFailed = false;

      if (pendingSongAudioFile) {
        try {
          const audioReference = await persistAudioReference({ songId: song.id, type: "song" }, pendingSongAudioFile);
          setSelectedSongAudioId(audioReference.id);
          setPreferredAudioProvider("file");
          nextSong = {
            ...song,
            songAudios: [...song.songAudios, audioReference],
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
      setActiveSongId(nextSong.id);
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

    const { error } = await supabase.from("songs").delete().eq("id", song.id).eq("user_id", userId);
    if (error) {
      setStatusMessage(t("deleteFailed"));
      return;
    }

    await deleteStoragePaths(collectAudioPaths(song));
    setSongs((currentSongs) => currentSongs.filter((item) => item.id !== song.id));
    setActiveSongId((currentId) => (currentId === song.id ? null : currentId));
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
      const { error } = await supabase
        .from("markers")
        .update({
          label: markerPayload.label,
          meaning: markerPayload.meaning,
          color: markerPayload.color,
          icon: markerPayload.icon
        })
        .eq("id", existingMarker.id)
        .eq("user_id", userId);

      if (error) {
        setStatusMessage(t("saveFailed"));
        return;
      }

      setMarkers((currentMarkers) => currentMarkers.map((marker) => (marker.id === existingMarker.id ? { ...marker, ...markerPayload } : marker)));
      setSelectedMarkerId(existingMarker.id);
      closeMarkerForm();
      setStatusMessage(t("markerUpdated"));
      return;
    }

    const marker: Marker = {
      id: `custom-${createId()}`,
      ...markerPayload,
      isSystem: false
    };

    const { error } = await supabase.from("markers").insert({
      id: marker.id,
      user_id: userId,
      label: marker.label,
      meaning: marker.meaning,
      color: marker.color,
      icon: marker.icon,
      is_system: false,
      sort_order: markers.length + 1
    });

    if (error) {
      setStatusMessage(t("saveFailed"));
      return;
    }

    setMarkers((currentMarkers) => [...currentMarkers, marker]);
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
      persistMarkerPreferences(nextHiddenIds, systemMarkerOverrides);

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
    setSelectedMarkerId(null);
    setSongs((currentSongs) =>
      currentSongs.map((song) => ({
        ...song,
        lyrics: song.lyrics.map((line) => ({
          ...line,
          annotations: line.annotations.filter((annotation) => annotation.markerId !== markerId),
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

  async function searchSpotify() {
    const query = spotifyQuery.trim();
    if (!query) {
      setSpotifyMessage(t("queryRequired"));
      return;
    }

    setIsSearchingSpotify(true);
    setSpotifyMessage("");
    setSpotifyResults([]);

    try {
      const response = await fetch(`/api/spotify/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 501) {
          const lyricResults = await searchLyricsCatalog(query);
          setSpotifyResults(
            lyricResults.map((match) => ({
              id: `lrclib-${match.id}`,
              title: match.trackName,
              artist: match.artistName,
              albumName: match.albumName ?? "LRCLIB",
              albumArtUrl: "",
              durationMs: Math.round((match.duration ?? 0) * 1000),
              spotifyUrl: "",
              source: "lrclib",
              lyricsText: lyricsTextFromMatch(match)
            }))
          );
          setSpotifyMessage(t("spotifyMissing"));
          return;
        }

        const errorCode = data.errorCode as SpotifySearchErrorCode | undefined;
        setSpotifyMessage(t(errorCode ? spotifySearchErrorMessageKeys[errorCode] ?? "spotifySearchFailed" : "spotifySearchFailed"));
        return;
      }

      setSpotifyResults((data.tracks ?? []).map((track: SpotifyTrackResult) => ({ ...track, source: "spotify" })));
      if ((data.tracks ?? []).length === 0) {
        setSpotifyMessage(t("spotifyNoResults"));
      }
    } catch {
      try {
        const lyricResults = await searchLyricsCatalog(query);
        setSpotifyResults(
          lyricResults.map((match) => ({
            id: `lrclib-${match.id}`,
            title: match.trackName,
            artist: match.artistName,
            albumName: match.albumName ?? "LRCLIB",
            albumArtUrl: "",
            durationMs: Math.round((match.duration ?? 0) * 1000),
            spotifyUrl: "",
            source: "lrclib",
            lyricsText: lyricsTextFromMatch(match)
          }))
        );
        setSpotifyMessage(t("spotifyUnavailable"));
      } catch {
        setSpotifyMessage(t("spotifySearchUnavailable"));
      }
    } finally {
      setIsSearchingSpotify(false);
    }
  }

  async function importSpotifyTrack(track: SpotifyTrackResult) {
    setImportingTrackId(track.id);
    setSpotifyMessage(track.source === "lrclib" ? t("openLyricsFromLrclib") : t("findLyrics"));

    let lyricsText = track.lyricsText ?? "";
    try {
      if (!lyricsText) {
        const match = await findLyricsForTrack({
          title: track.title,
          artist: track.artist,
          albumName: track.albumName,
          durationMs: track.durationMs
        });

        if (match?.plainLyrics) {
          lyricsText = match.plainLyrics;
          setSpotifyMessage(t("lyricsFound"));
        } else if (match?.syncedLyrics) {
          lyricsText = syncedLyricsToPlainText(match.syncedLyrics);
          setSpotifyMessage(t("syncedLyricsFound"));
        } else {
          setSpotifyMessage(t("lyricsNotFound"));
        }
      } else {
        setSpotifyMessage(t("lyricsFound"));
      }
    } catch {
      setSpotifyMessage(t("lyricsFetchFailed"));
    }

    setDraft({
      title: track.title,
      artist: track.artist,
      lyricsText,
      albumName: track.albumName,
      albumArtUrl: track.albumArtUrl,
      spotifyTrackId: track.source === "spotify" ? track.id : undefined,
      spotifyUrl: track.spotifyUrl,
      durationMs: track.durationMs
    });
    setEditingSongId("new");
    setPreferredAudioProvider(track.source === "spotify" ? "spotify" : "file");
    setActiveSongId(null);
    closeNoteEditor();
    setSelection(null);
    setImportingTrackId(null);
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

  function selectLineFromSide(lineId: string, element: HTMLElement) {
    if (!activeSong) {
      return;
    }

    const rect = element.getBoundingClientRect();
    closeNoteEditor();
    setSelection({
      songId: activeSong.id,
      type: "line",
      lineId,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
  }

  function updateSelectedTarget(
    target: SelectedTarget,
    updater: (payload: {
      annotations: Array<LineAnnotation | WordAnnotation>;
      audioReference?: AudioReference;
      textNote?: TextNote;
    }) => {
      annotations?: Array<LineAnnotation | WordAnnotation>;
      audioReference?: AudioReference;
      removeAudio?: boolean;
      textNote?: TextNote;
      removeTextNote?: boolean;
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

          if (target.type === "line") {
            const result = updater({
              annotations: line.annotations,
              audioReference: line.audioReference,
              textNote: line.textNote
            });

            return {
              ...line,
              annotations: (result.annotations as LineAnnotation[] | undefined) ?? line.annotations,
              audioReference: result.removeAudio ? undefined : result.audioReference ?? line.audioReference,
              textNote: result.removeTextNote ? undefined : result.textNote ?? line.textNote
            };
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
                textNote: word.textNote
              });

              return {
                ...word,
                annotations: (result.annotations as WordAnnotation[] | undefined) ?? word.annotations,
                audioReference: result.removeAudio ? undefined : result.audioReference ?? word.audioReference,
                textNote: result.removeTextNote ? undefined : result.textNote ?? word.textNote
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
      annotations: WordAnnotation[];
      textNote?: TextNote;
    }) => {
      annotations?: WordAnnotation[];
      textNote?: TextNote;
      removeTextNote?: boolean;
    }
  ) {
    const now = new Date().toISOString();

    setSongs((currentSongs) =>
      currentSongs.map((song) => {
        if (song.id !== target.songId) {
          return song;
        }

        const selectedWordIdsForSong = new Set(selectedWordAddresses(song, target).map((address) => address.word.id));
        if (selectedWordIdsForSong.size === 0) {
          return song;
        }

        return {
          ...song,
          lyrics: song.lyrics.map((line) => ({
            ...line,
            words: line.words.map((word) => {
              if (!selectedWordIdsForSong.has(word.id)) {
                return word;
              }

              const result = updater({
                lineId: line.id,
                wordId: word.id,
                annotations: word.annotations,
                textNote: word.textNote
              });

              return {
                ...word,
                annotations: result.annotations ?? word.annotations,
                textNote: result.removeTextNote ? undefined : result.textNote ?? word.textNote
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
        if (error && !isMissingTargetNotesError(error)) {
          setStatusMessage(t("noteSaveFailed"));
          return;
        }
        removeStoredTextNotes(userId, noteIds);
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
    if (error && !isMissingTargetNotesError(error)) {
      setStatusMessage(t("noteSaveFailed"));
      return;
    }
    removeStoredTextNotes(userId, [selectedData.textNote.id]);

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
          song_id: selection.songId,
          line_id: target.lineId,
          word_id: target.wordId,
          target_type: "word",
          text
        };
      });

      const { error } = await supabase.from("target_notes").upsert(rows, {
        onConflict: "user_id,target_type,song_id,line_id,word_id"
      });
      if (error) {
        if (!isMissingTargetNotesError(error)) {
          setStatusMessage(t("noteSaveFailed"));
          return;
        }

        saveStoredTextNotes(
          userId,
          selectedData.wordTargets.flatMap((target) => {
            const note = noteByWordId.get(target.wordId);
            return note
              ? [
                  {
                    id: note.id,
                    songId: selection.songId,
                    lineId: target.lineId,
                    wordId: target.wordId,
                    targetType: "word" as const,
                    text: note.text,
                    createdAt: note.createdAt,
                    updatedAt: note.updatedAt
                  }
                ]
              : [];
          })
        );
      } else {
        removeStoredTextNotes(
          userId,
          Array.from(noteByWordId.values()).map((note) => note.id)
        );
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

    const textNote: TextNote = {
      id: selectedData.textNote?.id ?? createId(),
      text,
      createdAt: selectedData.textNote?.createdAt ?? now,
      updatedAt: now
    };
    const row: TablesInsert<"target_notes"> = {
      id: textNote.id,
      user_id: userId,
      song_id: selection.songId,
      line_id: selection.lineId,
      word_id: selection.type === "word" ? selection.wordId : null,
      target_type: selection.type,
      text
    };

    const { error } = await supabase.from("target_notes").upsert(row, {
      onConflict: "user_id,target_type,song_id,line_id,word_id"
    });
    if (error) {
      if (!isMissingTargetNotesError(error)) {
        setStatusMessage(t("noteSaveFailed"));
        return;
      }

      saveStoredTextNotes(userId, [
        {
          id: textNote.id,
          songId: selection.songId,
          lineId: selection.lineId,
          wordId: selection.type === "word" ? selection.wordId : null,
          targetType: selection.type,
          text: textNote.text,
          createdAt: textNote.createdAt,
          updatedAt: textNote.updatedAt
        }
      ]);
    } else {
      removeStoredTextNotes(userId, [textNote.id]);
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
          song_id: selection.songId,
          line_id: target.lineId,
          word_id: target.wordId,
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
    const annotationRow: TablesInsert<"annotations"> = {
      id: annotationId,
      user_id: userId,
      song_id: selection.songId,
      line_id: selection.lineId,
      word_id: selection.type === "word" ? selection.wordId ?? null : null,
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

  async function persistAudioReference(target: SelectedTarget | { songId: string; type: "song" }, blob: Blob) {
    const audioId = createId();
    const mimeType = blob.type || "audio/webm";
    const targetId = target.type === "song" ? target.songId : target.type === "line" ? target.lineId : target.wordId;
    const storagePath = `${userId}/${target.songId}/${target.type}-${targetId}/${audioId}.${extensionFromMime(mimeType)}`;
    const { error: uploadError } = await supabase.storage.from(AUDIO_BUCKET).upload(storagePath, blob, {
      contentType: mimeType,
      upsert: false
    });

    if (uploadError) {
      throw uploadError;
    }

    const audioReference = makeAudioReference(storagePath, blob, audioId);
    const existingSelectedData = target.type === "song" ? null : findSelectedData(songs.find((song) => song.id === target.songId), target, common("emptyLine"));
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
      song_id: target.songId,
      line_id: target.type === "line" || target.type === "word" ? target.lineId : null,
      word_id: target.type === "word" ? target.wordId ?? null : null,
      target_type: target.type,
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
          const audioReference = await persistAudioReference(recordedTarget, blob);
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

  async function uploadSongAudio(song: Song, file: File) {
    try {
      const audioReference = await persistAudioReference({ songId: song.id, type: "song" }, file);
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
        left: `min(${selection.x + 12}px, calc(100vw - 388px))`,
        top: `min(${selection.y + 12}px, calc(100vh - 390px))`
      } as CSSProperties)
    : undefined;
  const profileDisplayName = profile.displayName?.trim() || userEmail || t("profileFallbackName");
  const profileMeta = profile.vocalGoal?.trim() || t("profileFallbackMeta");

  return (
    <div
      className={`relative grid h-dvh grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden bg-[#87f0dc] bg-cover bg-center p-3 md:grid-rows-1 ${
        isSidebarCollapsed ? "md:grid-cols-[4.75rem_minmax(0,1fr)]" : "md:grid-cols-[22rem_minmax(0,1fr)]"
      }`}
      style={{ backgroundImage: "url('/images/auth-green-bg.png')" }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,255,246,0.18),rgba(35,181,156,0.12)_46%,rgba(12,130,111,0.24)_100%)]" />
      <aside
        className={`relative z-10 flex min-h-0 overflow-hidden rounded-[1.5rem] border border-stone-200 bg-white shadow-[0_28px_80px_rgba(0,104,83,0.20)] ${
          isSidebarCollapsed
            ? "max-h-none flex-row items-center justify-between gap-2 p-2 md:h-full md:flex-col md:items-center md:justify-start"
            : "max-h-[42dvh] flex-col gap-3 p-3 md:h-full md:max-h-none"
        }`}
      >
        {isSidebarCollapsed ? (
          <div className="flex w-full items-center justify-between gap-2 md:w-10 md:flex-col md:justify-start md:gap-2">
            <button
              className="grid h-10 w-12 flex-none place-items-center rounded-xl px-1 transition hover:bg-emerald-50"
              type="button"
              onClick={() => setIsSidebarCollapsed(false)}
              aria-label="Open menu"
              title="Open menu"
            >
              <Image className="h-auto w-full" src="/images/vocalmap-logo-green.svg" alt={common("appName")} width={351} height={102} priority />
            </button>
            <div className="flex items-center gap-2 md:w-10 md:flex-col md:items-center md:gap-2">
              <button
                className="inline-grid size-9 flex-none place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:border-stone-300 hover:bg-stone-50"
                type="button"
                onClick={() => setIsSidebarCollapsed(false)}
                aria-label="Open menu"
                title="Open menu"
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
                }}
                aria-expanded={isSettingsOpen}
                aria-label="Settings"
                title="Settings"
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
            <Image className="h-auto w-32 flex-none" src="/images/vocalmap-logo-green.svg" alt={common("appName")} width={351} height={102} priority />
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
            }}
            aria-expanded={isSettingsOpen}
            aria-label="Settings"
            title="Settings"
          >
            <Settings2 size={17} />
          </button>
            <button
              className="inline-grid size-9 flex-none place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:border-stone-300 hover:bg-stone-50"
              type="button"
              onClick={() => setIsSidebarCollapsed(true)}
              aria-label="Collapse menu"
              title="Collapse menu"
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
        </div>

        {activeSong ? (
          <SongMenuCard
            song={activeSong}
            onUpload={(song, file) => void uploadSongAudio(song, file)}
            onRemove={(song, audioReference) => void removeSongAudio(song, audioReference)}
            onEdit={(song) => {
              setOpenSongOptionsId(null);
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
              spotify: common("spotify"),
              addFile: t("addAudioFile"),
              edit: common("edit"),
              delete: common("delete"),
              deleteAudio: t("deleteSongAudio")
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
                    setActiveSongId(song.id);
                    setEditingSongId(null);
                    closeNoteEditor();
                    setOpenSongOptionsId(null);
                    setSelection(null);
                  }}
                >
                  {song.albumArtUrl ? (
                    <Image className="rounded object-cover" src={song.albumArtUrl} alt={t("coverAlt", { title: song.title })} width={28} height={28} />
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
                  aria-label="Song options"
                  title="Song options"
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

        <button className={`${primaryButtonClass} w-full flex-none`} type="button" onClick={openManualDraft}>
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
            aria-label="Profile menu"
            title="Profile menu"
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

      <section className={`relative z-10 min-h-0 min-w-0 overflow-auto px-2 py-4 sm:px-4 lg:px-5 ${activeAudioProvider && !editingSongId ? "pb-40" : ""}`}>
        {editingSongId ? (
          <div className="mx-auto max-w-6xl rounded-[1.5rem] border border-white/70 bg-white/[0.94] p-5 shadow-[0_28px_80px_rgba(0,104,83,0.18)] backdrop-blur-md">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-stone-500">{editingSongId === "new" ? t("editorNew") : t("editorEdit")}</p>
                <h1 className="mt-1 text-3xl font-bold leading-tight text-stone-950 sm:text-4xl">{draft.title || common("untitledSong")}</h1>
              </div>
            </div>

            {editingSongId === "new" ? (
              <section className="mb-4 grid gap-3 rounded-2xl border border-stone-200 bg-white p-3 sm:p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-xs font-bold uppercase text-stone-500">
                      <span className="grid size-5 place-items-center rounded-full bg-emerald-600 text-[11px] leading-none text-white">1</span>
                      {t("songFlowSearchTitle")}
                    </p>
                    <p className="mt-1 text-sm leading-5 text-stone-600">{t("songFlowSearchBody")}</p>
                  </div>
                  {spotifyResults.length > 0 ? <p className="text-xs font-bold text-emerald-700">{t("searchResultsCount", { count: spotifyResults.length })}</p> : null}
                </div>
                <form
                  className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void searchSpotify();
                  }}
                >
                  <input className={inputClass} value={spotifyQuery} onChange={(event) => setSpotifyQuery(event.target.value)} placeholder={t("musicSearchPlaceholder")} />
                  <button className={`${secondaryButtonClass} min-h-11 px-4`} type="submit" disabled={isSearchingSpotify}>
                    {isSearchingSpotify ? <Loader2 className="spin size-4" /> : <Search size={16} />}
                    {common("search")}
                  </button>
                </form>
                {spotifyMessage ? <p className="text-sm leading-5 text-stone-600">{spotifyMessage}</p> : null}
                {spotifyResults.length > 0 ? (
                  <div className="grid max-h-60 gap-2 overflow-auto pr-1 sm:grid-cols-2">
                    {spotifyResults.map((track) => (
                      <button
                        className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-white/80 bg-white/85 p-2 text-left transition hover:border-emerald-200 hover:bg-white"
                        type="button"
                        key={track.id}
                        onClick={() => void importSpotifyTrack(track)}
                      >
                        {track.albumArtUrl ? (
                          <Image className="size-11 rounded-lg object-cover" src={track.albumArtUrl} alt={t("coverAlt", { title: track.title })} width={44} height={44} />
                        ) : (
                          <div className="grid size-11 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                            <Music2 size={17} />
                          </div>
                        )}
                        <span className="min-w-0">
                          <strong className="block truncate text-sm font-semibold text-stone-950">{track.title}</strong>
                          <small className="block truncate text-xs text-stone-500">
                            {track.artist} · {formatDuration(track.durationMs)}
                            {track.source === "lrclib" ? " · LRCLIB" : ""}
                          </small>
                        </span>
                        {importingTrackId === track.id ? <Loader2 className="spin size-4" /> : <Plus size={15} />}
                      </button>
                    ))}
                  </div>
                ) : null}
                <p className="text-xs leading-5 text-stone-500">{t("songFlowManualFallback")}</p>
              </section>
            ) : null}

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

              {draft.albumArtUrl || draft.spotifyUrl ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
                  {draft.albumArtUrl ? <Image className="rounded-md object-cover" src={draft.albumArtUrl} alt={draft.title ? t("coverAlt", { title: draft.title }) : t("importedCoverAlt")} width={54} height={54} /> : null}
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase text-stone-500">{t("importedFromSpotify")}</p>
                    <p className="mt-1 text-sm text-stone-600">
                      {draft.albumName ? `${draft.albumName} · ` : ""}
                      {formatDuration(draft.durationMs)}
                    </p>
                    {draft.spotifyUrl ? (
                      <a className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700" href={draft.spotifyUrl} target="_blank" rel="noreferrer">
                        {common("openInSpotify")} <ExternalLink size={13} />
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
                {draft.spotifyUrl ? (
                  <a className={`${secondaryButtonClass} min-h-11`} href={draft.spotifyUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} />
                    {common("openInSpotify")}
                  </a>
                ) : (
                  <p className="flex min-h-11 items-center rounded-xl border border-stone-200 bg-stone-50 px-3 text-sm leading-5 text-stone-500">
                    {songDraftHasImportedDetails ? t("spotifyUnavailableForDraft") : t("spotifyAppearsAfterSearch")}
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
          <div>
            <div className="mx-auto max-w-6xl rounded-[1.5rem] border border-white/70 bg-white/[0.94] px-2 py-5 shadow-[0_28px_80px_rgba(0,104,83,0.16)] backdrop-blur-md sm:px-4 sm:py-8">
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
                    onLineSelect={selectLineFromSide}
                    onWordPointerDown={beginWordSelection}
                    onWordPointerMove={updateWordSelectionFromPointer}
                    onWordPointerUp={finishWordSelection}
                    onWordPointerCancel={cancelWordSelection}
                    onWordKeyboardSelect={selectWordFromKeyboard}
                    onPlayAudio={(audioReference) => void playAudioReference(audioReference)}
                    markerById={markerById}
                    selectedLineId={selectedLineId}
                    selectedWordIds={selectedWordIds}
                    lyricTextStyle={lyricTextStyle}
                    lyricLineStyle={lyricLineStyle}
                    lyricWordsStyle={lyricWordsStyle}
                    labels={{
                      emptyLine: common("emptyLine"),
                      lineAudio: t("lineAudioTitle"),
                      wordAudio: t("wordAudioTitle"),
                      note: t("noteTitle")
                    }}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto grid h-full min-h-[24rem] max-w-lg place-items-center content-center">
            <div className="grid w-full justify-items-center gap-4 rounded-[1.5rem] border border-white/70 bg-white/[0.92] p-8 text-center shadow-[0_28px_80px_rgba(0,104,83,0.18)] backdrop-blur-md">
              <Image className="h-auto w-40" src="/images/vocalmap-logo-green.svg" alt={common("appName")} width={351} height={102} priority />
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

      {activeSong && activeAudioProvider && !editingSongId ? (
        <AudioProviderDock
          song={activeSong}
          provider={activeAudioProvider}
          selectedAudioId={selectedSongAudioId}
          sidebarCollapsed={isSidebarCollapsed}
          onProviderChange={setPreferredAudioProvider}
          onSelectedAudioChange={setSelectedSongAudioId}
          supabase={supabase}
          labels={{
            nowPlaying: t("audioDockNowPlaying"),
            spotify: common("spotify"),
            file: t("audioDockFile"),
            fileSelect: t("audioDockFileSelect"),
            noFile: t("audioDockNoFile"),
            spotifyTitle: t("spotifyPlayerTitle", { title: activeSong.title })
          }}
        />
      ) : null}

      {isSettingsOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-stone-950/30 px-4 py-6 backdrop-blur-sm">
          <section className="grid h-[calc(100dvh-3rem)] max-h-[54rem] w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-stone-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-stone-950">Settings</h2>
                <p className="mt-0.5 text-xs text-stone-500">Manage workspace preferences.</p>
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
                      {[18, 24, 30].map((size) => (
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
                        {[4, 8, 16].map((spacing) => (
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
                        {[4, 8, 16].map((spacing) => (
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
          className="fixed z-20 w-[min(23.25rem,calc(100vw-1.5rem))] rounded-lg border border-stone-200 bg-white/95 p-3 backdrop-blur"
          data-marker-popover="true"
          style={popoverStyle}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-stone-500">{selectedData.type === "line" ? t("selectedLine") : selectedData.type === "range" ? t("selectedRange") : t("selectedWord")}</p>
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
          className="fixed bottom-5 right-5 z-30 max-w-[min(26rem,calc(100vw-2.5rem))] rounded-lg border border-stone-200 bg-white px-4 py-3 text-left text-sm leading-6 text-stone-700 shadow-xl"
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
