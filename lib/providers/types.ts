export type Provider = "spotify" | "apple";

export type ProviderPlaylist = {
  providerPlaylistId: string;
  name: string;
  externalUrl: string | null;
  editable: boolean;
  ownerExternalId: string | null;
  providerRevision: string | null;
  trackCount: number;
};

export type ProviderTrack = {
  providerTrackId: string;
  providerUri: string | null;
  isrc: string | null;
  title: string;
  artist: string;
  /** primary artist only */
  albumTitle: string | null;
  durationMs: number | null;
  explicit: boolean;
  isLocal: boolean;
  /** catalog-backed (Apple library tracks may not be) */
  inCatalog: boolean;
};

export type CreatePlaylistInput = {
  name: string;
  description?: string;
};

export type TrackResolution =
  | { status: "matched"; providerTrackId: string; providerUri: string | null; matchMethod: "isrc" | "metadata" | "existing"; confidence: number }
  | { status: "unmatched"; reason: string };

/**
 * Provider-agnostic surface implemented by SpotifyAdapter and AppleMusicAdapter.
 * The sync engine depends only on this interface.
 */
export interface MusicProviderAdapter {
  readonly provider: Provider;
  listPlaylists(): Promise<ProviderPlaylist[]>;
  getPlaylistItems(playlistId: string): Promise<ProviderTrack[]>;
  createPlaylist(input: CreatePlaylistInput): Promise<ProviderPlaylist>;
  addTracks(playlistId: string, trackIds: string[]): Promise<void>;
  resolveTrack(canonical: {
    isrc: string | null;
    title: string;
    artist: string;
    durationMs: number | null;
    explicitHint?: boolean;
  }): Promise<TrackResolution>;
  /** Catalog search for user-facing pickers (suggestions). Optional. */
  searchTracks?(term: string, limit?: number): Promise<ProviderTrack[]>;
}

export class ProviderAuthError extends Error {
  constructor(provider: Provider, message: string) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderAuthError";
  }
}

export class ProviderRateLimitError extends Error {
  constructor(provider: Provider, public retryAfterMs: number) {
    super(`[${provider}] rate limited`);
    this.name = "ProviderRateLimitError";
  }
}
