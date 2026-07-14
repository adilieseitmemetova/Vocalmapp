import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLyrics } from "@/lyrics";
import { DEFAULT_MARKERS } from "@/markers";
import type { Database, Tables } from "@/lib/database.types";
import type { AudioReference, InitialVocalMapData, LyricLine, Marker, MarkerIconName, Song, TextNote, WordAnnotation, YouTubeVersionType } from "@/types";

type AppSupabaseClient = SupabaseClient<Database>;
type UserSongRow = Tables<"user_songs">;
type LyricsDocumentRow = Tables<"lyrics_documents">;
type AnnotationRow = Tables<"annotations">;
type AudioRow = Tables<"audio_references">;
type TextNoteRow = Tables<"target_notes">;
type MarkerRow = Tables<"markers">;
type LyricTimestampRow = Tables<"lyric_timestamps">;

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
const youTubeVersionTypes = new Set<YouTubeVersionType>(["official-video", "official-audio", "lyric-video", "live", "acoustic", "karaoke", "cover", "other"]);

function toYouTubeVersionType(value: string | null): YouTubeVersionType | undefined {
  return value && youTubeVersionTypes.has(value as YouTubeVersionType) ? (value as YouTubeVersionType) : undefined;
}

function requireData<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? ([] as T);
}

function requireOptionalTableData<T>(result: { data: T | null; error: { code?: string; message: string } | null }, tableName: string) {
  if (!result.error) {
    return result.data ?? ([] as T);
  }

  // During a rolling deploy the app code can arrive before its migration. Keep
  // the dashboard usable until the optional timestamp table is available, but
  // continue surfacing every other data error.
  if (
    result.error.code === "PGRST205" &&
    result.error.message.includes(`public.${tableName}`)
  ) {
    return [] as T;
  }

  throw new Error(result.error.message);
}

function toMarker(row: MarkerRow): Marker {
  return {
    id: row.id,
    code: row.code ?? (row.is_system ? row.id : undefined),
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
    label: row.label,
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

function targetKey(userSongId: string, lineIndex: number, wordIndex: number | null) {
  return `${userSongId}:${lineIndex}:${wordIndex ?? ""}`;
}

function addToMapList<T>(map: Map<string, T[]>, key: string, item: T) {
  const items = map.get(key) ?? [];
  items.push(item);
  map.set(key, items);
}

async function getLyricsDocumentsById(supabase: AppSupabaseClient, documentIds: string[]) {
  const uniqueDocumentIds = Array.from(new Set(documentIds));
  if (uniqueDocumentIds.length === 0) {
    return new Map<string, LyricsDocumentRow>();
  }

  const result = await supabase.from("lyrics_documents").select("*").in("id", uniqueDocumentIds);
  const rows = requireData<LyricsDocumentRow[]>(result);
  return new Map(rows.map((row) => [row.id, row]));
}

export async function getInitialVocalMapData(supabase: AppSupabaseClient, userId: string): Promise<InitialVocalMapData> {
  const [songsResult, annotationsResult, audioResult, notesResult, markersResult, timestampsResult] = await Promise.all([
    supabase.from("user_songs").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
    supabase.from("annotations").select("*").eq("user_id", userId).eq("target_type", "word"),
    supabase.from("audio_references").select("*").eq("user_id", userId).neq("target_type", "line").order("created_at", { ascending: true }),
    supabase.from("target_notes").select("*").eq("user_id", userId).eq("target_type", "word"),
    supabase.from("markers").select("*").order("sort_order", { ascending: true }),
    supabase.from("lyric_timestamps").select("*").eq("user_id", userId)
  ]);

  const userSongRows = requireData<UserSongRow[]>(songsResult);
  const annotationRows = requireData<AnnotationRow[]>(annotationsResult);
  const audioRows = requireData<AudioRow[]>(audioResult);
  const noteRows = requireData<TextNoteRow[]>(notesResult);
  const markerRows = requireData<MarkerRow[]>(markersResult);
  const timestampRows = requireOptionalTableData<LyricTimestampRow[]>(timestampsResult, "lyric_timestamps");
  const lyricsDocumentsById = await getLyricsDocumentsById(
    supabase,
    userSongRows.map((song) => song.lyrics_document_id)
  );

  const annotationsByWord = new Map<string, WordAnnotation[]>();
  for (const annotation of annotationRows) {
    if (annotation.target_type === "word" && annotation.word_index !== null) {
      addToMapList(annotationsByWord, targetKey(annotation.user_song_id, annotation.line_index, annotation.word_index), {
        id: annotation.id,
        markerId: annotation.marker_id,
        note: annotation.note ?? undefined
      });
    }
  }

  const audioBySong = new Map<string, AudioReference[]>();
  const audioByWord = new Map<string, AudioReference>();
  for (const audio of audioRows) {
    if (audio.target_type === "song") {
      addToMapList(audioBySong, audio.user_song_id, toAudioReference(audio));
    } else if (audio.target_type === "word" && audio.line_index !== null && audio.word_index !== null) {
      audioByWord.set(targetKey(audio.user_song_id, audio.line_index, audio.word_index), toAudioReference(audio));
    }
  }

  const notesByWord = new Map<string, TextNote>();
  for (const note of noteRows) {
    if (note.target_type === "word" && note.word_index !== null) {
      notesByWord.set(targetKey(note.user_song_id, note.line_index, note.word_index), toTextNote(note));
    }
  }

  const timestampsByWord = new Map<string, number>();
  for (const timestamp of timestampRows) {
    timestampsByWord.set(targetKey(timestamp.user_song_id, timestamp.line_index, timestamp.word_index), timestamp.timestamp_ms);
  }

  const songs: Song[] = userSongRows.map((song) => {
    const lyricsDocument = lyricsDocumentsById.get(song.lyrics_document_id);
    const sourceLyricsText = lyricsDocument?.lyrics_text ?? "";
    const lyrics: LyricLine[] = buildLyrics(sourceLyricsText, [], song.id).map((line, lineIndex) => ({
      ...line,
      words: line.words.map((word, wordIndex) => ({
        ...word,
        timestampMs: timestampsByWord.get(targetKey(song.id, lineIndex, wordIndex)),
        annotations: annotationsByWord.get(targetKey(song.id, lineIndex, wordIndex)) ?? [],
        audioReference: audioByWord.get(targetKey(song.id, lineIndex, wordIndex)),
        textNote: notesByWord.get(targetKey(song.id, lineIndex, wordIndex))
      }))
    }));

    return {
      id: song.id,
      trackId: song.track_id,
      lyricsDocumentId: song.lyrics_document_id,
      title: song.title,
      artist: song.artist ?? undefined,
      youtubeVideoId: song.youtube_video_id ?? undefined,
      videoTitle: song.video_title ?? undefined,
      channelTitle: song.channel_title ?? undefined,
      thumbnailUrl: song.thumbnail_url ?? undefined,
      originalSearchQuery: song.original_search_query ?? undefined,
      selectedVersionType: toYouTubeVersionType(song.selected_version_type),
      source: song.source === "youtube" ? "youtube" : song.source === "manual" ? "manual" : "legacy",
      lyrics,
      sourceLyricsText,
      songAudios: audioBySong.get(song.id) ?? [],
      durationMs: song.duration_ms ?? undefined,
      createdAt: song.created_at,
      updatedAt: song.updated_at
    };
  });

  return {
    songs,
    markers: markerRows.length > 0 ? markerRows.map(toMarker) : DEFAULT_MARKERS
  };
}
