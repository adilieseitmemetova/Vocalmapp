export {};

declare global {
  interface Window {
    YT?: YouTubeIframeNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }

  interface YouTubeIframeNamespace {
    Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayerInstance;
  }

  interface YouTubePlayerInstance {
    destroy(): void;
    getAvailablePlaybackRates(): number[];
    getCurrentTime(): number;
    getDuration(): number;
    pauseVideo(): void;
    playVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    setPlaybackRate(rate: number): void;
  }

  interface YouTubePlayerOptions {
    videoId: string;
    playerVars?: {
      autoplay?: 0 | 1;
      controls?: 0 | 1 | 2;
      modestbranding?: 0 | 1;
      origin?: string;
      playsinline?: 0 | 1;
      rel?: 0 | 1;
    };
    events?: {
      onReady?: (event: { target: YouTubePlayerInstance }) => void;
      onStateChange?: (event: { data: number; target: YouTubePlayerInstance }) => void;
      onPlaybackRateChange?: (event: { data: number; target: YouTubePlayerInstance }) => void;
      onError?: (event: { data: number; target: YouTubePlayerInstance }) => void;
    };
  }
}
