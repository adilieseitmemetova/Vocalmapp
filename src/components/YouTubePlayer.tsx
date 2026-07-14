"use client";

import { Pause, Play, Repeat2, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import type { YouTubePlayerErrorCode } from "@/lib/youtube/types";

function formatTimestamp(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

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
    play: string;
    pause: string;
    rewind: string;
    forward: string;
    speed: string;
    loopStart: string;
    loopEnd: string;
    clearLoop: string;
    playerUnavailable: string;
  };
}) {
  const { playerElementRef, isReady, isPlaying, currentTimeMs, durationMs, playbackRate, playbackRates, play, pause, seekTo, setRate } = useYouTubePlayer({
    videoId,
    onTimeUpdate,
    onError
  });
  const [loopStartMs, setLoopStartMs] = useState<number | null>(null);
  const [loopEndMs, setLoopEndMs] = useState<number | null>(null);

  useEffect(() => {
    if (seekRequest) {
      seekTo(seekRequest.timeMs);
    }
  }, [seekRequest, seekTo]);

  useEffect(() => {
    if (loopStartMs !== null && loopEndMs !== null && currentTimeMs >= loopEndMs) {
      seekTo(loopStartMs);
    }
  }, [currentTimeMs, loopEndMs, loopStartMs, seekTo]);

  return (
    <div className="grid gap-3">
      <div className="aspect-video overflow-hidden rounded-xl bg-stone-950">
        <div ref={playerElementRef} className="size-full" aria-label={title} />
      </div>
      {!isReady ? <p className="text-xs text-stone-500">{labels.playerUnavailable}</p> : null}
      <div className="grid gap-2 md:grid-cols-[auto_auto_auto_minmax(0,1fr)_auto_auto_auto] md:items-center">
        <button className="inline-grid size-10 place-items-center rounded-full bg-stone-950 text-white transition hover:bg-stone-800" type="button" onClick={isPlaying ? pause : play} title={isPlaying ? labels.pause : labels.play}>
          {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
        </button>
        <button className="inline-grid size-9 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:bg-stone-50" type="button" onClick={() => seekTo(currentTimeMs - 10_000)} title={labels.rewind}>
          <RotateCcw size={15} />
        </button>
        <button className="inline-grid size-9 place-items-center rounded-full border border-stone-200 bg-white text-stone-700 transition hover:bg-stone-50" type="button" onClick={() => seekTo(currentTimeMs + 10_000)} title={labels.forward}>
          <RotateCw size={15} />
        </button>
        <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-stone-600">
          <span className="w-9 tabular-nums">{formatTimestamp(currentTimeMs)}</span>
          <input className="min-w-0 flex-1 accent-emerald-600" type="range" min="0" max={Math.max(durationMs, 1)} value={Math.min(currentTimeMs, durationMs)} onChange={(event) => seekTo(Number(event.target.value), false)} onMouseUp={(event) => seekTo(Number(event.currentTarget.value))} aria-label={title} />
          <span className="w-9 tabular-nums">{formatTimestamp(durationMs)}</span>
        </label>
        <label className="flex items-center gap-1 text-xs font-medium text-stone-600">
          <span className="sr-only">{labels.speed}</span>
          <select className="h-9 rounded-lg border border-stone-200 bg-white px-2 text-xs" value={playbackRate} onChange={(event) => setRate(Number(event.target.value))}>
            {playbackRates.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
          </select>
        </label>
        <button className="inline-flex h-9 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 text-xs font-medium text-stone-700 transition hover:bg-stone-50" type="button" onClick={() => setLoopStartMs(currentTimeMs)} title={labels.loopStart}>
          <Repeat2 size={14} /> A
        </button>
        <button
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 text-xs font-medium text-stone-700 transition hover:bg-stone-50"
          type="button"
          onClick={() => {
            if (loopStartMs !== null && currentTimeMs > loopStartMs) setLoopEndMs(currentTimeMs);
          }}
          title={loopEndMs !== null ? labels.clearLoop : labels.loopEnd}
        >
          <Repeat2 size={14} /> {loopEndMs !== null ? "A–B" : "B"}
        </button>
      </div>
      {loopEndMs !== null ? <button className="justify-self-start text-xs font-medium text-emerald-700 underline" type="button" onClick={() => { setLoopStartMs(null); setLoopEndMs(null); }}>{labels.clearLoop}</button> : null}
    </div>
  );
}
