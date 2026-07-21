import { afterEach, describe, expect, it, vi } from "vitest";

import { findLyricsForTrack, getLyricsSearchTitleCandidates } from "@/lyrics";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" }
  });
}

describe("findLyricsForTrack", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches LRCLIB by the entered title only and prefers the original track over a cover", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      {
        id: 101,
        trackName: "Take On Me (Cover)",
        artistName: "A cover artist",
        plainLyrics: "Cover lyrics"
      },
      {
        id: 102,
        trackName: "Take On Me",
        artistName: "a-ha",
        plainLyrics: "Original lyrics"
      }
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const match = await findLyricsForTrack({ titles: ["Take On Me"] });

    expect(fetchMock).toHaveBeenCalledWith("/api/lyrics/search?track_name=Take+On+Me");
    expect(match).toMatchObject({ id: 102, plainLyrics: "Original lyrics" });
  });

  it("uses the selected video title only to rank same-title records after the title-only lookup", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      {
        id: 201,
        trackName: "Man I Need",
        artistName: "Jagwar Ma",
        plainLyrics: "Jagwar Ma lyrics"
      },
      {
        id: 202,
        trackName: "Man I Need",
        artistName: "Olivia Dean",
        plainLyrics: "Olivia Dean lyrics"
      }
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const match = await findLyricsForTrack({
      titles: ["Man I Need"],
      referenceTitle: "Man I Need - Olivia Dean (Lyrics)"
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/lyrics/search?track_name=Man+I+Need");
    expect(match).toMatchObject({ id: 202, artistName: "Olivia Dean" });
  });

  it("does not make a request for an empty title", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(findLyricsForTrack({ titles: ["   "] })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("derives the selected track title from a video title when the search was for an artist", async () => {
    expect(getLyricsSearchTitleCandidates("beyonce", "Beyoncé - Halo (Official Video)")).toEqual([
      "beyonce",
      "Halo"
    ]);
  });

  it("prefers lyrics for the selected track over lyrics that match the artist search", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        { id: 301, trackName: "Beyoncé", artistName: "Another artist", plainLyrics: "Artist result" }
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { id: 302, trackName: "Halo", artistName: "Beyoncé", plainLyrics: "Halo lyrics" }
      ]));
    vi.stubGlobal("fetch", fetchMock);

    const match = await findLyricsForTrack({
      titles: getLyricsSearchTitleCandidates("beyonce", "Beyoncé - Halo (Official Video)"),
      referenceTitle: "Beyoncé - Halo (Official Video)"
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/lyrics/search?track_name=beyonce");
    expect(fetchMock).toHaveBeenCalledWith("/api/lyrics/search?track_name=Halo");
    expect(match).toMatchObject({ id: 302, artistName: "Beyoncé" });
  });
});
