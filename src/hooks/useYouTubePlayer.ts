"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { YouTubePlayerErrorCode } from "@/lib/youtube/types";

let iframeApiPromise: Promise<YouTubeIframeNamespace> | null = null;

function loadYouTubeIframeApi() {
  if (window.YT?.Player) {
    return Promise.resolve(window.YT);
  }
  if (iframeApiPromise) {
    return iframeApiPromise;
  }

  iframeApiPromise = new Promise<YouTubeIframeNamespace>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    const previousReady = window.onYouTubeIframeAPIReady;
    const ready = () => {
      previousReady?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube IFrame API did not initialise."));
      }
    };

    window.onYouTubeIframeAPIReady = ready;
    const script = existingScript ?? document.createElement("script");
    if (!existingScript) {
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("error", () => reject(new Error("YouTube IFrame API could not load.")), { once: true });
  });

  return iframeApiPromise;
}

function playerErrorCode(code: number): YouTubePlayerErrorCode {
  if (code === 2) return "invalidVideo";
  if (code === 101 || code === 150) return "embeddingRestricted";
  return "videoUnavailable";
}

export function useYouTubePlayer({
  videoId,
  onTimeUpdate,
  onError
}: {
  videoId: string;
  onTimeUpdate?: (timeMs: number) => void;
  onError?: (code: YouTubePlayerErrorCode) => void;
}) {
  const playerElementRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YouTubePlayerInstance | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onErrorRef = useRef(onError);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackRates, setPlaybackRates] = useState<number[]>([1]);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const element = playerElementRef.current;
    if (!element || !videoId) {
      return;
    }

    let disposed = false;
    setIsReady(false);
    setIsPlaying(false);
    setCurrentTimeMs(0);
    setDurationMs(0);
    setPlaybackRate(1);
    setPlaybackRates([1]);

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (disposed) {
          return;
        }

        playerRef.current = new YT.Player(element, {
          videoId,
          playerVars: {
            controls: 1,
            modestbranding: 1,
            origin: window.location.origin,
            playsinline: 1,
            rel: 0
          },
          events: {
            onReady: ({ target }) => {
              if (disposed) return;
              setIsReady(true);
              setDurationMs(Math.round(target.getDuration() * 1_000));
              const rates = target.getAvailablePlaybackRates();
              setPlaybackRates(rates.length > 0 ? rates : [1]);
            },
            onStateChange: ({ data }) => {
              if (!disposed) {
                setIsPlaying(data === 1);
              }
            },
            onPlaybackRateChange: ({ data }) => {
              if (!disposed) {
                setPlaybackRate(data);
              }
            },
            onError: ({ data }) => onErrorRef.current?.(playerErrorCode(data))
          }
        });
      })
      .catch(() => onErrorRef.current?.("playerLoadFailed"));

    return () => {
      disposed = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  useEffect(() => {
    if (!isReady) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      const nextTimeMs = Math.round(player.getCurrentTime() * 1_000);
      setCurrentTimeMs(nextTimeMs);
      onTimeUpdateRef.current?.(nextTimeMs);
    }, 250);

    return () => window.clearInterval(intervalId);
  }, [isReady]);

  const seekTo = useCallback((timeMs: number, allowSeekAhead = true) => {
    playerRef.current?.seekTo(Math.max(0, timeMs) / 1_000, allowSeekAhead);
  }, []);

  const play = useCallback(() => playerRef.current?.playVideo(), []);
  const pause = useCallback(() => playerRef.current?.pauseVideo(), []);
  const setRate = useCallback((rate: number) => playerRef.current?.setPlaybackRate(rate), []);

  return {
    playerElementRef,
    isReady,
    isPlaying,
    currentTimeMs,
    durationMs,
    playbackRate,
    playbackRates,
    play,
    pause,
    seekTo,
    setRate
  };
}
