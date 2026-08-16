import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { musicConnections } from "@/db/schema";
import { config, appleConfigured, spotifyConfigured } from "../config";
import { decryptSecret, encryptSecret } from "../crypto";
import { AppleMusicAdapter, getAppleDeveloperToken } from "./apple";
import { SpotifyAdapter, refreshSpotifyToken } from "./spotify";
import { log } from "../log";
import type { Provider } from "./types";

async function loadConnection(userId: string, provider: Provider) {
  const rows = await (await getDb())
    .select()
    .from(musicConnections)
    .where(and(eq(musicConnections.userId, userId), eq(musicConnections.provider, provider)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSpotifyAdapter(userId: string): Promise<SpotifyAdapter | null> {
  const conn = await loadConnection(userId, "spotify");
  if (!conn) return null;
  const myExternalId = conn.externalAccountId;

  const getAccessToken = async (): Promise<string> => {
    const fresh = await loadConnection(userId, "spotify");
    if (!fresh) throw new Error("spotify connection missing");
    const expiresAt = fresh.tokenExpiresAt?.getTime() ?? 0;
    let accessToken = fresh.accessTokenEncrypted ? decryptSecret(fresh.accessTokenEncrypted) : null;
    if (accessToken && expiresAt > Date.now() + 60_000) return accessToken;

    const refreshToken = fresh.refreshTokenEncrypted ? decryptSecret(fresh.refreshTokenEncrypted) : null;
    if (!refreshToken) {
      await markNeedsReconnect(userId, "spotify");
      throw new Error("spotify needs reconnect: no refresh token");
    }
    try {
      const refreshed = await refreshSpotifyToken(
        refreshToken,
        config.spotify.clientId!,
        config.spotify.clientSecret!
      );
      accessToken = refreshed.accessToken;
      await (await getDb())
        .update(musicConnections)
        .set({
          accessTokenEncrypted: encryptSecret(refreshed.accessToken),
          refreshTokenEncrypted: encryptSecret(refreshed.refreshToken),
          tokenExpiresAt: new Date(Date.now() + refreshed.expiresInSeconds * 1000),
          needsReconnect: false,
          lastValidatedAt: new Date(),
        })
        .where(eq(musicConnections.id, fresh.id));
      return accessToken;
    } catch (err) {
      await markNeedsReconnect(userId, "spotify");
      throw new Error(`spotify token refresh failed: ${(err as Error).message}`);
    }
  };

  return new SpotifyAdapter(getAccessToken, myExternalId);
}

export async function getAppleAdapter(userId: string): Promise<AppleMusicAdapter | null> {
  const conn = await loadConnection(userId, "apple");
  if (!conn) return null;
  if (!appleConfigured()) throw new Error("Apple Music credentials are not configured on the server");

  const getDeveloperToken = async () => {
    const { developerToken } = await getAppleDeveloperToken(config.apple);
    return developerToken;
  };
  const getMusicUserToken = async () => {
    const fresh = await loadConnection(userId, "apple");
    if (!fresh?.musicUserTokenEncrypted) {
      await markNeedsReconnect(userId, "apple");
      throw new Error("apple needs reconnect: no music user token");
    }
    return decryptSecret(fresh.musicUserTokenEncrypted);
  };

  return new AppleMusicAdapter(getDeveloperToken, getMusicUserToken, conn.storefront ?? "us");
}

export async function markNeedsReconnect(userId: string, provider: Provider): Promise<void> {
  await (await getDb())
    .update(musicConnections)
    .set({ needsReconnect: true })
    .where(and(eq(musicConnections.userId, userId), eq(musicConnections.provider, provider)));
  log.warn("connection marked needs-reconnect", { provider });
}

/** Validate a stored Apple connection by hitting a personalized endpoint. */
export async function validateAppleConnection(userId: string, musicUserToken: string): Promise<{ storefront: string }> {
  const { developerToken } = await getAppleDeveloperToken(config.apple);
  let storefront = "us";
  try {
    const res = await fetch(`${"https://api.music.apple.com"}/v1/me/storefront`, {
      headers: { Authorization: `Bearer ${developerToken}`, "Media-User-Token": musicUserToken },
      cache: "no-store",
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { id?: string }[] };
      storefront = json.data?.[0]?.id ?? "us";
    } else if (res.status === 401 || res.status === 403) {
      throw new Error("Apple Music rejected the music user token");
    }
  } catch (err) {
    if ((err as Error).message.includes("rejected")) throw err;
    log.warn("storefront lookup failed, defaulting to us", { err: (err as Error).message });
  }
  return { storefront };
}

export async function getAdaptersForUser(userId: string): Promise<{
  spotify?: SpotifyAdapter;
  apple?: AppleMusicAdapter;
}> {
  const [spotify, apple] = await Promise.all([getSpotifyAdapter(userId), getAppleAdapter(userId)]);
  const out: { spotify?: SpotifyAdapter; apple?: AppleMusicAdapter } = {};
  if (spotify) out.spotify = spotify;
  if (apple) out.apple = apple;
  return out;
}

export function providerConfigured(provider: Provider): boolean {
  return provider === "spotify" ? spotifyConfigured() : appleConfigured();
}
