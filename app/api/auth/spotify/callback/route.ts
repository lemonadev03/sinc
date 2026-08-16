import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { musicConnections } from "@/db/schema";
import { config, getAppUrl, spotifyConfigured } from "@/lib/config";
import { encryptSecret } from "@/lib/crypto";
import { exchangeSpotifyCode } from "@/lib/providers/spotify";
import { providerFetchJson } from "@/lib/providers/http";
import { refreshProviderPlaylists } from "@/lib/sync/groups";
import { getSpotifyAdapter } from "@/lib/providers";
import { log } from "@/lib/log";
import { SPOTIFY_STATE_COOKIE } from "@/lib/constants";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state") ?? "";
  const base = getAppUrl();

  const jar = await cookies();
  const cookieState = jar.get(SPOTIFY_STATE_COOKIE)?.value;
  jar.delete(SPOTIFY_STATE_COOKIE);

  if (!code || !cookieState || cookieState !== state) {
    return NextResponse.redirect(`${base}/settings/connections?error=oauth_state`);
  }
  const userId = state.split(".")[1];
  if (!userId) return NextResponse.redirect(`${base}/settings/connections?error=oauth_state`);
  if (!spotifyConfigured()) {
    return NextResponse.redirect(`${base}/settings/connections?error=not_configured`);
  }

  try {
    const exchanged = await exchangeSpotifyTokenSafely(code);
    const me = await providerFetchJson<{ id: string; display_name?: string }>("spotify", "https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${exchanged.accessToken}` },
    });

    const db = await getDb();
    const existing = (
      await db
        .select()
        .from(musicConnections)
        .where(and(eq(musicConnections.userId, userId), eq(musicConnections.provider, "spotify")))
        .limit(1)
    )[0];

    const values = {
      externalAccountId: me.id,
      externalAccountName: me.display_name ?? null,
      accessTokenEncrypted: encryptSecret(exchanged.accessToken),
      refreshTokenEncrypted: exchanged.refreshToken
        ? encryptSecret(exchanged.refreshToken)
        : existing?.refreshTokenEncrypted ?? null,
      tokenExpiresAt: new Date(Date.now() + exchanged.expiresInSeconds * 1000),
      needsReconnect: false,
      lastValidatedAt: new Date(),
    };

    if (existing) {
      await db.update(musicConnections).set(values).where(eq(musicConnections.id, existing.id));
    } else {
      await db.insert(musicConnections).values({
        id: crypto.randomUUID(),
        userId,
        provider: "spotify",
        connectedAt: new Date(),
        ...values,
      });
    }

    // index playlists right away
    try {
      const adapter = await getSpotifyAdapter(userId);
      if (adapter) await refreshProviderPlaylists(userId, "spotify", adapter);
    } catch (err) {
      log.warn("initial spotify playlist index failed", { err: (err as Error).message });
    }

    return NextResponse.redirect(`${base}/onboarding?connected=spotify`);
  } catch (err) {
    log.error("spotify oauth callback failed", { err: (err as Error).message });
    return NextResponse.redirect(`${base}/settings/connections?error=spotify_failed`);
  }
}

async function exchangeSpotifyTokenSafely(code: string) {
  return exchangeSpotifyCode(code, config.spotify.redirectUri, config.spotify.clientId!, config.spotify.clientSecret!);
}
