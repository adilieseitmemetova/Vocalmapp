import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

type SpotifyToken = {
  access_token: string;
  expires_in: number;
};

type SpotifyImage = {
  url: string;
  width: number;
  height: number;
};

type SpotifyTrack = {
  id: string;
  name: string;
  duration_ms: number;
  external_urls: { spotify?: string };
  artists: Array<{ name: string }>;
  album: {
    name: string;
    images: SpotifyImage[];
  };
};

export const runtime = "nodejs";

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getSpotifyToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.token;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("SPOTIFY_MISSING_CREDENTIALS");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });

  if (!response.ok) {
    throw new Error(`SPOTIFY_TOKEN_FAILED_${response.status}`);
  }

  const data = (await response.json()) as SpotifyToken;
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000
  };

  return tokenCache.token;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();

  if (!authData?.claims) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json({ error: "Enter a song title or artist." }, { status: 400 });
  }

  try {
    const token = await getSpotifyToken();
    const params = new URLSearchParams({
      q: query,
      type: "track",
      limit: "10",
      market: "US"
    });

    const spotifyResponse = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!spotifyResponse.ok) {
      return NextResponse.json(
        {
          error: "Spotify search failed.",
          status: spotifyResponse.status
        },
        { status: spotifyResponse.status }
      );
    }

    const data = await spotifyResponse.json();
    const tracks = ((data.tracks?.items ?? []) as SpotifyTrack[]).map((track) => ({
      id: track.id,
      title: track.name,
      artist: track.artists.map((artist) => artist.name).join(", "),
      albumName: track.album.name,
      albumArtUrl: track.album.images[0]?.url ?? "",
      durationMs: track.duration_ms,
      spotifyUrl: track.external_urls.spotify ?? ""
    }));

    return NextResponse.json({ tracks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message === "SPOTIFY_MISSING_CREDENTIALS") {
      return NextResponse.json(
        {
          error: "Spotify is not configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to the server environment."
        },
        { status: 501 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
