"use client";

import {
  AudioLines,
  ChevronDown,
  ExternalLink,
  FileText,
  Library,
  Loader2,
  LogOut,
  Mic,
  Music2,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  Square,
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
  UserProfile,
  WordAnnotation
} from "@/types";

const AUDIO_BUCKET = "vocalmap-audio";
const PROFILE_STORAGE_KEY = "vocalmapp:profile:v1";
const MARKER_PREFERENCES_STORAGE_PREFIX = "vocalmapp:marker-preferences";

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
    const lineCount = line.annotations.length > 0 || line.audioReference ? 1 : 0;
    const wordCount = line.words.filter((word) => word.annotations.length > 0 || word.audioReference).length;
    return total + lineCount + wordCount;
  }, 0);
}

function collectAudioPaths(song: Song) {
  const paths = new Set<string>();

  if (song.songAudio?.storagePath) {
    paths.add(song.songAudio.storagePath);
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
    songAudio: existingSong?.songAudio,
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
    }
  | {
      type: "word";
      label: string;
      annotations: WordAnnotation[];
      audioReference?: AudioReference;
    }
  | {
      type: "range";
      label: string;
      annotations: WordAnnotation[];
      wordTargets: Array<{
        lineId: string;
        wordId: string;
        annotations: WordAnnotation[];
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
        annotations: address.word.annotations
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
      audioReference: line.audioReference
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
    audioReference: word.audioReference
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

function StoredAudioPlayer({
  audioReference,
  supabase
}: {
  audioReference?: AudioReference;
  supabase: ReturnType<typeof createClient>;
}) {
  const url = useAudioUrl(audioReference, supabase);

  if (!url) {
    return null;
  }

  return <audio className="h-9 w-full max-w-sm" controls src={url} />;
}

function LyricsLine({
  line,
  songId,
  onSelect,
  onWordPointerDown,
  onWordPointerMove,
  onWordPointerUp,
  onWordPointerCancel,
  onWordKeyboardSelect,
  onPlayAudio,
  markerById,
  selectedLineId,
  selectedWordIds,
  labels
}: {
  line: LyricLine;
  songId: string;
  onSelect: (target: SelectedTarget) => void;
  onWordPointerDown: (event: React.PointerEvent<HTMLButtonElement>, lineId: string, wordId: string) => void;
  onWordPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onWordPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onWordPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onWordKeyboardSelect: (lineId: string, wordId: string, element: HTMLElement) => void;
  onPlayAudio: (audioReference: AudioReference) => void;
  markerById: Map<string, Marker>;
  selectedLineId: string | null;
  selectedWordIds: Set<string>;
  labels: {
    emptyLine: string;
    lineAudio: string;
    wordAudio: string;
  };
}) {
  const lineIsSelected = selectedLineId === line.id;

  function selectLineAt(x: number, y: number) {
    onSelect({
      songId,
      type: "line",
      lineId: line.id,
      x,
      y
    });
  }

  function selectLine(event: React.MouseEvent) {
    selectLineAt(event.clientX, event.clientY);
  }

  function selectLineFromElement(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    selectLineAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  return (
    <div
      className={`grid min-h-12 grid-cols-1 gap-1 rounded-xl border px-3 py-2 transition lg:grid-cols-[9.5rem_minmax(0,1fr)] lg:gap-4 ${
        lineIsSelected ? "border-emerald-200 bg-emerald-50" : "border-transparent hover:border-emerald-100 hover:bg-emerald-50/60"
      }`}
      onClick={selectLine}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectLineFromElement(event.currentTarget);
        }
      }}
    >
      <div className="flex flex-wrap items-start gap-1 pt-0.5 lg:justify-end">
        {line.annotations.map((annotation) => (
          <MarkerBadge key={annotation.id} markerId={annotation.markerId} markerById={markerById} />
        ))}
        {line.audioReference ? <AudioDot onPlay={() => onPlayAudio(line.audioReference!)} title={labels.lineAudio} /> : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 text-xl leading-relaxed text-stone-950 sm:text-2xl">
        {line.words.length === 0 ? (
          <span className="text-sm text-stone-400">{labels.emptyLine}</span>
        ) : (
          line.words.map((word) => {
            const wordIsSelected = selectedWordIds.has(word.id);

            return (
              <span className="inline-flex min-w-0 flex-col items-center gap-0.5 rounded-md" key={word.id}>
                <span className="flex min-h-[18px] flex-wrap items-center justify-center gap-1">
                  {word.annotations.map((annotation) => (
                    <MarkerBadge key={annotation.id} markerId={annotation.markerId} markerById={markerById} />
                  ))}
                  {word.audioReference ? <AudioDot onPlay={() => onPlayAudio(word.audioReference!)} title={labels.wordAudio} /> : null}
                </span>
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
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

function SongAudioUploader({
  song,
  onUpload,
  onRemove,
  supabase,
  labels
}: {
  song: Song;
  onUpload: (song: Song, file: File) => void;
  onRemove: (song: Song) => void;
  supabase: ReturnType<typeof createClient>;
  labels: {
    title: string;
    help: string;
    addFile: string;
    deleteAudio: string;
  };
}) {
  return (
    <div className="mx-auto mb-5 flex max-w-6xl flex-col gap-3 rounded-[1.25rem] border border-white/70 bg-white/[0.9] p-4 shadow-[0_18px_50px_rgba(0,104,83,0.12)] backdrop-blur-md sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase text-stone-500">{labels.title}</p>
        <p className="mt-1 text-sm leading-5 text-stone-600">{labels.help}</p>
      </div>
      {song.songAudio ? (
        <div className="flex items-center gap-2">
          <StoredAudioPlayer audioReference={song.songAudio} supabase={supabase} />
          <button className={`${iconButtonClass} text-red-700`} type="button" onClick={() => onRemove(song)} title={labels.deleteAudio}>
            <Trash2 size={16} />
          </button>
        </div>
      ) : (
        <label className={`${secondaryButtonClass} relative overflow-hidden`}>
          <Upload size={16} />
          <span>{labels.addFile}</span>
          <input
            className="absolute inset-0 cursor-pointer opacity-0"
            type="file"
            accept="audio/*"
            onChange={(event) => event.target.files?.[0] && onUpload(song, event.target.files[0])}
          />
        </label>
      )}
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
  const [isMarkerPanelOpen, setIsMarkerPanelOpen] = useState(false);
  const [isMarkerFormOpen, setIsMarkerFormOpen] = useState(false);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [hiddenSystemMarkerIds, setHiddenSystemMarkerIds] = useState<Set<string>>(() => new Set());
  const [systemMarkerOverrides, setSystemMarkerOverrides] = useState<Record<string, MarkerDraft>>({});
  const [activeSongId, setActiveSongId] = useState<string | null>(initialData.songs[0]?.id ?? null);
  const [localSearch, setLocalSearch] = useState("");
  const [isSongSearchOpen, setIsSongSearchOpen] = useState(false);
  const [draft, setDraft] = useState<SongDraft>(EMPTY_DRAFT);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [selection, setSelection] = useState<LyricsSelection | null>(null);
  const [isSelectingWords, setIsSelectingWords] = useState(false);
  const [spotifyQuery, setSpotifyQuery] = useState("");
  const [spotifyResults, setSpotifyResults] = useState<SpotifyTrackResult[]>([]);
  const [spotifyMessage, setSpotifyMessage] = useState("");
  const [isSearchingSpotify, setIsSearchingSpotify] = useState(false);
  const [importingTrackId, setImportingTrackId] = useState<string | null>(null);
  const [recordingTarget, setRecordingTarget] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasLocalData, setHasLocalData] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [profileDraft, setProfileDraft] = useState({
    displayName: initialProfile.displayName ?? "",
    vocalGoal: initialProfile.vocalGoal ?? ""
  });
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isProfileGateReady, setIsProfileGateReady] = useState(initialProfile.onboardingCompleted);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
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
        setSelection(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setHasLocalData(Boolean(localStorage.getItem("vocalmap:songs:v1") ?? localStorage.getItem("vocal-song-markup:songs:v1")));
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

  const effectiveActiveSongId = activeSongId ?? songs[0]?.id ?? null;
  const activeSong = useMemo(() => songs.find((song) => song.id === effectiveActiveSongId), [effectiveActiveSongId, songs]);
  const markerById = useMemo(() => new Map(markers.map((marker) => [marker.id, marker])), [markers]);
  const visibleMarkers = useMemo(() => markers.filter((marker) => !marker.isSystem || !hiddenSystemMarkerIds.has(marker.id)), [hiddenSystemMarkerIds, markers]);
  const selectedMarker = useMemo(() => visibleMarkers.find((marker) => marker.id === selectedMarkerId) ?? null, [selectedMarkerId, visibleMarkers]);
  const selectedData = useMemo(() => findSelectedData(activeSong, selection, common("emptyLine")), [activeSong, common, selection]);
  const selectedWordIds = useMemo(() => new Set(activeSong ? selectedWordAddresses(activeSong, selection).map((address) => address.word.id) : []), [activeSong, selection]);
  const selectedLineId = selection?.type === "line" ? selection.lineId : null;
  const currentTargetKey = selectedTargetKey(selection);

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

  function openManualDraft() {
    setEditingSongId("new");
    setDraft(EMPTY_DRAFT);
    setSelection(null);
  }

  function openSongEditor(song: Song) {
    setEditingSongId(song.id);
    setDraft(songToDraft(song));
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
    setIsMarkerPanelOpen(true);
    setEditingMarkerId(null);
    setSelectedMarkerId(null);
    setCustomMarkerDraft(EMPTY_CUSTOM_MARKER);
    setIsMarkerFormOpen(true);
  }

  function openMarkerEdit(marker: Marker) {
    setIsMarkerPanelOpen(true);
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

      setSongs((currentSongs) => {
        if (existingSong) {
          return currentSongs.map((item) => (item.id === existingSong.id ? song : item));
        }
        return [song, ...currentSongs];
      });

      setActiveSongId(song.id);
      setEditingSongId(null);
      setSelection(null);
      setStatusMessage(t("songSaved"));
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
    setActiveSongId(null);
    setSelection(null);
    setImportingTrackId(null);
  }

  function beginWordSelection(event: React.PointerEvent<HTMLButtonElement>, lineId: string, wordId: string) {
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
    setSelection(makeWordOrRangeSelection(activeSong.id, anchor, focus, event.clientX, event.clientY));
  }

  function updateWordSelectionFromPointer(event: React.PointerEvent<HTMLButtonElement>) {
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
    setSelection(makeWordOrRangeSelection(dragState.songId, dragState.anchor, focus, event.clientX, event.clientY));
  }

  function finishWordSelection(event: React.PointerEvent<HTMLButtonElement>) {
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

  function cancelWordSelection(event: React.PointerEvent<HTMLButtonElement>) {
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
      annotations: Array<LineAnnotation | WordAnnotation>;
      audioReference?: AudioReference;
    }) => {
      annotations?: Array<LineAnnotation | WordAnnotation>;
      audioReference?: AudioReference;
      removeAudio?: boolean;
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
              audioReference: line.audioReference
            });

            return {
              ...line,
              annotations: (result.annotations as LineAnnotation[] | undefined) ?? line.annotations,
              audioReference: result.removeAudio ? undefined : result.audioReference ?? line.audioReference
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
                audioReference: word.audioReference
              });

              return {
                ...word,
                annotations: (result.annotations as WordAnnotation[] | undefined) ?? word.annotations,
                audioReference: result.removeAudio ? undefined : result.audioReference ?? word.audioReference
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
    }) => {
      annotations?: WordAnnotation[];
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
                annotations: word.annotations
              });

              return {
                ...word,
                annotations: result.annotations ?? word.annotations
              };
            })
          })),
          updatedAt: now
        };
      })
    );
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
    const existingAudio = target.type === "song" ? songs.find((song) => song.id === target.songId)?.songAudio : existingSelectedData?.type === "range" ? undefined : existingSelectedData?.audioReference;

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
        currentSongs.map((item) => (item.id === song.id ? { ...item, songAudio: audioReference, updatedAt: new Date().toISOString() } : item))
      );
      setStatusMessage(t("songAudioSaved"));
    } catch {
      setStatusMessage(t("uploadFailed"));
    }
  }

  async function removeSongAudio(song: Song) {
    if (!song.songAudio) {
      return;
    }

    const { error } = await supabase.from("audio_references").delete().eq("id", song.songAudio.id).eq("user_id", userId);
    if (error) {
      setStatusMessage(t("deleteFailed"));
      return;
    }

    await deleteStoragePaths([song.songAudio.storagePath]);
    setSongs((currentSongs) =>
      currentSongs.map((item) => (item.id === song.id ? { ...item, songAudio: undefined, updatedAt: new Date().toISOString() } : item))
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
      className="relative grid h-dvh grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-3 overflow-hidden bg-[#87f0dc] bg-cover bg-center p-3 md:grid-cols-[20rem_minmax(0,1fr)] md:grid-rows-1"
      style={{ backgroundImage: "url('/images/auth-green-bg.png')" }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,255,246,0.18),rgba(35,181,156,0.12)_46%,rgba(12,130,111,0.24)_100%)]" />
      <aside className="relative z-10 flex max-h-[42dvh] min-h-0 flex-col gap-4 overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/[0.92] p-4 shadow-[0_28px_80px_rgba(0,104,83,0.20)] backdrop-blur-md md:h-full md:max-h-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 flex-none place-items-center rounded-xl bg-emerald-600 text-white shadow-[0_12px_26px_rgba(5,150,105,0.24)]">
              <AudioLines size={19} strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-stone-950">{common("appName")}</p>
              <p className="truncate text-xs text-stone-500">{t("brandSubtitle")}</p>
            </div>
          </div>
          <form action={signOutAction}>
            <button className={`${iconButtonClass} size-9`} type="submit" title={common("signOut")}>
              <LogOut size={16} />
            </button>
          </form>
        </div>

        {hasLocalData ? (
          <button
            className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs leading-5 text-amber-900"
            type="button"
            onClick={() => setHasLocalData(false)}
          >
            <span className="block font-semibold">{common("localDataDetected")}</span>
            <span>{common("dismiss")}</span>
          </button>
        ) : null}

        <button className={`${primaryButtonClass} w-full`} type="button" onClick={openManualDraft}>
          <Plus size={16} />
          {t("newSong")}
        </button>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
        <section className="grid gap-3 border-t border-emerald-100 pt-3">
          <button
            className="flex min-h-11 items-center justify-between gap-3 rounded-2xl px-1 text-left transition hover:bg-emerald-50/70"
            type="button"
            onClick={() => setIsSongSearchOpen((isOpen) => !isOpen)}
            aria-expanded={isSongSearchOpen}
          >
            <span className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase text-stone-500">
              <Search size={14} />
              <span className="truncate">{t("musicSearchTitle")}</span>
            </span>
            <span className="inline-flex flex-none items-center gap-2 text-xs font-bold text-emerald-700">
              {spotifyResults.length > 0 ? t("searchResultsCount", { count: spotifyResults.length }) : t("searchClosedLabel")}
              <ChevronDown className={`size-4 transition ${isSongSearchOpen ? "rotate-180" : ""}`} />
            </span>
          </button>
          {isSongSearchOpen ? (
            <>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchSpotify();
                }}
              >
                <input className={inputClass} value={spotifyQuery} onChange={(event) => setSpotifyQuery(event.target.value)} placeholder={t("musicSearchPlaceholder")} />
                <button className={iconButtonClass} type="submit" disabled={isSearchingSpotify} title={common("search")}>
                  {isSearchingSpotify ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
                </button>
              </form>
              {spotifyMessage ? <p className="text-sm leading-5 text-stone-600">{spotifyMessage}</p> : null}
              <div className="grid max-h-56 gap-1 overflow-auto pr-1">
                {spotifyResults.map((track) => (
                  <button
                    className="grid grid-cols-[2.375rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-transparent p-2 text-left transition hover:border-stone-200 hover:bg-stone-50"
                    type="button"
                    key={track.id}
                    onClick={() => void importSpotifyTrack(track)}
                  >
                    {track.albumArtUrl ? (
                      <Image className="rounded object-cover" src={track.albumArtUrl} alt={t("coverAlt", { title: track.title })} width={38} height={38} />
                    ) : (
                      <div className="grid size-[38px] place-items-center rounded bg-stone-100 text-stone-400">
                        <Music2 size={15} />
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
            </>
          ) : null}
        </section>

        <section className="grid gap-3 border-t border-emerald-100 pt-3">
          <button
            className="flex min-h-11 items-center justify-between gap-3 rounded-2xl px-1 text-left transition hover:bg-emerald-50/70"
            type="button"
            onClick={() => {
              setIsMarkerPanelOpen((isOpen) => !isOpen);
              setIsMarkerFormOpen(false);
              setEditingMarkerId(null);
              setSelectedMarkerId(null);
            }}
            aria-expanded={isMarkerPanelOpen}
          >
            <span className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase text-stone-500">
              <Sparkles size={14} />
              <span className="truncate">{t("markerPanelTitle")}</span>
            </span>
            <span className="inline-flex flex-none items-center gap-2 text-xs font-bold text-emerald-700">
              {t("markerCount", { count: visibleMarkers.length })}
              <ChevronDown className={`size-4 transition ${isMarkerPanelOpen ? "rotate-180" : ""}`} />
            </span>
          </button>
          {isMarkerPanelOpen ? (
            <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs leading-5 text-stone-500">{t("markerPanelHint")}</p>
            <button
              className="inline-flex h-8 flex-none items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100"
              type="button"
              onClick={openMarkerCreate}
            >
              <Plus size={13} />
              {t("markerAddAction")}
            </button>
          </div>
          <div className="flex max-h-36 flex-wrap gap-1.5 overflow-auto pr-1">
            {visibleMarkers.map((marker) => {
              const Icon = markerIcons[marker.icon];
              const isSelected = selectedMarkerId === marker.id;
              return (
                <button
                  className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-xs font-bold transition hover:shadow-sm ${
                    isSelected ? "ring-2 ring-emerald-300 ring-offset-1 ring-offset-white" : ""
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
                  <Icon size={12} strokeWidth={2.4} />
                  <span className="truncate">{marker.label}</span>
                </button>
              );
            })}
          </div>
          {selectedMarker && !isMarkerFormOpen ? (
            <div className="grid gap-2 rounded-2xl border border-emerald-100 bg-white/75 p-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="size-3 flex-none rounded-full" style={{ backgroundColor: selectedMarker.color }} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-stone-950">{selectedMarker.label}</p>
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
            <button className="justify-self-start text-xs font-semibold text-emerald-700 transition hover:text-emerald-900" type="button" onClick={resetSystemMarkers}>
              {t("markerResetDefaults")}
            </button>
          ) : null}
          {isMarkerFormOpen ? (
            <form className="grid gap-2 rounded-2xl border border-emerald-100 bg-white/80 p-3 shadow-sm" onSubmit={(event) => void saveMarker(event)}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase text-stone-500">{editingMarkerId ? t("markerEditTitle") : t("markerCreateTitle")}</p>
                <button className={`${iconButtonClass} size-7 rounded-full border-transparent`} type="button" onClick={closeMarkerForm} title={common("close")}>
                  <X size={13} />
                </button>
              </div>
              <input className={inputClass} value={customMarkerDraft.label} onChange={(event) => setCustomMarkerDraft((current) => ({ ...current, label: event.target.value }))} placeholder={t("markerNamePlaceholder")} maxLength={14} />
              <input className={inputClass} value={customMarkerDraft.meaning} onChange={(event) => setCustomMarkerDraft((current) => ({ ...current, meaning: event.target.value }))} placeholder={t("markerMeaningPlaceholder")} />
              <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-2">
                <input
                  className="h-10 min-w-0 rounded-xl border border-stone-200 bg-white p-1"
                  type="color"
                  value={customMarkerDraft.color}
                  onChange={(event) => setCustomMarkerDraft((current) => ({ ...current, color: event.target.value }))}
                  title={t("markerColorTitle")}
                />
                <select className={inputClass} value={customMarkerDraft.icon} onChange={(event) => setCustomMarkerDraft((current) => ({ ...current, icon: event.target.value as MarkerIconName }))}>
                  {MARKER_ICON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {markerIconLabels(option.value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className={secondaryButtonClass} type="button" onClick={closeMarkerForm}>
                  {common("cancel")}
                </button>
                <button className={primaryButtonClass} type="submit">
                  {editingMarkerId ? t("markerUpdate") : common("add")}
                </button>
              </div>
            </form>
          ) : null}
            </>
          ) : null}
        </section>

        <section className="grid min-h-0 gap-3 border-t border-emerald-100 pt-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase text-stone-500">
            <Library size={14} />
            {t("libraryTitle")}
          </div>
          <input className={inputClass} value={localSearch} onChange={(event) => setLocalSearch(event.target.value)} placeholder={t("librarySearchPlaceholder")} />
          <div className="grid max-h-56 min-h-0 gap-1 overflow-auto pr-1">
            {filteredSongs.map((song) => (
              <button
                className={`grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-2 rounded-md border p-2 text-left transition ${
                  song.id === effectiveActiveSongId ? "border-emerald-200 bg-emerald-50" : "border-transparent hover:border-emerald-100 hover:bg-emerald-50/60"
                }`}
                type="button"
                key={song.id}
                onClick={() => {
                  setActiveSongId(song.id);
                  setEditingSongId(null);
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
            ))}
            {filteredSongs.length === 0 ? <p className="text-sm text-stone-500">{t("emptyLibrary")}</p> : null}
          </div>
        </section>
        </div>

        <button
          className="flex flex-none items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/80 p-3 text-left transition hover:border-emerald-200 hover:bg-emerald-50"
          type="button"
          onClick={() => {
            setProfileDraft({
              displayName: profile.displayName ?? "",
              vocalGoal: profile.vocalGoal ?? ""
            });
            setProfileError("");
            setIsProfileModalOpen(true);
          }}
        >
          <span className="grid size-10 flex-none place-items-center rounded-xl bg-emerald-600 text-white shadow-[0_12px_26px_rgba(5,150,105,0.20)]">
            <UserRound size={18} />
          </span>
          <span className="min-w-0">
            <strong className="block truncate text-sm font-bold text-stone-950">{profileDisplayName}</strong>
            <small className="block truncate text-xs leading-5 text-stone-500">{profileMeta}</small>
          </span>
        </button>
      </aside>

      <section className="relative z-10 min-h-0 min-w-0 overflow-auto px-2 py-4 sm:px-4 lg:px-5">
        {editingSongId ? (
          <div className="mx-auto max-w-6xl rounded-[1.5rem] border border-white/70 bg-white/[0.94] p-5 shadow-[0_28px_80px_rgba(0,104,83,0.18)] backdrop-blur-md">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-stone-500">{editingSongId === "new" ? t("editorNew") : t("editorEdit")}</p>
                <h1 className="mt-1 text-3xl font-bold leading-tight text-stone-950 sm:text-4xl">{draft.title || common("untitledSong")}</h1>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={secondaryButtonClass} type="button" onClick={() => setEditingSongId(null)}>
                  <X size={16} />
                  {common("close")}
                </button>
                <button className={primaryButtonClass} type="button" onClick={() => void saveDraft()} disabled={!draft.title.trim() || isSaving}>
                  {isSaving ? <Loader2 className="spin size-4" /> : null}
                  {isSaving ? common("saving") : common("save")}
                </button>
              </div>
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
              <div className="my-5 flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 p-3">
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

            <label className="mt-5 grid gap-2 text-sm font-semibold text-stone-700">
              {t("lyricsLabel")}
              <textarea
                className="min-h-[46dvh] w-full resize-y rounded-xl border border-stone-200 bg-white p-4 text-base leading-7 text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                value={draft.lyricsText}
                onChange={(event) => setDraft((current) => ({ ...current, lyricsText: event.target.value }))}
                placeholder={t("lyricsPlaceholder")}
              />
            </label>
          </div>
        ) : activeSong ? (
          <div>
            <div className="mx-auto mb-5 flex max-w-6xl flex-col gap-4 rounded-[1.5rem] border border-white/70 bg-white/[0.88] p-4 shadow-[0_22px_60px_rgba(0,104,83,0.14)] backdrop-blur-md sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                {activeSong.albumArtUrl ? (
                  <Image className="size-16 flex-none rounded-lg object-cover" src={activeSong.albumArtUrl} alt={t("coverAlt", { title: activeSong.title })} width={64} height={64} />
                ) : (
                  <div className="grid size-16 flex-none place-items-center rounded-xl border border-emerald-100 bg-white text-emerald-500">
                    <Music2 size={24} />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase text-stone-500">{activeSong.artist ?? common("noArtist")}</p>
                  <h1 className="mt-1 truncate text-3xl font-bold leading-tight text-stone-950 sm:text-4xl">{activeSong.title}</h1>
                  <p className="mt-1 text-sm text-stone-500">
                    {t("linesCount", { count: activeSong.lyrics.length })} · {t("markersCount", { count: countMarkedTargets(activeSong) })}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeSong.spotifyUrl ? (
                  <a className={secondaryButtonClass} href={activeSong.spotifyUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} />
                    {common("spotify")}
                  </a>
                ) : null}
                <button className={secondaryButtonClass} type="button" onClick={() => openSongEditor(activeSong)}>
                  <Pencil size={16} />
                  {common("edit")}
                </button>
                <button className={`${iconButtonClass} text-red-700`} type="button" onClick={() => void deleteSong(activeSong)} title={common("delete")}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <SongAudioUploader
              song={activeSong}
              onUpload={(song, file) => void uploadSongAudio(song, file)}
              onRemove={(song) => void removeSongAudio(song)}
              supabase={supabase}
              labels={{
                title: t("audioBoxTitle"),
                help: t("audioBoxHelp"),
                addFile: t("addAudioFile"),
                deleteAudio: t("deleteSongAudio")
              }}
            />

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
                    onSelect={(target) => setSelection(target)}
                    onWordPointerDown={beginWordSelection}
                    onWordPointerMove={updateWordSelectionFromPointer}
                    onWordPointerUp={finishWordSelection}
                    onWordPointerCancel={cancelWordSelection}
                    onWordKeyboardSelect={selectWordFromKeyboard}
                    onPlayAudio={(audioReference) => void playAudioReference(audioReference)}
                    markerById={markerById}
                    selectedLineId={selectedLineId}
                    selectedWordIds={selectedWordIds}
                    labels={{
                      emptyLine: common("emptyLine"),
                      lineAudio: t("lineAudioTitle"),
                      wordAudio: t("wordAudioTitle")
                    }}
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="mx-auto grid h-full min-h-[24rem] max-w-lg place-items-center content-center">
            <div className="grid w-full justify-items-center gap-4 rounded-[1.5rem] border border-white/70 bg-white/[0.92] p-8 text-center shadow-[0_28px_80px_rgba(0,104,83,0.18)] backdrop-blur-md">
              <div className="grid size-12 place-items-center rounded-xl bg-emerald-600 text-white shadow-[0_12px_26px_rgba(5,150,105,0.24)]">
                <AudioLines size={22} strokeWidth={2.5} />
              </div>
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

      {selection && selectedData && !isSelectingWords ? (
        <div className="fixed z-20 w-[min(23.25rem,calc(100vw-1.5rem))] rounded-lg border border-stone-200 bg-white/95 p-3 shadow-2xl backdrop-blur" style={popoverStyle}>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase text-stone-500">{selectedData.type === "line" ? t("selectedLine") : selectedData.type === "range" ? t("selectedRange") : t("selectedWord")}</p>
              <strong className="block truncate text-sm leading-6 text-stone-950" title={selectedData.label}>
                {selectedData.type === "range" ? t("selectedRangeCount", { count: selectedData.wordTargets.length }) : selectedData.label}
              </strong>
              {selectedData.type === "range" ? <span className="block truncate text-xs leading-5 text-stone-500">{selectedData.label}</span> : null}
            </div>
            <button className={`${iconButtonClass} size-8 border-transparent`} type="button" onClick={() => setSelection(null)} title={common("close")}>
              <X size={15} />
            </button>
          </div>

          <div className="grid max-h-56 grid-cols-2 gap-1.5 overflow-auto pr-1 sm:grid-cols-4">
            {visibleMarkers.map((marker) => {
              const Icon = markerIcons[marker.icon];
              const active = selectedData.annotations.some((annotation) => annotation.markerId === marker.id);

              return (
                <button
                  className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-bold transition ${active ? "ring-2 ring-offset-1" : ""}`}
                  type="button"
                  key={marker.id}
                  style={makeMarkerStyle(marker)}
                  onClick={() => void toggleMarker(marker.id)}
                  aria-pressed={active}
                  title={active ? t("markerActiveTitle", { meaning: marker.meaning }) : t("markerInactiveTitle", { meaning: marker.meaning })}
                >
                  <Icon size={14} strokeWidth={2.4} />
                  <span className="truncate">{marker.label}</span>
                </button>
              );
            })}
          </div>

          {selectedData.type !== "range" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
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
            </div>
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
