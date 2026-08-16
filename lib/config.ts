function str(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export function getAppUrl(): string {
  const raw = str("APP_URL") ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ?? "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

export const config = {
  get spotify() {
    return {
      clientId: str("SPOTIFY_CLIENT_ID"),
      clientSecret: str("SPOTIFY_CLIENT_SECRET"),
      redirectUri: `${getAppUrl()}/api/auth/spotify/callback`,
    };
  },
  get apple() {
    return {
      teamId: str("APPLE_TEAM_ID") ?? "",
      keyId: str("APPLE_KEY_ID") ?? "",
      privateKey: str("APPLE_PRIVATE_KEY") ?? "",
    };
  },
  get encryptionKey() {
    return str("ENCRYPTION_KEY") ?? "dev-only-insecure-encryption-key-change-me";
  },
  get cronSecret() {
    return str("CRON_SECRET");
  },
};

export function spotifyConfigured(): boolean {
  return Boolean(config.spotify.clientId && config.spotify.clientSecret);
}

export function appleConfigured(): boolean {
  return Boolean(config.apple.teamId && config.apple.keyId && config.apple.privateKey);
}
