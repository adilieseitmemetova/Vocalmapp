export type TargetType = "line" | "word";

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
  | "mute";

export type Marker = {
  id: string;
  label: string;
  meaning: string;
  color: string;
  icon: MarkerIconName;
  isSystem?: boolean;
};

export type AudioReference = {
  id: string;
  storagePath: string;
  mimeType: string;
  durationMs?: number;
  sizeBytes?: number;
  createdAt: string;
  updatedAt: string;
};

export type WordAnnotation = {
  id: string;
  markerId: string;
  note?: string;
};

export type LineAnnotation = {
  id: string;
  markerId: string;
  note?: string;
};

export type LyricWord = {
  id: string;
  text: string;
  annotations: WordAnnotation[];
  audioReference?: AudioReference;
};

export type LyricLine = {
  id: string;
  text: string;
  words: LyricWord[];
  annotations: LineAnnotation[];
  audioReference?: AudioReference;
};

export type Song = {
  id: string;
  title: string;
  artist?: string;
  albumName?: string;
  albumArtUrl?: string;
  spotifyTrackId?: string;
  spotifyUrl?: string;
  lyrics: LyricLine[];
  sourceLyricsText: string;
  songAudio?: AudioReference;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
};

export type InitialVocalMapData = {
  songs: Song[];
  markers: Marker[];
};

export type SpotifyTrackResult = {
  id: string;
  title: string;
  artist: string;
  albumName: string;
  albumArtUrl: string;
  durationMs: number;
  spotifyUrl: string;
  source?: "spotify" | "lrclib";
  lyricsText?: string;
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
  type: TargetType;
  lineId: string;
  wordId?: string;
  x: number;
  y: number;
};

export type SongDraft = {
  id?: string;
  title: string;
  artist: string;
  lyricsText: string;
  albumName?: string;
  albumArtUrl?: string;
  spotifyTrackId?: string;
  spotifyUrl?: string;
  durationMs?: number;
};
