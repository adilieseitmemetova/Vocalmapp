"use client";

import Image from "next/image";
import { Loader2, Music2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { YouTubeVideoSearchResult } from "@/lib/youtube/types";

function formatDuration(durationMs: number) {
  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function SongSearchResult({
  video,
  isSelecting,
  onSelect,
  versionLabel
}: {
  video: YouTubeVideoSearchResult;
  isSelecting: boolean;
  onSelect: () => void;
  versionLabel: string;
}) {
  return (
    <Button
      className="grid h-auto w-full grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl p-2 text-left whitespace-normal"
      variant="outline"
      type="button"
      onClick={onSelect}
      disabled={isSelecting}
    >
      {video.thumbnailUrl ? (
        <div className="relative h-[3.25rem] w-[4.5rem] overflow-hidden rounded-lg">
          <Image className="object-cover" src={video.thumbnailUrl} alt="" fill sizes="72px" />
        </div>
      ) : (
        <div className="grid h-[3.25rem] w-[4.5rem] place-items-center rounded-lg bg-primary/10 text-primary">
          <Music2 size={18} />
        </div>
      )}
      <span className="min-w-0">
        <strong className="block truncate text-sm font-semibold text-stone-950">{video.title}</strong>
        <small className="mt-0.5 block truncate text-xs text-stone-500">{video.channelTitle}</small>
        <small className="mt-1 block truncate text-[0.6875rem] font-medium text-primary">
          {versionLabel} · {formatDuration(video.durationMs)}
        </small>
      </span>
      {isSelecting ? <Loader2 className="spin size-4" /> : <Plus size={15} />}
    </Button>
  );
}
