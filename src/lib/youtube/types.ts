export type YouTubeVersionType = "official-video" | "official-audio" | "lyric-video" | "live" | "acoustic" | "karaoke" | "cover" | "other";

export type YouTubeVideoSearchResult = {
  youtubeVideoId: string;
  title: string;
  artistName: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationMs: number;
  versionType: YouTubeVersionType;
  isEmbeddable: boolean;
};

export type YouTubeSearchErrorCode = "authRequired" | "queryRequired" | "queryTooLong" | "rateLimited" | "missingApiKey" | "invalidApiKey" | "quotaExceeded" | "searchFailed" | "unavailable";

export type YouTubePlayerErrorCode = "invalidVideo" | "videoUnavailable" | "embeddingRestricted" | "identityMissing" | "playerLoadFailed";
