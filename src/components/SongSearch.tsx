"use client";

import { Loader2, Search } from "lucide-react";
import { useState } from "react";

import { SongSearchResult } from "@/components/SongSearchResult";
import type { YouTubeSearchErrorCode, YouTubeVideoSearchResult, YouTubeVersionType } from "@/lib/youtube/types";

type SearchResponse = {
  videos?: YouTubeVideoSearchResult[];
  errorCode?: YouTubeSearchErrorCode;
};

const versionLabels: Record<YouTubeVersionType, string> = {
  "official-video": "Official video",
  "official-audio": "Official audio",
  "lyric-video": "Lyric video",
  live: "Live",
  acoustic: "Acoustic",
  karaoke: "Karaoke",
  cover: "Cover",
  other: "Other version"
};

function isSearchResponse(value: unknown): value is SearchResponse {
  return typeof value === "object" && value !== null;
}

export function SongSearch({
  onSelect,
  labels
}: {
  onSelect: (video: YouTubeVideoSearchResult, query: string) => void | Promise<void>;
  labels: {
    placeholder: string;
    search: string;
    queryRequired: string;
    noResults: string;
    authRequired: string;
    queryTooLong: string;
    rateLimited: string;
    missingApiKey: string;
    invalidApiKey: string;
    quotaExceeded: string;
    searchFailed: string;
    unavailable: string;
    resultCount: (count: number) => string;
  };
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YouTubeVideoSearchResult[]>([]);
  const [message, setMessage] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [selectingVideoId, setSelectingVideoId] = useState<string | null>(null);

  const errorMessages: Record<YouTubeSearchErrorCode, string> = {
    authRequired: labels.authRequired,
    queryRequired: labels.queryRequired,
    queryTooLong: labels.queryTooLong,
    rateLimited: labels.rateLimited,
    missingApiKey: labels.missingApiKey,
    invalidApiKey: labels.invalidApiKey,
    quotaExceeded: labels.quotaExceeded,
    searchFailed: labels.searchFailed,
    unavailable: labels.unavailable
  };

  async function search() {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setMessage(labels.queryRequired);
      return;
    }

    setIsSearching(true);
    setMessage("");
    setResults([]);
    try {
      const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(normalizedQuery)}`, { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      const data = isSearchResponse(payload) ? payload : {};

      if (!response.ok) {
        setMessage(data.errorCode ? errorMessages[data.errorCode] : labels.searchFailed);
        return;
      }

      const videos = Array.isArray(data.videos) ? data.videos : [];
      setResults(videos);
      if (videos.length === 0) {
        setMessage(labels.noResults);
      }
    } catch {
      setMessage(labels.unavailable);
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-2xl border border-stone-200 bg-white p-3 sm:p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-bold uppercase text-stone-500">
            <span className="grid size-5 place-items-center rounded-full bg-emerald-600 text-[11px] leading-none text-white">1</span>
            Find the song
          </p>
          <p className="mt-1 text-sm leading-5 text-stone-600">Search YouTube, compare versions, and select the video you want to practise with.</p>
        </div>
        {results.length > 0 ? <p className="text-xs font-bold text-emerald-700">{labels.resultCount(results.length)}</p> : null}
      </div>
      <form
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <input
          className="h-10 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.placeholder}
          maxLength={120}
        />
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-800 transition hover:border-emerald-200 hover:bg-emerald-50 active:scale-[0.99] disabled:opacity-60" type="submit" disabled={isSearching}>
          {isSearching ? <Loader2 className="spin size-4" /> : <Search size={16} />}
          {labels.search}
        </button>
      </form>
      {message ? <p className="text-sm leading-5 text-stone-600" role="status">{message}</p> : null}
      {results.length > 0 ? (
        <div className="grid max-h-72 gap-2 overflow-auto pr-1 sm:grid-cols-2">
          {results.map((video) => (
            <SongSearchResult
              key={video.youtubeVideoId}
              video={video}
              isSelecting={selectingVideoId === video.youtubeVideoId}
              onSelect={() => {
                setSelectingVideoId(video.youtubeVideoId);
                Promise.resolve(onSelect(video, query.trim())).finally(() => setSelectingVideoId(null));
              }}
              versionLabel={versionLabels[video.versionType]}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
