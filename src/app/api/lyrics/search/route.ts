import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const TEXT_PARAM_MAX_LENGTH = 200;
const ALLOWED_SEARCH_PARAMS = new Set(["q", "track_name"]);

function buildSafeSearchParams(requestUrl: URL) {
  const safeParams = new URLSearchParams();

  for (const [key, value] of requestUrl.searchParams) {
    if (!ALLOWED_SEARCH_PARAMS.has(key)) {
      continue;
    }

    const trimmedValue = value.trim();
    if (!trimmedValue) {
      continue;
    }

    if (trimmedValue.length > TEXT_PARAM_MAX_LENGTH) {
      return null;
    }

    safeParams.set(key, trimmedValue);
  }

  return safeParams;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const safeParams = buildSafeSearchParams(requestUrl);

  if (!safeParams || safeParams.size === 0) {
    return NextResponse.json({ error: "Enter a song title." }, { status: 400 });
  }

  const upstreamUrl = `https://lrclib.net/api/search?${safeParams}`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": "vocalmapp/1.0"
      }
    });
    const text = await upstreamResponse.text();

    return new NextResponse(text, {
      status: upstreamResponse.status,
      headers: {
        "Content-Type": upstreamResponse.headers.get("content-type") ?? "application/json"
      }
    });
  } catch (error) {
    console.error("Lyrics search failed", error);
    return NextResponse.json({ error: "Lyrics search is unavailable." }, { status: 500 });
  }
}
