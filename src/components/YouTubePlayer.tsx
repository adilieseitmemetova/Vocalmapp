"use client";

import { useEffect } from "react";

import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import type { YouTubePlayerErrorCode } from "@/lib/youtube/types";

export function YouTubePlayer({
  videoId,
  title,
  seekRequest,
  onTimeUpdate,
  onError,
  labels
}: {
  videoId: string;
  title: string;
  seekRequest?: { id: number; timeMs: number };
  onTimeUpdate?: (timeMs: number) => void;
  onError?: (code: YouTubePlayerErrorCode) => void;
  labels: {
    speed: string;
    playerUnavailable: string;
  };
}) {
  const { playerElementRef, isReady, playbackRate, playbackRates, seekTo, setRate } = useYouTubePlayer({
    videoId,
    onTimeUpdate,
    onError
  });
  useEffect(() => {
    if (seekRequest) {
      seekTo(seekRequest.timeMs);
    }
  }, [seekRequest, seekTo]);

  return (
    <div className="youtube-player grid gap-3">
      <div className="youtube-player-stage aspect-video overflow-hidden rounded-3xl bg-foreground">
        <div ref={playerElementRef} className="size-full" aria-label={title} />
        <div className="youtube-player-overlay-controls">
          <label className="youtube-player-speed flex items-center text-xs font-medium text-muted-foreground">
            <span className="sr-only">{labels.speed}</span>
            <select className="h-9 rounded-xl border border-white/30 bg-black/60 px-2 text-xs text-white outline-none backdrop-blur-sm focus-visible:border-white focus-visible:ring-[3px] focus-visible:ring-white/40" value={playbackRate} onChange={(event) => setRate(Number(event.target.value))}>
              {playbackRates.map((rate) => <option className="bg-stone-950" key={rate} value={rate}>{rate}×</option>)}
            </select>
          </label>
        </div>
      </div>
      {!isReady ? <p className="text-xs text-muted-foreground">{labels.playerUnavailable}</p> : null}
    </div>
  );
}
