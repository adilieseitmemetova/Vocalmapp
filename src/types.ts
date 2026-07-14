import type { YouTubeVersionType } from "@/lib/youtube/types";

export type { YouTubeVideoSearchResult, YouTubeVersionType } from "@/lib/youtube/types";

export type TargetType = "word";

export type MarkerIconName =
  | "up"
  | "down"
  | "wave"
  | "line"
  | "breath"
  | "accent"
  | "soft"
  | "strong"
  | "pause"
  | "cut"
  | "repeat"
  | "spark"
  | "volume"
  | "mute"
  | "waveform"
  | "waves"
  | "mic"
  | "music"
  | "ear"
  | "headphones"
  | "timer"
  | "activity"
  | "gauge"
  | "zap"
  | "smile"
  | "frown"
  | "up-right"
  | "down-right"
  | "chevrons-up"
  | "chevrons-down"
  | "mic-vocal"
  | "podcast"
  | "radio"
  | "volume-low"
  | "volume-off"
  | "audio-lines"
  | "chart-up"
  | "chart-down"
  | "signal-high"
  | "signal-low"
  | "move-vertical"
  | "arrow-up-down"
  | "arrow-left-right"
  | "refresh"
  | "rotate"
  | "undo"
  | "redo"
  | "corner-up-right"
  | "corner-down-right"
  | "spline"
  | "blend"
  | "layers"
  | "brackets"
  | "braces"
  | "hash"
  | "equal"
  | "tally-1"
  | "tally-2"
  | "tally-3";

export type Marker = {
  id: string;
  code?: string;
  label: string;
  meaning: string;
  color: string;
  icon: MarkerIconName;
  isSystem?: boolean;
};

export type AudioReference = {
  id: string;
  label: string;
  storagePath: string;
  mimeType: string;
  durationMs?: number;
  sizeBytes?: number;
  createdAt: string;
  updatedAt: string;
};

export type TextNote = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type WordAnnotation = {
  id: string;
  markerId: string;
  note?: string;
};

export type LyricWord = {
  id: string;
  text: string;
  timestampMs?: number;
  annotations: WordAnnotation[];
  audioReference?: AudioReference;
  textNote?: TextNote;
};

export type LyricLine = {
  id: string;
  text: string;
  words: LyricWord[];
};

export type Song = {
  id: string;
  trackId?: string;
  lyricsDocumentId?: string;
  title: string;
  artist?: string;
  youtubeVideoId?: string;
  videoTitle?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  originalSearchQuery?: string;
  selectedVersionType?: YouTubeVersionType;
  source: "youtube" | "manual" | "legacy";
  lyrics: LyricLine[];
  sourceLyricsText: string;
  songAudios: AudioReference[];
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
};

export type InitialVocalMapData = {
  songs: Song[];
  markers: Marker[];
};

export type UserProfile = {
  id: string;
  email?: string | null;
  displayName?: string | null;
  vocalGoal?: string | null;
  onboardingCompleted: boolean;
};

export type LyricsMatch = {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

export type SelectedTarget = {
  songId: string;
  type: "word";
  lineId: string;
  wordId: string;
  x: number;
  y: number;
};

export type SelectedWordPoint = {
  lineId: string;
  wordId: string;
};

export type SelectedRangeTarget = {
  songId: string;
  type: "range";
  anchor: SelectedWordPoint;
  focus: SelectedWordPoint;
  x: number;
  y: number;
};

export type LyricsSelection = SelectedTarget | SelectedRangeTarget;

export type SongDraft = {
  id?: string;
  title: string;
  artist: string;
  lyricsText: string;
  youtubeVideoId?: string;
  videoTitle?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  originalSearchQuery?: string;
  selectedVersionType?: YouTubeVersionType;
  durationMs?: number;
};
