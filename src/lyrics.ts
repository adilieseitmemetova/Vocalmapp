import type { LyricLine, LyricsMatch } from "./types";

export const LYRICS_TOKENIZER_VERSION = "whitespace-v1";

const NON_ARTIST_WORDS = new Set([
  "acoustic",
  "audio",
  "cover",
  "feat",
  "featuring",
  "hd",
  "hq",
  "instrumental",
  "karaoke",
  "live",
  "lyric",
  "lyrics",
  "music",
  "official",
  "performance",
  "remix",
  "video",
  "version",
  "visualizer"
]);

const ALTERNATE_VERSION_PATTERN = /\b(?:acoustic|cover|instrumental|karaoke|live|remix)\b/i;
const VIDEO_TITLE_METADATA_PATTERN = /\s*[\[(](?=[^\])]*\b(?:acoustic|audio|cover|karaoke|live|lyric|lyrics|music|official|remix|video|visualizer)\b)[^\])]*[\])]/giu;

function makeId() {
  return crypto.randomUUID();
}

export function makeLyricLineId(songId: string, lineIndex: number) {
  return `${songId}:line:${lineIndex}`;
}

export function makeLyricWordId(songId: string, lineIndex: number, wordIndex: number) {
  return `${songId}:word:${lineIndex}:${wordIndex}`;
}

export function splitWords(line: string) {
  return line.match(/\S+/g) ?? [];
}

export function lineWordCountsFromText(text: string) {
  return text.split(/\r?\n/).map((lineText) => splitWords(lineText).length);
}

export function buildLyrics(text: string, existingLines: LyricLine[] = [], songId?: string) {
  return text.split(/\r?\n/).map((lineText, lineIndex) => {
    const previousLine = existingLines[lineIndex];
    const previousLineMatches = previousLine?.text === lineText;
    const words = splitWords(lineText).map((wordText, wordIndex) => {
      const previousWord = previousLine?.words[wordIndex];
      const previousWordMatches = previousLineMatches && previousWord?.text === wordText;

      return {
        id: songId ? makeLyricWordId(songId, lineIndex, wordIndex) : previousWordMatches ? previousWord.id : makeId(),
        text: wordText,
        timestampMs: previousWordMatches ? previousWord.timestampMs : undefined,
        annotations: previousWordMatches ? previousWord.annotations : [],
        audioReference: previousWordMatches ? previousWord.audioReference : undefined,
        textNote: previousWordMatches ? previousWord.textNote : undefined
      };
    });

    return {
      id: songId ? makeLyricLineId(songId, lineIndex) : previousLineMatches ? previousLine.id : makeId(),
      text: lineText,
      words
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
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function getLyricsSearchTitleCandidates(searchQuery: string, videoTitle: string) {
  const candidates = [
    searchQuery,
    ...videoTitle
      .replace(VIDEO_TITLE_METADATA_PATTERN, "")
      .split(/\s[-–—]\s/)
  ];
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const normalizedCandidate = normalize(candidate);
    if (!normalizedCandidate || seen.has(normalizedCandidate)) {
      return false;
    }

    seen.add(normalizedCandidate);
    return true;
  });
}

function significantWords(value: string) {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((word) => word.length > 1 && !NON_ARTIST_WORDS.has(word))
  );
}

function scoreArtistHint(matchArtist: string, referenceTitle: string | undefined, searchTitle: string) {
  if (!referenceTitle) {
    return 0;
  }

  const titleWords = significantWords(searchTitle);
  const referenceWords = significantWords(referenceTitle);
  const hintWords = new Set([...referenceWords].filter((word) => !titleWords.has(word)));
  const artistWords = significantWords(matchArtist);

  if (hintWords.size === 0 || artistWords.size === 0) {
    return 0;
  }

  const matchingWords = [...artistWords].filter((word) => hintWords.has(word)).length;
  if (matchingWords === artistWords.size) {
    return 75;
  }

  return matchingWords * 15;
}

function scoreTitleMatch(matchTitle: string, searchTitle: string) {
  const normalizedMatchTitle = normalize(matchTitle);
  const normalizedSearchTitle = normalize(searchTitle);

  if (!normalizedMatchTitle || !normalizedSearchTitle) {
    return 0;
  }

  if (normalizedMatchTitle === normalizedSearchTitle) {
    return 100;
  }

  const matchWords = new Set(normalizedMatchTitle.split(" "));
  const searchWords = new Set(normalizedSearchTitle.split(" "));
  const allWordsMatch = matchWords.size === searchWords.size && [...matchWords].every((word) => searchWords.has(word));
  if (allWordsMatch) {
    return 92;
  }

  if (normalizedMatchTitle.includes(normalizedSearchTitle) || normalizedSearchTitle.includes(normalizedMatchTitle)) {
    return 60;
  }

  return 0;
}

function scoreLyricsMatch(match: LyricsMatch, title: string, referenceTitle?: string) {
  let score = scoreTitleMatch(match.trackName, title);

  score += scoreArtistHint(match.artistName, referenceTitle, title);

  if (match.plainLyrics) {
    score += 14;
  }

  if (match.syncedLyrics) {
    score += 10;
  }

  if (match.instrumental) {
    score -= 30;
  }

  if (ALTERNATE_VERSION_PATTERN.test(match.trackName)) {
    score -= 45;
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
  titles: string[];
  referenceTitle?: string;
}) {
  const titles = [...new Set(options.titles.map((title) => title.trim()).filter(Boolean))];
  if (titles.length === 0) {
    return null;
  }

  // YouTube titles and channel names are unsuitable as search terms because they
  // often describe a cover, live version, or upload. Search LRCLIB's track-title
  // field with every likely title, then use the selected video's title only as a
  // non-blocking hint to rank records that share the same track title.
  const resultSets = await Promise.allSettled(
    titles.map(async (title) => ({
      title,
      matches: await fetchLrcLibSearch(new URLSearchParams({ track_name: title }))
    }))
  );
  const rankedMatches = new Map<number, { match: LyricsMatch; score: number }>();

  for (const result of resultSets) {
    if (result.status !== "fulfilled") {
      continue;
    }

    for (const match of result.value.matches) {
      if (!match.plainLyrics && !match.syncedLyrics) {
        continue;
      }

      const score = scoreLyricsMatch(match, result.value.title, options.referenceTitle);
      const existing = rankedMatches.get(match.id);
      if (!existing || score > existing.score) {
        rankedMatches.set(match.id, { match, score });
      }
    }
  }

  if (rankedMatches.size === 0) {
    return null;
  }

  return [...rankedMatches.values()]
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
