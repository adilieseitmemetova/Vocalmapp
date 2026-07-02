import type { SupabaseClient } from "@supabase/supabase-js";

import { DEFAULT_MARKERS } from "@/markers";
import type { Database, Tables } from "@/lib/database.types";
import type { AudioReference, InitialVocalMapData, LineAnnotation, LyricLine, LyricWord, Marker, MarkerIconName, Song, TextNote, WordAnnotation } from "@/types";

type AppSupabaseClient = SupabaseClient<Database>;
type SongRow = Tables<"songs">;
type LineRow = Tables<"lyric_lines">;
type WordRow = Tables<"lyric_words">;
type AnnotationRow = Tables<"annotations">;
type AudioRow = Tables<"audio_references">;
type TextNoteRow = Tables<"target_notes">;
type MarkerRow = Tables<"markers">;

const markerIcons = new Set<MarkerIconName>([
  "up",
  "down",
  "wave",
  "line",
  "breath",
  "accent",
  "soft",
  "strong",
  "pause",
  "cut",
  "repeat",
  "spark",
  "volume",
  "mute",
  "waveform",
  "waves",
  "mic",
  "music",
  "ear",
  "headphones",
  "timer",
  "activity",
  "gauge",
  "zap",
  "smile",
  "frown",
  "up-right",
  "down-right",
  "chevrons-up",
  "chevrons-down",
  "mic-vocal",
  "podcast",
  "radio",
  "volume-low",
  "volume-off",
  "audio-lines",
  "chart-up",
  "chart-down",
  "signal-high",
  "signal-low",
  "move-vertical",
  "arrow-up-down",
  "arrow-left-right",
  "refresh",
  "rotate",
  "undo",
  "redo",
  "corner-up-right",
  "corner-down-right",
  "spline",
  "blend",
  "layers",
  "brackets",
  "braces",
  "hash",
  "equal",
  "tally-1",
  "tally-2",
  "tally-3"
]);

function requireData<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? ([] as T);
}

function optionalTargetNotes(result: { data: TextNoteRow[] | null; error: { message: string } | null }) {
  if (result.error) {
    const message = result.error.message.toLowerCase();
    if (message.includes("target_notes") || message.includes("schema cache")) {
      return [];
    }
    throw new Error(result.error.message);
  }

  return result.data ?? [];
}

function toMarker(row: MarkerRow): Marker {
  return {
    id: row.id,
    label: row.label,
    meaning: row.meaning,
    color: row.color,
    icon: markerIcons.has(row.icon as MarkerIconName) ? (row.icon as MarkerIconName) : "spark",
    isSystem: row.is_system
  };
}

function toAudioReference(row: AudioRow): AudioReference {
  return {
    id: row.id,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    durationMs: row.duration_ms ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toTextNote(row: TextNoteRow): TextNote {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getInitialVocalMapData(supabase: AppSupabaseClient, userId: string): Promise<InitialVocalMapData> {
  const [songsResult, linesResult, wordsResult, annotationsResult, audioResult, notesResult, markersResult] = await Promise.all([
    supabase.from("songs").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
    supabase.from("lyric_lines").select("*").eq("user_id", userId).order("position", { ascending: true }),
    supabase.from("lyric_words").select("*").eq("user_id", userId).order("position", { ascending: true }),
    supabase.from("annotations").select("*").eq("user_id", userId),
    supabase.from("audio_references").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
    supabase.from("target_notes").select("*").eq("user_id", userId),
    supabase.from("markers").select("*").order("sort_order", { ascending: true })
  ]);

  const songRows = requireData<SongRow[]>(songsResult);
  const lineRows = requireData<LineRow[]>(linesResult);
  const wordRows = requireData<WordRow[]>(wordsResult);
  const annotationRows = requireData<AnnotationRow[]>(annotationsResult);
  const audioRows = requireData<AudioRow[]>(audioResult);
  const noteRows = optionalTargetNotes(notesResult);
  const markerRows = requireData<MarkerRow[]>(markersResult);

  const wordsByLine = new Map<string, WordRow[]>();
  for (const word of wordRows) {
    const words = wordsByLine.get(word.line_id) ?? [];
    words.push(word);
    wordsByLine.set(word.line_id, words);
  }

  const annotationsByLine = new Map<string, LineAnnotation[]>();
  const annotationsByWord = new Map<string, WordAnnotation[]>();
  for (const annotation of annotationRows) {
    if (annotation.target_type === "line" && annotation.line_id) {
      const annotations = annotationsByLine.get(annotation.line_id) ?? [];
      annotations.push({ id: annotation.id, markerId: annotation.marker_id, note: annotation.note ?? undefined });
      annotationsByLine.set(annotation.line_id, annotations);
    }

    if (annotation.target_type === "word" && annotation.word_id) {
      const annotations = annotationsByWord.get(annotation.word_id) ?? [];
      annotations.push({ id: annotation.id, markerId: annotation.marker_id, note: annotation.note ?? undefined });
      annotationsByWord.set(annotation.word_id, annotations);
    }
  }

  const audioBySong = new Map<string, AudioReference[]>();
  const audioByLine = new Map<string, AudioReference>();
  const audioByWord = new Map<string, AudioReference>();
  for (const audio of audioRows) {
    if (audio.target_type === "song") {
      const references = audioBySong.get(audio.song_id) ?? [];
      references.push(toAudioReference(audio));
      audioBySong.set(audio.song_id, references);
    } else if (audio.target_type === "line" && audio.line_id) {
      audioByLine.set(audio.line_id, toAudioReference(audio));
    } else if (audio.target_type === "word" && audio.word_id) {
      audioByWord.set(audio.word_id, toAudioReference(audio));
    }
  }

  const notesByLine = new Map<string, TextNote>();
  const notesByWord = new Map<string, TextNote>();
  for (const note of noteRows) {
    if (note.target_type === "line" && note.line_id) {
      notesByLine.set(note.line_id, toTextNote(note));
    } else if (note.target_type === "word" && note.word_id) {
      notesByWord.set(note.word_id, toTextNote(note));
    }
  }

  const linesBySong = new Map<string, LyricLine[]>();
  for (const line of lineRows) {
    const words: LyricWord[] = (wordsByLine.get(line.id) ?? []).map((word) => ({
      id: word.id,
      text: word.text,
      annotations: annotationsByWord.get(word.id) ?? [],
      audioReference: audioByWord.get(word.id),
      textNote: notesByWord.get(word.id)
    }));

    const lines = linesBySong.get(line.song_id) ?? [];
    lines.push({
      id: line.id,
      text: line.text,
      words,
      annotations: annotationsByLine.get(line.id) ?? [],
      audioReference: audioByLine.get(line.id),
      textNote: notesByLine.get(line.id)
    });
    linesBySong.set(line.song_id, lines);
  }

  const songs: Song[] = songRows.map((song) => ({
    id: song.id,
    title: song.title,
    artist: song.artist ?? undefined,
    albumName: song.album_name ?? undefined,
    albumArtUrl: song.album_art_url ?? undefined,
    spotifyTrackId: song.spotify_track_id ?? undefined,
    spotifyUrl: song.spotify_url ?? undefined,
    lyrics: linesBySong.get(song.id) ?? [],
    sourceLyricsText: song.source_lyrics_text,
    songAudios: audioBySong.get(song.id) ?? [],
    durationMs: song.duration_ms ?? undefined,
    createdAt: song.created_at,
    updatedAt: song.updated_at
  }));

  return {
    songs,
    markers: markerRows.length > 0 ? markerRows.map(toMarker) : DEFAULT_MARKERS
  };
}
