import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getClaims();

  if (!authData?.claims) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const upstreamUrl = `https://lrclib.net/api/search${requestUrl.search}`;

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
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
