import {
  ExternalLink,
  FileText,
  Library,
  Loader2,
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
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildLyrics,
  findLyricsForTrack,
  lyricsTextFromMatch,
  lyricsToText,
  searchLyricsCatalog,
  syncedLyricsToPlainText
} from "./lyrics";
import { DEFAULT_MARKERS, MARKER_ICON_OPTIONS, markerIcons } from "./markers";
import { deleteAudioBlob, getAudioBlob, loadCustomMarkers, loadSongs, putAudioBlob, saveCustomMarkers, saveSongs } from "./storage";
import type {
  AudioReference,
  LineAnnotation,
  LyricLine,
  LyricWord,
  Marker,
  MarkerIconName,
  SelectedTarget,
  Song,
  SongDraft,
  SpotifyTrackResult,
  WordAnnotation
} from "./types";

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

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
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

function makeAudioReference(blob: Blob): AudioReference {
  const now = new Date().toISOString();
  const id = createId("audio");

  return {
    id,
    storageKey: id,
    mimeType: blob.type || "audio/webm",
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

function collectAudioKeys(song: Song) {
  const keys = new Set<string>();

  if (song.songAudio?.storageKey) {
    keys.add(song.songAudio.storageKey);
  }

  song.lyrics.forEach((line) => {
    if (line.audioReference?.storageKey) {
      keys.add(line.audioReference.storageKey);
    }

    line.words.forEach((word) => {
      if (word.audioReference?.storageKey) {
        keys.add(word.audioReference.storageKey);
      }
    });
  });

  return Array.from(keys);
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

function buildSongFromDraft(draft: SongDraft, existingSong?: Song): Song {
  const now = new Date().toISOString();
  const lyrics = buildLyrics(draft.lyricsText, existingSong?.lyrics);

  return {
    id: existingSong?.id ?? createId("song"),
    title: draft.title.trim() || "Untitled song",
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

function selectedTargetKey(target: SelectedTarget | null) {
  if (!target) {
    return "";
  }
  return `${target.songId}:${target.type}:${target.lineId}:${target.wordId ?? ""}`;
}

function findSelectedData(song: Song | undefined, selection: SelectedTarget | null) {
  if (!song || !selection) {
    return null;
  }

  const line = song.lyrics.find((item) => item.id === selection.lineId);
  if (!line) {
    return null;
  }

  if (selection.type === "line") {
    return {
      type: "line" as const,
      label: line.text.trim() || "Пустая строка",
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
    <span className="marker-badge" style={{ "--marker-color": marker.color } as React.CSSProperties} title={marker.meaning}>
      <Icon size={11} strokeWidth={2.4} />
      <span>{marker.label}</span>
    </span>
  );
}

function AudioDot({ onPlay, title = "Прослушать аудио" }: { onPlay: () => void; title?: string }) {
  return (
    <button className="audio-dot" type="button" title={title} onClick={onPlay}>
      <Play size={10} fill="currentColor" />
    </button>
  );
}

function useAudioUrl(audioReference?: AudioReference) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function loadAudio() {
      if (!audioReference) {
        setUrl(null);
        return;
      }

      const blob = await getAudioBlob(audioReference.storageKey);
      if (!blob || cancelled) {
        return;
      }

      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }

    void loadAudio();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [audioReference]);

  return url;
}

function StoredAudioPlayer({ audioReference }: { audioReference?: AudioReference }) {
  const url = useAudioUrl(audioReference);

  if (!url) {
    return null;
  }

  return <audio className="song-audio-player" controls src={url} />;
}

function LyricsLine({
  line,
  songId,
  onSelect,
  onPlayAudio,
  markerById
}: {
  line: LyricLine;
  songId: string;
  onSelect: (target: SelectedTarget) => void;
  onPlayAudio: (audioReference: AudioReference) => void;
  markerById: Map<string, Marker>;
}) {
  function selectLine(event: React.MouseEvent) {
    onSelect({
      songId,
      type: "line",
      lineId: line.id,
      x: event.clientX,
      y: event.clientY
    });
  }

  function selectWord(event: React.MouseEvent, word: LyricWord) {
    event.stopPropagation();
    onSelect({
      songId,
      type: "word",
      lineId: line.id,
      wordId: word.id,
      x: event.clientX,
      y: event.clientY
    });
  }

  return (
    <div className="lyric-line" onClick={selectLine}>
      <div className="line-gutter">
        <div className="line-assets">
          {line.annotations.map((annotation) => (
            <MarkerBadge key={annotation.id} markerId={annotation.markerId} markerById={markerById} />
          ))}
          {line.audioReference ? <AudioDot onPlay={() => onPlayAudio(line.audioReference!)} title="Аудио строки" /> : null}
        </div>
      </div>
      <div className="line-content">
        {line.words.length === 0 ? (
          <span className="empty-line">Пустая строка</span>
        ) : (
          line.words.map((word) => (
            <span className="word-wrap" key={word.id}>
              <span className="word-assets">
                {word.annotations.map((annotation) => (
                  <MarkerBadge key={annotation.id} markerId={annotation.markerId} markerById={markerById} />
                ))}
                {word.audioReference ? <AudioDot onPlay={() => onPlayAudio(word.audioReference!)} title="Аудио слова" /> : null}
              </span>
              <button className="word-token" type="button" onClick={(event) => selectWord(event, word)}>
                {word.text}
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function SongAudioUploader({
  song,
  onUpload,
  onRemove
}: {
  song: Song;
  onUpload: (song: Song, file: File) => void;
  onRemove: (song: Song) => void;
}) {
  return (
    <div className="song-audio-box">
      <div>
        <p className="section-kicker">Аудио песни / минусовка</p>
        <p className="muted-small">Можно добавить локальный файл для тренировки рядом с текстом.</p>
      </div>
      {song.songAudio ? (
        <div className="song-audio-controls">
          <StoredAudioPlayer audioReference={song.songAudio} />
          <button className="icon-button danger" type="button" onClick={() => onRemove(song)} title="Удалить аудио песни">
            <Trash2 size={16} />
          </button>
        </div>
      ) : (
        <label className="upload-button">
          <Upload size={16} />
          <span>Добавить файл</span>
          <input type="file" accept="audio/*" onChange={(event) => event.target.files?.[0] && onUpload(song, event.target.files[0])} />
        </label>
      )}
    </div>
  );
}

export default function App() {
  const [songs, setSongs] = useState<Song[]>(() => loadSongs());
  const [customMarkers, setCustomMarkers] = useState<Marker[]>(() => loadCustomMarkers());
  const [customMarkerDraft, setCustomMarkerDraft] = useState(EMPTY_CUSTOM_MARKER);
  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const [localSearch, setLocalSearch] = useState("");
  const [draft, setDraft] = useState<SongDraft>(EMPTY_DRAFT);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectedTarget | null>(null);
  const [spotifyQuery, setSpotifyQuery] = useState("");
  const [spotifyResults, setSpotifyResults] = useState<SpotifyTrackResult[]>([]);
  const [spotifyMessage, setSpotifyMessage] = useState("");
  const [isSearchingSpotify, setIsSearchingSpotify] = useState(false);
  const [importingTrackId, setImportingTrackId] = useState<string | null>(null);
  const [recordingTarget, setRecordingTarget] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingSelectionRef = useRef<SelectedTarget | null>(null);

  useEffect(() => {
    saveSongs(songs);
  }, [songs]);

  useEffect(() => {
    saveCustomMarkers(customMarkers);
  }, [customMarkers]);

  useEffect(() => {
    if (!activeSongId && songs.length > 0) {
      setActiveSongId(songs[0].id);
    }
  }, [activeSongId, songs]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelection(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const activeSong = useMemo(() => songs.find((song) => song.id === activeSongId), [activeSongId, songs]);
  const markers = useMemo(() => {
    const usedIds = new Set<string>();
    return [...DEFAULT_MARKERS, ...customMarkers].filter((marker) => {
      if (usedIds.has(marker.id)) {
        return false;
      }
      usedIds.add(marker.id);
      return true;
    });
  }, [customMarkers]);
  const markerById = useMemo(() => new Map(markers.map((marker) => [marker.id, marker])), [markers]);
  const selectedData = useMemo(() => findSelectedData(activeSong, selection), [activeSong, selection]);
  const currentTargetKey = selectedTargetKey(selection);

  const filteredSongs = useMemo(() => {
    const query = localSearch.trim().toLowerCase();
    if (!query) {
      return songs;
    }

    return songs.filter((song) => `${song.title} ${song.artist ?? ""}`.toLowerCase().includes(query));
  }, [localSearch, songs]);

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

  function saveDraft() {
    const existingSong = editingSongId && editingSongId !== "new" ? songs.find((song) => song.id === editingSongId) : undefined;
    const song = buildSongFromDraft(draft, existingSong);

    setSongs((currentSongs) => {
      if (existingSong) {
        return currentSongs.map((item) => (item.id === existingSong.id ? song : item));
      }
      return [song, ...currentSongs];
    });

    setActiveSongId(song.id);
    setEditingSongId(null);
    setSelection(null);
    setStatusMessage("Песня сохранена.");
  }

  async function deleteSong(song: Song) {
    const confirmed = window.confirm(`Удалить "${song.title}" вместе с разметкой и аудио?`);
    if (!confirmed) {
      return;
    }

    await Promise.allSettled(collectAudioKeys(song).map((key) => deleteAudioBlob(key)));
    setSongs((currentSongs) => currentSongs.filter((item) => item.id !== song.id));
    setActiveSongId((currentId) => (currentId === song.id ? null : currentId));
    setSelection(null);
  }

  function addCustomMarker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = customMarkerDraft.label.trim();
    const meaning = customMarkerDraft.meaning.trim();

    if (!label) {
      setStatusMessage("Добавьте короткое название знака.");
      return;
    }

    const now = crypto.randomUUID();
    setCustomMarkers((currentMarkers) => [
      ...currentMarkers,
      {
        id: `custom-${now}`,
        label: label.slice(0, 14),
        meaning: meaning || "Пользовательский вокальный знак",
        color: customMarkerDraft.color,
        icon: customMarkerDraft.icon
      }
    ]);
    setCustomMarkerDraft({ ...EMPTY_CUSTOM_MARKER, color: customMarkerDraft.color });
    setStatusMessage("Знак добавлен.");
  }

  function removeCustomMarker(markerId: string) {
    const marker = customMarkers.find((item) => item.id === markerId);
    if (!marker) {
      return;
    }

    const confirmed = window.confirm(`Удалить знак "${marker.label}" и убрать его из песен?`);
    if (!confirmed) {
      return;
    }

    setCustomMarkers((currentMarkers) => currentMarkers.filter((item) => item.id !== markerId));
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
    setStatusMessage("Знак удален.");
  }

  async function searchSpotify() {
    const query = spotifyQuery.trim();
    if (!query) {
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
          setSpotifyMessage("Spotify не подключен. Показываю результаты LRCLIB: без обложек, но с текстом.");
          return;
        }

        setSpotifyMessage(data.error ?? "Не получилось найти песни в Spotify.");
        return;
      }

      setSpotifyResults((data.tracks ?? []).map((track: SpotifyTrackResult) => ({ ...track, source: "spotify" })));
      if ((data.tracks ?? []).length === 0) {
        setSpotifyMessage("Ничего не найдено. Попробуйте добавить артиста в запрос.");
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
        setSpotifyMessage("Spotify недоступен. Показываю результаты LRCLIB.");
      } catch {
        setSpotifyMessage("Поиск недоступен. Можно добавить песню вручную.");
      }
    } finally {
      setIsSearchingSpotify(false);
    }
  }

  async function importSpotifyTrack(track: SpotifyTrackResult) {
    setImportingTrackId(track.id);
    setSpotifyMessage(track.source === "lrclib" ? "Открываю текст из LRCLIB..." : "Ищу текст через LRCLIB...");

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
          setSpotifyMessage("Текст найден. Проверьте его перед сохранением.");
        } else if (match?.syncedLyrics) {
          lyricsText = syncedLyricsToPlainText(match.syncedLyrics);
          setSpotifyMessage("Найден синхронизированный текст. Таймкоды убраны для разметки.");
        } else {
          setSpotifyMessage("Текст не найден. Вставьте lyrics вручную.");
        }
      } else {
        setSpotifyMessage("Текст найден. Проверьте его перед сохранением.");
      }
    } catch {
      setSpotifyMessage("Не получилось получить текст. Вставьте lyrics вручную.");
    }

    setDraft({
      title: track.title,
      artist: track.artist,
      lyricsText,
      albumName: track.albumName,
      albumArtUrl: track.albumArtUrl,
      spotifyTrackId: track.id,
      spotifyUrl: track.spotifyUrl,
      durationMs: track.durationMs
    });
    setEditingSongId("new");
    setActiveSongId(null);
    setSelection(null);
    setImportingTrackId(null);
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

  function toggleMarker(markerId: string) {
    if (!selection) {
      return;
    }

    updateSelectedTarget(selection, ({ annotations }) => {
      const exists = annotations.some((annotation) => annotation.markerId === markerId);
      if (exists) {
        return {
          annotations: annotations.filter((annotation) => annotation.markerId !== markerId)
        };
      }

      return {
        annotations: [...annotations, { id: createId("annotation"), markerId }]
      };
    });
  }

  async function setAudioReferenceOnSelection(target: SelectedTarget, audioReference: AudioReference) {
    const existing = findSelectedData(songs.find((song) => song.id === target.songId), target)?.audioReference;
    if (existing?.storageKey && existing.storageKey !== audioReference.storageKey) {
      await deleteAudioBlob(existing.storageKey);
    }

    updateSelectedTarget(target, () => ({ audioReference }));
  }

  async function removeAudioReferenceFromSelection() {
    if (!selection || !selectedData?.audioReference) {
      return;
    }

    const storageKey = selectedData.audioReference.storageKey;
    updateSelectedTarget(selection, () => ({ removeAudio: true }));
    await deleteAudioBlob(storageKey);
  }

  async function startRecording() {
    if (!selection) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatusMessage("Браузер не поддерживает запись аудио.");
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
        const audioReference = makeAudioReference(blob);

        recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
        recorderStreamRef.current = null;
        recorderRef.current = null;
        recordingSelectionRef.current = null;
        setRecordingTarget("");

        if (!recordedTarget || blob.size === 0) {
          return;
        }

        await putAudioBlob(audioReference.storageKey, blob);
        await setAudioReferenceOnSelection(recordedTarget, audioReference);
        setStatusMessage("Аудио-референс сохранен.");
      };

      recorderRef.current = recorder;
      recorder.start();
      setRecordingTarget(selectedTargetKey(selection));
      setStatusMessage("Идет запись...");
    } catch {
      setStatusMessage("Не получилось получить доступ к микрофону.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  async function playAudioReference(audioReference: AudioReference) {
    const blob = await getAudioBlob(audioReference.storageKey);
    if (!blob) {
      setStatusMessage("Аудиофайл не найден в локальном хранилище.");
      return;
    }

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => URL.revokeObjectURL(url);
    await audio.play();
  }

  async function uploadSongAudio(song: Song, file: File) {
    const audioReference = makeAudioReference(file);
    await putAudioBlob(audioReference.storageKey, file);

    if (song.songAudio?.storageKey) {
      await deleteAudioBlob(song.songAudio.storageKey);
    }

    setSongs((currentSongs) =>
      currentSongs.map((item) =>
        item.id === song.id ? { ...item, songAudio: audioReference, updatedAt: new Date().toISOString() } : item
      )
    );
  }

  async function removeSongAudio(song: Song) {
    if (song.songAudio?.storageKey) {
      await deleteAudioBlob(song.songAudio.storageKey);
    }

    setSongs((currentSongs) =>
      currentSongs.map((item) => (item.id === song.id ? { ...item, songAudio: undefined, updatedAt: new Date().toISOString() } : item))
    );
  }

  const popoverStyle = selection
    ? ({
        left: `min(${selection.x + 12}px, calc(100vw - 388px))`,
        top: `min(${selection.y + 12}px, calc(100vh - 390px))`
      } as React.CSSProperties)
    : undefined;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Music2 size={18} />
          </div>
          <div>
            <p className="brand-title">VocalMap</p>
            <p className="brand-subtitle">песни, слова, знаки</p>
          </div>
        </div>

        <button className="primary-button full-width" type="button" onClick={openManualDraft}>
          <Plus size={16} />
          Новая песня
        </button>

        <section className="sidebar-section">
          <div className="section-title">
            <Search size={14} />
            Найти современную музыку
          </div>
          <form
            className="spotify-search"
            onSubmit={(event) => {
              event.preventDefault();
              void searchSpotify();
            }}
          >
            <input
              value={spotifyQuery}
              onChange={(event) => setSpotifyQuery(event.target.value)}
              placeholder="SZA, Billie Eilish, Måneskin..."
            />
            <button className="icon-button" type="submit" disabled={isSearchingSpotify} title="Искать">
              {isSearchingSpotify ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
            </button>
          </form>
          {spotifyMessage ? <p className="helper-text">{spotifyMessage}</p> : null}
          <div className="spotify-results">
            {spotifyResults.map((track) => (
              <button className="track-result" type="button" key={track.id} onClick={() => void importSpotifyTrack(track)}>
                {track.albumArtUrl ? <img src={track.albumArtUrl} alt={`${track.title} cover`} /> : <div className="album-placeholder" />}
                <span>
                  <strong>{track.title}</strong>
                  <small>
                    {track.artist} · {formatDuration(track.durationMs)}
                    {track.source === "lrclib" ? " · LRCLIB" : ""}
                  </small>
                </span>
                {importingTrackId === track.id ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}
              </button>
            ))}
          </div>
        </section>

        <section className="sidebar-section marker-manager">
          <div className="section-title">
            <Sparkles size={14} />
            Вокальные знаки
          </div>
          <div className="marker-preview-list">
            {markers.map((marker) => {
              const Icon = markerIcons[marker.icon];
              const isCustom = marker.id.startsWith("custom-");

              return (
                <span
                  className={`marker-preview-pill ${isCustom ? "custom" : ""}`}
                  key={marker.id}
                  style={{ "--marker-color": marker.color } as React.CSSProperties}
                  title={marker.meaning}
                >
                  <Icon size={11} strokeWidth={2.4} />
                  <span>{marker.label}</span>
                  {isCustom ? (
                    <button type="button" onClick={() => removeCustomMarker(marker.id)} title="Удалить знак">
                      <X size={10} />
                    </button>
                  ) : null}
                </span>
              );
            })}
          </div>
          <form className="custom-marker-form" onSubmit={addCustomMarker}>
            <input
              value={customMarkerDraft.label}
              onChange={(event) => setCustomMarkerDraft((current) => ({ ...current, label: event.target.value }))}
              placeholder="Новый знак"
              maxLength={14}
            />
            <input
              value={customMarkerDraft.meaning}
              onChange={(event) => setCustomMarkerDraft((current) => ({ ...current, meaning: event.target.value }))}
              placeholder="Что значит"
            />
            <div className="custom-marker-row">
              <input
                className="color-input"
                type="color"
                value={customMarkerDraft.color}
                onChange={(event) => setCustomMarkerDraft((current) => ({ ...current, color: event.target.value }))}
                title="Цвет знака"
              />
              <select
                value={customMarkerDraft.icon}
                onChange={(event) =>
                  setCustomMarkerDraft((current) => ({ ...current, icon: event.target.value as MarkerIconName }))
                }
              >
                {MARKER_ICON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button className="secondary-button" type="submit">
                <Plus size={14} />
                Add
              </button>
            </div>
          </form>
        </section>

        <section className="sidebar-section grow">
          <div className="section-title">
            <Library size={14} />
            Мои песни
          </div>
          <input
            className="library-search"
            value={localSearch}
            onChange={(event) => setLocalSearch(event.target.value)}
            placeholder="Поиск по библиотеке"
          />
          <div className="song-list">
            {filteredSongs.map((song) => (
              <button
                className={`song-list-item ${song.id === activeSongId ? "active" : ""}`}
                type="button"
                key={song.id}
                onClick={() => {
                  setActiveSongId(song.id);
                  setEditingSongId(null);
                  setSelection(null);
                }}
              >
                {song.albumArtUrl ? <img src={song.albumArtUrl} alt={`${song.title} cover`} /> : <FileText size={17} />}
                <span>
                  <strong>{song.title}</strong>
                  <small>
                    {song.artist ?? "Без артиста"} · {countMarkedTargets(song)} меток
                  </small>
                </span>
              </button>
            ))}
            {filteredSongs.length === 0 ? <p className="helper-text">Песен пока нет.</p> : null}
          </div>
        </section>
      </aside>

      <main className="workspace">
        {editingSongId ? (
          <section className="editor-panel">
            <div className="workspace-toolbar">
              <div>
                <p className="section-kicker">{editingSongId === "new" ? "Новая песня" : "Редактирование"}</p>
                <h1>{draft.title || "Без названия"}</h1>
              </div>
              <div className="toolbar-actions">
                <button className="secondary-button" type="button" onClick={() => setEditingSongId(null)}>
                  <X size={16} />
                  Закрыть
                </button>
                <button className="primary-button" type="button" onClick={saveDraft} disabled={!draft.title.trim()}>
                  Сохранить
                </button>
              </div>
            </div>

            <div className="form-grid">
              <label>
                Название
                <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
              </label>
              <label>
                Исполнитель
                <input value={draft.artist} onChange={(event) => setDraft((current) => ({ ...current, artist: event.target.value }))} />
              </label>
            </div>

            {draft.albumArtUrl || draft.spotifyUrl ? (
              <div className="imported-meta">
                {draft.albumArtUrl ? <img src={draft.albumArtUrl} alt={`${draft.title || "Imported song"} cover`} /> : null}
                <div>
                  <p className="section-kicker">Импортировано из Spotify</p>
                  <p>
                    {draft.albumName ? `${draft.albumName} · ` : ""}
                    {formatDuration(draft.durationMs)}
                  </p>
                  {draft.spotifyUrl ? (
                    <a href={draft.spotifyUrl} target="_blank" rel="noreferrer">
                      Open in Spotify <ExternalLink size={13} />
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            <label className="lyrics-editor-label">
              Текст песни
              <textarea
                value={draft.lyricsText}
                onChange={(event) => setDraft((current) => ({ ...current, lyricsText: event.target.value }))}
                placeholder="Вставьте текст песни. Каждая строка станет кликабельной, каждое слово тоже."
              />
            </label>
          </section>
        ) : activeSong ? (
          <section className="song-workspace">
            <div className="workspace-toolbar">
              <div className="song-heading">
                {activeSong.albumArtUrl ? <img src={activeSong.albumArtUrl} alt={`${activeSong.title} cover`} /> : <div className="album-large-placeholder" />}
                <div>
                  <p className="section-kicker">{activeSong.artist ?? "Без артиста"}</p>
                  <h1>{activeSong.title}</h1>
                  <p className="muted-small">
                    {activeSong.lyrics.length} строк · {countMarkedTargets(activeSong)} отмеченных мест
                  </p>
                </div>
              </div>
              <div className="toolbar-actions">
                {activeSong.spotifyUrl ? (
                  <a className="secondary-link-button" href={activeSong.spotifyUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} />
                    Spotify
                  </a>
                ) : null}
                <button className="secondary-button" type="button" onClick={() => openSongEditor(activeSong)}>
                  <Pencil size={16} />
                  Edit
                </button>
                <button className="icon-button danger" type="button" onClick={() => void deleteSong(activeSong)} title="Удалить песню">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <SongAudioUploader song={activeSong} onUpload={(song, file) => void uploadSongAudio(song, file)} onRemove={(song) => void removeSongAudio(song)} />

            <div className="document-surface">
              {activeSong.lyrics.length === 0 || activeSong.lyrics.every((line) => line.text.trim().length === 0) ? (
                <div className="empty-document">
                  <FileText size={22} />
                  <p>Добавьте текст песни, чтобы начать разметку.</p>
                </div>
              ) : (
                activeSong.lyrics.map((line) => (
                  <LyricsLine
                    key={line.id}
                    line={line}
                    songId={activeSong.id}
                    onSelect={setSelection}
                    onPlayAudio={(audioReference) => void playAudioReference(audioReference)}
                    markerById={markerById}
                  />
                ))
              )}
            </div>
          </section>
        ) : (
          <section className="empty-workspace">
            <div className="empty-icon">
              <Music2 size={22} />
            </div>
            <h1>Создайте первую вокальную карту</h1>
            <p>Найдите песню через Spotify или добавьте текст вручную. Потом ставьте цветные знаки и записывайте звучание строк или слов.</p>
            <button className="primary-button" type="button" onClick={openManualDraft}>
              <Plus size={16} />
              Новая песня
            </button>
          </section>
        )}
      </main>

      {selection && selectedData ? (
        <div className="target-popover" style={popoverStyle}>
          <div className="popover-header">
            <div>
              <p className="section-kicker">{selectedData.type === "line" ? "Строка" : "Слово"}</p>
              <strong>{selectedData.label}</strong>
            </div>
            <button className="icon-button subtle" type="button" onClick={() => setSelection(null)} title="Закрыть">
              <X size={15} />
            </button>
          </div>

          <div className="marker-grid">
            {markers.map((marker) => {
              const Icon = markerIcons[marker.icon];
              const active = selectedData.annotations.some((annotation) => annotation.markerId === marker.id);

              return (
                <button
                  className={`marker-option ${active ? "active" : ""}`}
                  type="button"
                  key={marker.id}
                  style={{ "--marker-color": marker.color } as React.CSSProperties}
                  onClick={() => toggleMarker(marker.id)}
                  aria-pressed={active}
                  title={active ? `${marker.meaning}. Нажмите еще раз, чтобы убрать.` : `${marker.meaning}. Нажмите, чтобы добавить.`}
                >
                  <Icon size={14} strokeWidth={2.4} />
                  <span>{marker.label}</span>
                </button>
              );
            })}
          </div>

          <div className="audio-actions">
            {recordingTarget === currentTargetKey ? (
              <button className="recording-button" type="button" onClick={stopRecording}>
                <Square size={15} fill="currentColor" />
                Stop
              </button>
            ) : (
              <button className="secondary-button" type="button" onClick={() => void startRecording()}>
                <Mic size={15} />
                Record audio
              </button>
            )}

            {selectedData.audioReference ? (
              <>
                <button className="secondary-button" type="button" onClick={() => void playAudioReference(selectedData.audioReference!)}>
                  <Play size={15} fill="currentColor" />
                  Play
                </button>
                <button className="icon-button danger" type="button" onClick={() => void removeAudioReferenceFromSelection()} title="Удалить аудио">
                  <Trash2 size={15} />
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {statusMessage ? (
        <button className="status-toast" type="button" onClick={() => setStatusMessage("")}>
          {statusMessage}
        </button>
      ) : null}
    </div>
  );
}
