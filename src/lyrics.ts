import type { LyricLine, LyricsMatch } from "./types";

function makeId() {
  return crypto.randomUUID();
}

function splitWords(line: string) {
  return line.match(/\S+/g) ?? [];
}

export function buildLyrics(text: string, existingLines: LyricLine[] = []) {
  return text.split(/\r?\n/).map((lineText, lineIndex) => {
    const previousLine = existingLines[lineIndex];
    const previousLineMatches = previousLine?.text === lineText;
    const words = splitWords(lineText).map((wordText, wordIndex) => {
      const previousWord = previousLine?.words[wordIndex];
      const previousWordMatches = previousLineMatches && previousWord?.text === wordText;

      return {
        id: previousWordMatches ? previousWord.id : makeId(),
        text: wordText,
        annotations: previousWordMatches ? previousWord.annotations : [],
        audioReference: previousWordMatches ? previousWord.audioReference : undefined
      };
    });

    return {
      id: previousLineMatches ? previousLine.id : makeId(),
      text: lineText,
      words,
      annotations: previousLineMatches ? previousLine.annotations : [],
      audioReference: previousLineMatches ? previousLine.audioReference : undefined
    };
  });
}

export function lyricsToText(lines: LyricLine[]) {
  return lines.map((line) => line.text).join("\n");
}

export function syncedLyricsToPlainText(syncedLyrics: string) {
  return syncedLyrics
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]+\]\s*/g, "").trim())
    .filter(Boolean)
    .join("\n");
}

export function lyricsTextFromMatch(match: LyricsMatch) {
  if (match.plainLyrics) {
    return match.plainLyrics;
  }

  if (match.syncedLyrics) {
    return syncedLyricsToPlainText(match.syncedLyrics);
  }

  return "";
}

function normalize(value: string | undefined | null) {
  return (value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function scoreLyricsMatch(match: LyricsMatch, title: string, artist: string, durationMs?: number) {
  let score = 0;
  const titleNorm = normalize(title);
  const artistNorm = normalize(artist);
  const matchTitle = normalize(match.trackName);
  const matchArtist = normalize(match.artistName);

  if (matchTitle === titleNorm) {
    score += 30;
  } else if (matchTitle.includes(titleNorm) || titleNorm.includes(matchTitle)) {
    score += 12;
  }

  if (artistNorm && matchArtist.includes(artistNorm.split(" ")[0])) {
    score += 18;
  }

  if (match.plainLyrics) {
    score += 14;
  }

  if (match.syncedLyrics) {
    score += 10;
  }

  if (typeof durationMs === "number" && typeof match.duration === "number") {
    const diffSeconds = Math.abs(match.duration - durationMs / 1000);
    score += Math.max(0, 15 - diffSeconds);
  }

  if (match.instrumental) {
    score -= 30;
  }

  return score;
}

async function fetchLrcLibSearch(params: URLSearchParams) {
  const localUrl = `/api/lyrics/search?${params}`;
  const remoteUrl = `https://lrclib.net/api/search?${params}`;

  try {
    const response = await fetch(localUrl);
    if (response.ok) {
      return (await response.json()) as LyricsMatch[];
    }
  } catch {
    // Static previews do not have local route handlers. Fall back to LRCLIB directly.
  }

  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`LRCLIB search failed: ${response.status}`);
  }
  return (await response.json()) as LyricsMatch[];
}

export async function findLyricsForTrack(options: {
  title: string;
  artist: string;
  albumName?: string;
  durationMs?: number;
}) {
  const exactParams = new URLSearchParams({
    track_name: options.title,
    artist_name: options.artist
  });

  if (options.albumName) {
    exactParams.set("album_name", options.albumName);
  }

  if (typeof options.durationMs === "number") {
    exactParams.set("duration", String(Math.round(options.durationMs / 1000)));
  }

  const broadParams = new URLSearchParams({
    q: `${options.artist} ${options.title}`
  });

  const resultSets = await Promise.allSettled([
    fetchLrcLibSearch(exactParams),
    fetchLrcLibSearch(broadParams)
  ]);

  const matches = resultSets
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((match) => match.plainLyrics || match.syncedLyrics);

  if (matches.length === 0) {
    return null;
  }

  return matches
    .map((match) => ({
      match,
      score: scoreLyricsMatch(match, options.title, options.artist, options.durationMs)
    }))
    .sort((a, b) => b.score - a.score)[0].match;
}

export async function searchLyricsCatalog(query: string) {
  const params = new URLSearchParams({ q: query });
  const matches = await fetchLrcLibSearch(params);
  const seen = new Set<string>();

  return matches
    .filter((match) => match.plainLyrics || match.syncedLyrics)
    .filter((match) => {
      const key = `${normalize(match.artistName)}:${normalize(match.trackName)}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}
