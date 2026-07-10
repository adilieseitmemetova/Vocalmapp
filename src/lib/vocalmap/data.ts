import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLyrics } from "@/lyrics";
import { DEFAULT_MARKERS } from "@/markers";
import type { Database, Tables } from "@/lib/database.types";
import type { AudioReference, InitialVocalMapData, LineAnnotation, LyricLine, Marker, MarkerIconName, Song, TextNote, WordAnnotation } from "@/types";

type AppSupabaseClient = SupabaseClient<Database>;
type SongRow = Tables<"songs">;
type LineRow = Tables<"lyric_lines">;
type WordRow = Tables<"lyric_words">;
type UserSongRow = Tables<"user_songs">;
type LyricsDocumentRow = Tables<"lyrics_documents">;
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

function isMissingNewSchemaError(error: { message?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("user_songs") ||
    message.includes("lyrics_documents") ||
    message.includes("tracks")
  );
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

async function getInitialLegacyVocalMapData(supabase: AppSupabaseClient, userId: string): Promise<InitialVocalMapData> {
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
    addToMapList(wordsByLine, word.line_id, word);
  }

  const annotationsByLine = new Map<string, LineAnnotation[]>();
  const annotationsByWord = new Map<string, WordAnnotation[]>();
  for (const annotation of annotationRows) {
    if (annotation.target_type === "line" && annotation.line_id) {
      addToMapList(annotationsByLine, annotation.line_id, { id: annotation.id, markerId: annotation.marker_id, note: annotation.note ?? undefined });
    }

    if (annotation.target_type === "word" && annotation.word_id) {
      addToMapList(annotationsByWord, annotation.word_id, { id: annotation.id, markerId: annotation.marker_id, note: annotation.note ?? undefined });
    }
  }

  const audioBySong = new Map<string, AudioReference[]>();
  const audioByLine = new Map<string, AudioReference>();
  const audioByWord = new Map<string, AudioReference>();
  for (const audio of audioRows) {
    if (audio.target_type === "song" && audio.song_id) {
      addToMapList(audioBySong, audio.song_id, toAudioReference(audio));
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
    const words = (wordsByLine.get(line.id) ?? []).map((word) => ({
      id: word.id,
      text: word.text,
      annotations: annotationsByWord.get(word.id) ?? [],
      audioReference: audioByWord.get(word.id),
      textNote: notesByWord.get(word.id)
    }));

    addToMapList(linesBySong, line.song_id, {
      id: line.id,
      text: line.text,
      words,
      annotations: annotationsByLine.get(line.id) ?? [],
      audioReference: audioByLine.get(line.id),
      textNote: notesByLine.get(line.id)
    });
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

export async function getInitialVocalMapData(supabase: AppSupabaseClient, userId: string): Promise<InitialVocalMapData> {
  const [songsResult, annotationsResult, audioResult, notesResult, markersResult] = await Promise.all([
    supabase.from("user_songs").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
    supabase.from("annotations").select("*").eq("user_id", userId),
    supabase.from("audio_references").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
    supabase.from("target_notes").select("*").eq("user_id", userId),
    supabase.from("markers").select("*").order("sort_order", { ascending: true })
  ]);

  if (isMissingNewSchemaError(songsResult.error)) {
    return getInitialLegacyVocalMapData(supabase, userId);
  }

  const userSongRows = requireData<UserSongRow[]>(songsResult);
  const annotationRows = requireData<AnnotationRow[]>(annotationsResult);
  const audioRows = requireData<AudioRow[]>(audioResult);
  const noteRows = optionalTargetNotes(notesResult);
  const markerRows = requireData<MarkerRow[]>(markersResult);
  const lyricsDocumentsById = await getLyricsDocumentsById(
    supabase,
    userSongRows.map((song) => song.lyrics_document_id)
  );

  const annotationsByLine = new Map<string, LineAnnotation[]>();
  const annotationsByWord = new Map<string, WordAnnotation[]>();
  for (const annotation of annotationRows) {
    if (!annotation.user_song_id || annotation.line_index === null) {
      continue;
    }

    if (annotation.target_type === "line") {
      addToMapList(annotationsByLine, targetKey(annotation.user_song_id, annotation.line_index, null), {
        id: annotation.id,
        markerId: annotation.marker_id,
        note: annotation.note ?? undefined
      });
    }

    if (annotation.target_type === "word" && annotation.word_index !== null) {
      addToMapList(annotationsByWord, targetKey(annotation.user_song_id, annotation.line_index, annotation.word_index), {
        id: annotation.id,
        markerId: annotation.marker_id,
        note: annotation.note ?? undefined
      });
    }
  }

  const audioBySong = new Map<string, AudioReference[]>();
  const audioByLine = new Map<string, AudioReference>();
  const audioByWord = new Map<string, AudioReference>();
  for (const audio of audioRows) {
    if (!audio.user_song_id) {
      continue;
    }

    if (audio.target_type === "song") {
      addToMapList(audioBySong, audio.user_song_id, toAudioReference(audio));
    } else if (audio.target_type === "line" && audio.line_index !== null) {
      audioByLine.set(targetKey(audio.user_song_id, audio.line_index, null), toAudioReference(audio));
    } else if (audio.target_type === "word" && audio.line_index !== null && audio.word_index !== null) {
      audioByWord.set(targetKey(audio.user_song_id, audio.line_index, audio.word_index), toAudioReference(audio));
    }
  }

  const notesByLine = new Map<string, TextNote>();
  const notesByWord = new Map<string, TextNote>();
  for (const note of noteRows) {
    if (!note.user_song_id || note.line_index === null) {
      continue;
    }

    if (note.target_type === "line") {
      notesByLine.set(targetKey(note.user_song_id, note.line_index, null), toTextNote(note));
    } else if (note.target_type === "word" && note.word_index !== null) {
      notesByWord.set(targetKey(note.user_song_id, note.line_index, note.word_index), toTextNote(note));
    }
  }

  const songs: Song[] = userSongRows.map((song) => {
    const lyricsDocument = lyricsDocumentsById.get(song.lyrics_document_id);
    const sourceLyricsText = lyricsDocument?.lyrics_text ?? "";
    const lyrics: LyricLine[] = buildLyrics(sourceLyricsText, [], song.id).map((line, lineIndex) => ({
      ...line,
      annotations: annotationsByLine.get(targetKey(song.id, lineIndex, null)) ?? [],
      audioReference: audioByLine.get(targetKey(song.id, lineIndex, null)),
      textNote: notesByLine.get(targetKey(song.id, lineIndex, null)),
      words: line.words.map((word, wordIndex) => ({
        ...word,
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
      albumName: song.album_name ?? undefined,
      albumArtUrl: song.album_art_url ?? undefined,
      spotifyTrackId: song.spotify_track_id ?? undefined,
      spotifyUrl: song.spotify_url ?? undefined,
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
