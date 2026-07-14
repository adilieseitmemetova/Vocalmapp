import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { searchYouTubeVideos, YouTubeServiceError } from "@/lib/youtube/youtube.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_LENGTH = 120;
const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const requestLog = new Map<string, number[]>();

function isRateLimited(userId: string, now: number) {
  const recentRequests = (requestLog.get(userId) ?? []).filter((timestamp) => timestamp > now - REQUEST_WINDOW_MS);
  recentRequests.push(now);
  requestLog.set(userId, recentRequests);
  return recentRequests.length > MAX_REQUESTS_PER_WINDOW;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ errorCode: "authRequired" }, { status: 401 });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ errorCode: "queryRequired" }, { status: 400 });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ errorCode: "queryTooLong" }, { status: 400 });
  }
  if (isRateLimited(authData.user.id, Date.now())) {
    return NextResponse.json({ errorCode: "rateLimited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ errorCode: "missingApiKey" }, { status: 503 });
  }

  try {
    const videos = await searchYouTubeVideos(query, apiKey);
    return NextResponse.json({ videos }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof YouTubeServiceError) {
      return NextResponse.json({ errorCode: error.code }, { status: error.status });
    }

    console.error("YouTube search failed.");
    return NextResponse.json({ errorCode: "unavailable" }, { status: 502 });
  }
}
