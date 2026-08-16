import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomToken } from "@/lib/crypto";
import { config, getAppUrl, spotifyConfigured } from "@/lib/config";
import { getSessionUser } from "@/lib/auth";

import { SPOTIFY_STATE_COOKIE } from "@/lib/constants";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(new URL("/login", getAppUrl()));

  if (!spotifyConfigured()) {
    return NextResponse.json({ error: "Spotify is not configured on this server" }, { status: 503 });
  }

  const state = randomToken(16);
  const jar = await cookies();
  jar.set(SPOTIFY_STATE_COOKIE, `${state}.${user.id}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: config.spotify.clientId!,
    response_type: "code",
    redirect_uri: config.spotify.redirectUri,
    state: `${state}.${user.id}`,
    scope: "playlist-read-private playlist-modify-private playlist-modify-public",
    show_dialog: "false",
  });
  void req;
  return NextResponse.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
}
