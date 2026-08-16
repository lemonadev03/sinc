import { providerFetchJson } from "./http";
import {
  type CreatePlaylistInput,
  type MusicProviderAdapter,
  type ProviderPlaylist,
  type ProviderTrack,
  type TrackResolution,
} from "./types";
import { normalizeArtist, normalizeIsrc, normalizeTitle, durationsClose } from "../normalize";

const API = "https://api.spotify.com/v1";
const ACCOUNTS = "https://accounts.spotify.com/api/token";

export const SPOTIFY_SCOPES = [
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ");

// --- token exchange helpers (used by the OAuth callback route) ---

export async function exchangeSpotifyCode(code: string, redirectUri: string, clientId: string, clientSecret: string) {
  const res = await fetch(ACCOUNTS, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(`spotify token exchange failed: ${res.status} ${json.error ?? ""}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token, // may be absent on re-auth; keep old one
    expiresInSeconds: json.expires_in ?? 3600,
  };
}

export async function refreshSpotifyToken(refreshToken: string, clientId: string, clientSecret: string) {
  const res = await fetch(ACCOUNTS, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    const err = new Error(`spotify refresh failed: ${res.status} ${json.error ?? ""}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresInSeconds: json.expires_in ?? 3600,
  };
}

// --- API shapes ---

type SpPlaylist = {
  id: string;
  name: string;
  snapshot_id?: string;
  collaborative?: boolean;
  external_urls?: { spotify?: string };
  owner?: { id?: string };
  tracks?: { total?: number };
};

type SpTrack = {
  id: string | null;
  uri: string;
  name: string | null;
  type: string;
  is_local?: boolean;
  explicit?: boolean;
  duration_ms?: number;
  artists?: { name: string }[];
  external_ids?: { isrc?: string };
  album?: { name?: string };
};

export class SpotifyAdapter implements MusicProviderAdapter {
  readonly provider = "spotify" as const;

  constructor(
    private getAccessToken: () => Promise<string>,
    private myExternalId: string | null
  ) {}

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    return providerFetchJson<T>("spotify", `${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    });
  }

  async listPlaylists(): Promise<ProviderPlaylist[]> {
    const out: ProviderPlaylist[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.api<{ items: SpPlaylist[] }>(`/me/playlists?limit=50&offset=${offset}`);
      for (const p of page.items ?? []) {
        out.push({
          providerPlaylistId: p.id,
          name: p.name,
          externalUrl: p.external_urls?.spotify ?? null,
          editable: p.owner?.id != null && p.owner.id === this.myExternalId,
          ownerExternalId: p.owner?.id ?? null,
          providerRevision: p.snapshot_id ?? null,
          trackCount: p.tracks?.total ?? 0,
        });
      }
      if ((page.items ?? []).length < 50 || out.length > 10_000) break;
      offset += 50;
    }
    return out;
  }

  async getPlaylistItems(playlistId: string): Promise<ProviderTrack[]> {
    const out: ProviderTrack[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.api<{ items: { track: SpTrack | null }[] }>(
        `/playlists/${encodeURIComponent(playlistId)}/items?limit=100&offset=${offset}`
      );
      for (const { track } of page.items ?? []) {
        if (!track || track.type !== "track" || !track.id) continue; // episodes, removed tracks
        out.push({
          providerTrackId: track.id,
          providerUri: track.uri,
          isrc: normalizeIsrc(track.external_ids?.isrc),
          title: track.name ?? "",
          artist: track.artists?.[0]?.name ?? "",
          albumTitle: track.album?.name ?? null,
          durationMs: track.duration_ms ?? null,
          explicit: track.explicit ?? false,
          isLocal: track.is_local ?? false,
          inCatalog: !track.is_local,
        });
      }
      if ((page.items ?? []).length < 100 || out.length > 10_000) break;
      offset += 100;
    }
    return out;
  }

  async createPlaylist(input: CreatePlaylistInput): Promise<ProviderPlaylist> {
    const p = await this.api<SpPlaylist>("/me/playlists", {
      method: "POST",
      body: JSON.stringify({ name: input.name, description: input.description ?? "", public: false }),
    });
    return {
      providerPlaylistId: p.id,
      name: p.name,
      externalUrl: p.external_urls?.spotify ?? null,
      editable: true,
      ownerExternalId: this.myExternalId,
      providerRevision: p.snapshot_id ?? null,
      trackCount: 0,
    };
  }

  async addTracks(playlistId: string, trackIds: string[]): Promise<void> {
    // build uris from track ids
    for (let i = 0; i < trackIds.length; i += 100) {
      const batch = trackIds.slice(i, i + 100);
      const res = await this.api<{ snapshot_id: string }>(
        `/playlists/${encodeURIComponent(playlistId)}/items`,
        { method: "POST", body: JSON.stringify({ uris: batch.map((id) => `spotify:track:${id}`) }) }
      );
      void res;
    }
  }

  async resolveTrack(canonical: {
    isrc: string | null;
    title: string;
    artist: string;
    durationMs: number | null;
    explicitHint?: boolean;
  }): Promise<TrackResolution> {
    const qTitle = canonical.title.replace(/["\\]/g, " ").trim();
    const qArtist = canonical.artist.replace(/["\\]/g, " ").trim();
    if (!qTitle || !qArtist) return { status: "unmatched", reason: "missing title/artist" };
    const search = await this.api<{ tracks: { items: SpTrack[] } }>(
      `/search?type=track&limit=10&q=${encodeURIComponent(`track:"${qTitle}" artist:"${qArtist}"`)}`
    );
    const candidates = search.tracks?.items ?? [];
    if (candidates.length === 0) return { status: "unmatched", reason: "no search results" };

    const isrc = normalizeIsrc(canonical.isrc);
    if (isrc) {
      const byIsrc = candidates.find((t) => normalizeIsrc(t.external_ids?.isrc) === isrc);
      if (byIsrc?.id) {
        return {
          status: "matched",
          providerTrackId: byIsrc.id,
          providerUri: byIsrc.uri,
          matchMethod: "isrc",
          confidence: 95,
        };
      }
    }

    const nTitle = normalizeTitle(canonical.title);
    const nArtist = normalizeArtist(canonical.artist);
    const scored = candidates
      .filter((t) => t.id && t.name)
      .map((t) => {
        let score = 0;
        if (normalizeTitle(t.name ?? "") === nTitle && normalizeArtist(t.artists?.[0]?.name ?? "") === nArtist) {
          score = 70;
          if (durationsClose(t.duration_ms ?? null, canonical.durationMs)) score += 10;
          if ((t.explicit ?? false) === (canonical.explicitHint ?? false)) score += 5;
        }
        return { t, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best && best.t.id && best.score >= 70) {
      return {
        status: "matched",
        providerTrackId: best.t.id,
        providerUri: best.t.uri,
        matchMethod: "metadata",
        confidence: Math.min(best.score, 95),
      };
    }
    return { status: "unmatched", reason: "no confident metadata match" };
  }
}
