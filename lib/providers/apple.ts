import { SignJWT, importPKCS8 } from "jose";
import { providerFetch, providerFetchJson } from "./http";
import {
  type CreatePlaylistInput,
  type MusicProviderAdapter,
  type ProviderPlaylist,
  type ProviderTrack,
  type TrackResolution,
} from "./types";
import { normalizeArtist, normalizeIsrc, normalizeTitle, durationsClose } from "../normalize";

const API = "https://api.music.apple.com";

// --- developer token (ES256 JWT, cached per process) ---

type DevToken = { token: string; expiresAt: number };

const devTokenCache = new Map<string, DevToken>();

export async function getAppleDeveloperToken(cfg: {
  teamId: string;
  keyId: string;
  privateKey: string;
}): Promise<{ developerToken: string; expiresInSeconds: number }> {
  const cacheKey = `${cfg.teamId}:${cfg.keyId}`;
  const cached = devTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return { developerToken: cached.token, expiresInSeconds: Math.floor((cached.expiresAt - Date.now()) / 1000) };
  }
  const ttlSeconds = 60 * 60 * 24 * 30; // 30 days, below Apple's 6-month cap
  const pkcs8 = cfg.privateKey.replace(/\\n/g, "\n");
  let key: CryptoKey;
  try {
    key = await importPKCS8(pkcs8, "ES256");
  } catch {
    throw new Error("APPLE_PRIVATE_KEY is not a valid ES256 PKCS#8 PEM key");
  }
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
  devTokenCache.set(cacheKey, { token, expiresAt: Date.now() + ttlSeconds * 1000 });
  return { developerToken: token, expiresInSeconds: ttlSeconds };
}

// --- API shapes ---

type AmAttributes = {
  name?: string;
  artistName?: string;
  albumName?: string;
  durationInMillis?: number;
  isrc?: string;
  contentRating?: "explicit" | "clean";
  canEdit?: boolean;
  hasCatalog?: boolean;
  trackCount?: number;
  url?: string;
};

type AmResource = {
  id: string;
  type: string;
  attributes?: AmAttributes;
  relationships?: { catalog?: { data?: AmResource[] }; tracks?: { data?: AmResource[] } };
};

export class AppleMusicAdapter implements MusicProviderAdapter {
  readonly provider = "apple" as const;

  constructor(
    private getDeveloperToken: () => Promise<string>,
    private getMusicUserToken: () => Promise<string>,
    private storefront: string
  ) {}

  private async api<T>(path: string, init?: RequestInit & { okStatuses?: number[] }): Promise<T> {
    const [developerToken, mut] = await Promise.all([this.getDeveloperToken(), this.getMusicUserToken()]);
    return providerFetchJson<T>("apple", `${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${developerToken}`,
        "Media-User-Token": mut,
        ...(init?.headers ?? {}),
      },
    });
  }

  async listPlaylists(): Promise<ProviderPlaylist[]> {
    const out: ProviderPlaylist[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.api<{ data: AmResource[] }>(
        `/v1/me/library/playlists?limit=100&offset=${offset}`
      );
      for (const p of page.data ?? []) {
        out.push({
          providerPlaylistId: p.id,
          name: p.attributes?.name ?? "Untitled",
          externalUrl: p.attributes?.url ?? null,
          editable: p.attributes?.canEdit ?? true,
          ownerExternalId: null,
          providerRevision: null,
          trackCount: p.attributes?.trackCount ?? 0,
        });
      }
      if ((page.data ?? []).length < 100 || out.length > 10_000) break;
      offset += 100;
    }
    return out;
  }

  async getPlaylistItems(playlistId: string): Promise<ProviderTrack[]> {
    const out: ProviderTrack[] = [];
    let offset = 0;
    for (;;) {
      const url = `/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks?limit=100&offset=${offset}&include=catalog`;
      const res = await this.raw(url);
      if (res.status === 404) {
        const body = (await res.json().catch(() => null)) as { errors?: { code?: string }[] } | null;
        // Apple 404s (code 40403, "No related resources") the tracks
        // relationship of an EMPTY library playlist instead of returning [].
        // A genuinely deleted playlist 404s with a different code.
        if (body?.errors?.[0]?.code === "40403") return out;
        const err = new Error(`[apple] GET ${url} -> 404 playlist missing`);
        (err as Error & { status?: number }).status = 404;
        throw err;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const err = new Error(`[apple] GET ${url} -> ${res.status} ${text.slice(0, 300)}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      const page = (await res.json()) as { data: AmResource[] };
      for (const item of page.data ?? []) {
        // `include=catalog` materializes catalog attributes in relationships when available
        const catalog = item.relationships?.catalog?.data?.[0];
        const attrs = catalog?.attributes ?? item.attributes ?? {};
        const title = attrs.name ?? item.attributes?.name;
        if (!title) continue;
        out.push({
          providerTrackId: catalog?.id ?? item.id,
          providerUri: null,
          isrc: normalizeIsrc(attrs.isrc),
          title,
          artist: attrs.artistName ?? item.attributes?.artistName ?? "",
          albumTitle: attrs.albumName ?? null,
          durationMs: attrs.durationInMillis ?? item.attributes?.durationInMillis ?? null,
          explicit: attrs.contentRating === "explicit",
          isLocal: false,
          inCatalog: Boolean(catalog?.id),
        });
      }
      if ((page.data ?? []).length < 100 || out.length > 10_000) break;
      offset += 100;
    }
    return out;
  }

  /** Authenticated raw request — lets callers inspect status codes directly. */
  private async raw(path: string): Promise<Response> {
    const [developerToken, mut] = await Promise.all([this.getDeveloperToken(), this.getMusicUserToken()]);
    return providerFetch("apple", `${API}${path}`, {
      headers: {
        Authorization: `Bearer ${developerToken}`,
        "Media-User-Token": mut,
      },
    });
  }

  async createPlaylist(input: CreatePlaylistInput): Promise<ProviderPlaylist> {
    const body = {
      attributes: { name: input.name, description: input.description ?? "" },
      relationships: { tracks: { data: [] } },
    };
    let created: AmResource;
    try {
      const res = await this.api<{ data: AmResource[] }>("/v1/me/library/playlists", {
        method: "POST",
        body: JSON.stringify(body),
      });
      created = res.data[0];
    } catch {
      // some accounts reject an empty tracks relationship — retry attributes-only
      const res = await this.api<{ data: AmResource[] }>("/v1/me/library/playlists", {
        method: "POST",
        body: JSON.stringify({ attributes: body.attributes }),
      });
      created = res.data[0];
    }
    return {
      providerPlaylistId: created.id,
      name: created.attributes?.name ?? input.name,
      externalUrl: created.attributes?.url ?? null,
      editable: true,
      ownerExternalId: null,
      providerRevision: null,
      trackCount: 0,
    };
  }

  async addTracks(playlistId: string, trackIds: string[]): Promise<void> {
    for (let i = 0; i < trackIds.length; i += 100) {
      const batch = trackIds.slice(i, i + 100);
      await this.api(`/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks`, {
        method: "POST",
        body: JSON.stringify({ data: batch.map((id) => ({ id, type: "songs" })) }),
      });
    }
  }

  async resolveTrack(canonical: {
    isrc: string | null;
    title: string;
    artist: string;
    durationMs: number | null;
    explicitHint?: boolean;
  }): Promise<TrackResolution> {
    const isrc = normalizeIsrc(canonical.isrc);
    if (isrc) {
      // documented catalog lookup by ISRC
      const res = await this.api<{ data: AmResource[] }>(
        `/v1/catalog/${encodeURIComponent(this.storefront)}/songs?filter[isrc]=${isrc}`
      );
      const song = res.data?.[0];
      if (song?.id) {
        return {
          status: "matched",
          providerTrackId: song.id,
          providerUri: null,
          matchMethod: "isrc",
          confidence: 95,
        };
      }
    }

    const term = `${canonical.title} ${canonical.artist}`.trim();
    if (!term) return { status: "unmatched", reason: "missing title/artist" };
    const search = await this.api<{ results: { songs?: { data: AmResource[] } } }>(
      `/v1/catalog/${encodeURIComponent(this.storefront)}/search?term=${encodeURIComponent(term)}&types=songs&limit=10`
    );
    const candidates = search.results?.songs?.data ?? [];
    const nTitle = normalizeTitle(canonical.title);
    const nArtist = normalizeArtist(canonical.artist);
    const scored = candidates
      .filter((s) => s.attributes?.name)
      .map((s) => {
        let score = 0;
        const a = s.attributes!;
        if (normalizeTitle(a.name ?? "") === nTitle && normalizeArtist(a.artistName ?? "") === nArtist) {
          score = 70;
          if (durationsClose(a.durationInMillis ?? null, canonical.durationMs)) score += 10;
          if ((a.contentRating === "explicit") === (canonical.explicitHint ?? false)) score += 5;
        }
        return { s, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (best && best.score >= 70) {
      return {
        status: "matched",
        providerTrackId: best.s.id,
        providerUri: null,
        matchMethod: "metadata",
        confidence: Math.min(best.score, 95),
      };
    }
    return { status: "unmatched", reason: "no catalog match in storefront" };
  }

  async searchTracks(term: string, limit = 8): Promise<ProviderTrack[]> {
    const t = term.trim();
    if (!t) return [];
    const search = await this.api<{ results: { songs?: { data: AmResource[] } } }>(
      `/v1/catalog/${encodeURIComponent(this.storefront)}/search?term=${encodeURIComponent(t)}&types=songs&limit=${limit}`
    );
    return (search.results?.songs?.data ?? [])
      .filter((s) => s.attributes?.name)
      .map((s) => {
        const a = s.attributes!;
        return {
          providerTrackId: s.id,
          providerUri: null,
          isrc: normalizeIsrc(a.isrc),
          title: a.name ?? "",
          artist: a.artistName ?? "",
          albumTitle: a.albumName ?? null,
          durationMs: a.durationInMillis ?? null,
          explicit: a.contentRating === "explicit",
          isLocal: false,
          inCatalog: true,
        };
      });
  }
}
