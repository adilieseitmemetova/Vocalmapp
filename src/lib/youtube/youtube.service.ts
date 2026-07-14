import type { YouTubeSearchErrorCode, YouTubeVersionType, YouTubeVideoSearchResult } from "@/lib/youtube/types";

const YOUTUBE_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

type YouTubeThumbnail = {
  url?: unknown;
};

type YouTubeThumbnails = {
  maxres?: YouTubeThumbnail;
  high?: YouTubeThumbnail;
  medium?: YouTubeThumbnail;
  default?: YouTubeThumbnail;
};

type YouTubeSearchItem = {
  id?: { videoId?: unknown };
  snippet?: {
    title?: unknown;
    channelTitle?: unknown;
    description?: unknown;
    thumbnails?: YouTubeThumbnails;
  };
};

type YouTubeVideoItem = {
  id?: unknown;
  snippet?: {
    title?: unknown;
    channelTitle?: unknown;
    description?: unknown;
    thumbnails?: YouTubeThumbnails;
  };
  contentDetails?: { duration?: unknown };
  status?: { embeddable?: unknown; privacyStatus?: unknown };
};

type YouTubeSearchResponse = {
  items?: YouTubeSearchItem[];
};

type YouTubeVideoResponse = {
  items?: YouTubeVideoItem[];
};

export class YouTubeServiceError extends Error {
  constructor(
    public readonly code: YouTubeSearchErrorCode,
    public readonly status: number
  ) {
    super(code);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function parseApiError(value: unknown) {
  if (!isRecord(value)) {
    return "";
  }

  const error = value.error;
  if (!isRecord(error) || !Array.isArray(error.errors)) {
    return "";
  }

  return toText(error.errors[0] && isRecord(error.errors[0]) ? error.errors[0].reason : "");
}

function thumbnailUrl(thumbnails: YouTubeThumbnails | undefined) {
  if (!thumbnails) {
    return "";
  }

  return toText(thumbnails.maxres?.url) || toText(thumbnails.high?.url) || toText(thumbnails.medium?.url) || toText(thumbnails.default?.url);
}

function durationMsFromIso8601(value: unknown) {
  const duration = toText(value);
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(duration);
  if (!match) {
    return 0;
  }

  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Math.round((Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds)) * 1_000);
}

function getVersionType(title: string, description: string): YouTubeVersionType {
  const text = `${title} ${description}`.toLowerCase();
  if (text.includes("karaoke")) return "karaoke";
  if (text.includes("acoustic")) return "acoustic";
  if (text.includes("cover")) return "cover";
  if (text.includes("live")) return "live";
  if (text.includes("lyric")) return "lyric-video";
  if (text.includes("official audio") || text.includes("audio official")) return "official-audio";
  if (text.includes("official video") || text.includes("official music video") || text.includes("vevo")) return "official-video";
  return "other";
}

function relevanceScore(result: YouTubeVideoSearchResult, query: string) {
  const text = `${result.title} ${result.channelTitle}`.toLowerCase();
  const artistWords = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  const channelMatchesArtist = artistWords.filter((word) => result.channelTitle.toLowerCase().includes(word)).length;
  const versionScore: Record<YouTubeVersionType, number> = {
    "official-audio": 60,
    "official-video": 50,
    "lyric-video": 40,
    other: 30,
    live: 20,
    acoustic: 15,
    cover: 10,
    karaoke: 5
  };

  return versionScore[result.versionType] + channelMatchesArtist * 8 + (text.includes("official") ? 4 : 0);
}

function toSearchErrorCode(status: number, reason: string): YouTubeSearchErrorCode {
  if (status === 403 && reason === "quotaExceeded") return "quotaExceeded";
  if (status === 400 || reason === "keyInvalid" || reason === "ipRefererBlocked") return "invalidApiKey";
  if (status === 403 && ["forbidden", "accessNotConfigured", "dailyLimitExceeded"].includes(reason)) return "invalidApiKey";
  return status >= 500 ? "unavailable" : "searchFailed";
}

async function youtubeFetch<T>(path: string, params: URLSearchParams): Promise<T> {
  const response = await fetch(`${YOUTUBE_API_BASE_URL}${path}?${params.toString()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new YouTubeServiceError(toSearchErrorCode(response.status, parseApiError(payload)), response.status);
  }

  return payload as T;
}

export async function searchYouTubeVideos(query: string, apiKey: string): Promise<YouTubeVideoSearchResult[]> {
  const searchParams = new URLSearchParams({
    key: apiKey,
    part: "snippet",
    type: "video",
    q: query,
    maxResults: "15",
    order: "relevance",
    videoEmbeddable: "true",
    safeSearch: "moderate"
  });
  const searchResponse = await youtubeFetch<YouTubeSearchResponse>("/search", searchParams);
  const videoIds = (searchResponse.items ?? [])
    .map((item) => toText(item.id?.videoId))
    .filter((videoId): videoId is string => VIDEO_ID_PATTERN.test(videoId));

  if (videoIds.length === 0) {
    return [];
  }

  const videoParams = new URLSearchParams({
    key: apiKey,
    part: "snippet,contentDetails,status",
    id: videoIds.join(",")
  });
  const videoResponse = await youtubeFetch<YouTubeVideoResponse>("/videos", videoParams);
  const results = (videoResponse.items ?? []).flatMap((item) => {
    const youtubeVideoId = toText(item.id);
    const title = toText(item.snippet?.title);
    const channelTitle = toText(item.snippet?.channelTitle);
    const description = toText(item.snippet?.description);
    const isEmbeddable = item.status?.embeddable === true;
    const isPublic = item.status?.privacyStatus === "public";

    if (!VIDEO_ID_PATTERN.test(youtubeVideoId) || !title || !isEmbeddable || !isPublic) {
      return [];
    }

    return [{
      youtubeVideoId,
      title,
      artistName: channelTitle,
      channelTitle,
      thumbnailUrl: thumbnailUrl(item.snippet?.thumbnails),
      durationMs: durationMsFromIso8601(item.contentDetails?.duration),
      versionType: getVersionType(title, description),
      isEmbeddable
    }];
  });

  return results.sort((first, second) => relevanceScore(second, query) - relevanceScore(first, query));
}
