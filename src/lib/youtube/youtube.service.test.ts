import { afterEach, describe, expect, it, vi } from "vitest";

import { searchYouTubeVideos } from "@/lib/youtube/youtube.service";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("searchYouTubeVideos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns embeddable public videos with duration and ranked version metadata", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: { videoId: "video-id001" } }, { id: { videoId: "video-id002" } }]
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [
          {
            id: "video-id001",
            snippet: { title: "Song (Live)", channelTitle: "Artist", description: "Live recording", thumbnails: { high: { url: "https://i.ytimg.com/vi/video-id001/hqdefault.jpg" } } },
            contentDetails: { duration: "PT3M15S" },
            status: { embeddable: true, privacyStatus: "public" }
          },
          {
            id: "video-id002",
            snippet: { title: "Song (Official Audio)", channelTitle: "Artist Official", description: "", thumbnails: { medium: { url: "https://i.ytimg.com/vi/video-id002/mqdefault.jpg" } } },
            contentDetails: { duration: "PT3M10S" },
            status: { embeddable: true, privacyStatus: "public" }
          }
        ]
      }));
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchYouTubeVideos("Artist Song", "server-only-key");

    expect(results).toEqual([
      expect.objectContaining({
        youtubeVideoId: "video-id002",
        durationMs: 190_000,
        versionType: "official-audio"
      }),
      expect.objectContaining({
        youtubeVideoId: "video-id001",
        durationMs: 195_000,
        versionType: "live"
      })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("filters private and non-embeddable videos", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ id: { videoId: "video-id003" } }, { id: { videoId: "video-id004" } }] }))
      .mockResolvedValueOnce(jsonResponse({
        items: [
          { id: "video-id003", snippet: { title: "Private", channelTitle: "Artist" }, contentDetails: { duration: "PT3M" }, status: { embeddable: true, privacyStatus: "private" } },
          { id: "video-id004", snippet: { title: "Blocked", channelTitle: "Artist" }, contentDetails: { duration: "PT3M" }, status: { embeddable: false, privacyStatus: "public" } }
        ]
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchYouTubeVideos("Artist Song", "server-only-key")).resolves.toEqual([]);
  });

  it("maps quota responses without exposing the API key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403)));

    await expect(searchYouTubeVideos("Artist Song", "server-only-key")).rejects.toMatchObject({
      code: "quotaExceeded",
      status: 403
    });
  });
});
