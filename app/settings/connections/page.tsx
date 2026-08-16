import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { musicConnections } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { appleConfigured, spotifyConfigured } from "@/lib/config";
import { timeAgo } from "@/components/ui";
import { disconnectProviderAction } from "@/app/actions";
import { AppleConnectButton } from "@/components/AppleConnectButton";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { error } = await searchParams;

  const connections = await (await getDb()).select().from(musicConnections).where(eq(musicConnections.userId, user.id));
  const spotify = connections.find((c) => c.provider === "spotify");
  const apple = connections.find((c) => c.provider === "apple");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Connections</h1>
        <p className="mt-1 text-sm text-zinc-500">
          One Spotify and one Apple Music connection per account. Tokens are encrypted at rest.
        </p>
      </div>

      {error && (
        <div className="card border-red-900/50 bg-red-950/20 text-sm text-red-300">
          {error === "oauth_state" && "OAuth state validation failed — please try connecting again."}
          {error === "spotify_failed" && "Spotify connection failed — please try again."}
          {error === "not_configured" && "This provider isn't configured on the server (missing credentials)."}
        </div>
      )}

      <div className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-zinc-100">Spotify</p>
          <p className="mt-0.5 text-sm text-zinc-500">
            {spotify
              ? `Connected · ${spotify.externalAccountName ?? spotify.externalAccountId ?? ""} · since ${timeAgo(spotify.connectedAt)}`
              : "Not connected"}
          </p>
          <p className="text-xs text-zinc-600">
            {spotify
              ? spotify.needsReconnect
                ? "authorization expired — reconnect required"
                : `last validated ${timeAgo(spotify.lastValidatedAt)}`
              : spotifyConfigured()
                ? "read + modify private playlists"
                : "server missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {spotify ? (
            <>
              <a href="/api/auth/spotify/start" className={spotify.needsReconnect ? "btn-primary" : "btn-secondary"}>
                {spotify.needsReconnect ? "Reconnect Spotify" : "Refresh connection"}
              </a>
              <form action={disconnectProviderAction}>
                <input type="hidden" name="provider" value="spotify" />
                <button type="submit" className="btn-ghost">
                  Disconnect
                </button>
              </form>
            </>
          ) : (
            <a
              href="/api/auth/spotify/start"
              className={spotifyConfigured() ? "btn-primary" : "btn-primary pointer-events-none opacity-50"}
            >
              Connect Spotify
            </a>
          )}
        </div>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-zinc-100">Apple Music</p>
          <p className="mt-0.5 text-sm text-zinc-500">
            {apple
              ? `Connected${apple.storefront ? ` · storefront ${apple.storefront}` : ""} · since ${timeAgo(apple.connectedAt)}`
              : "Not connected"}
          </p>
          <p className="text-xs text-zinc-600">
            {apple
              ? apple.needsReconnect
                ? "authorization invalid — reconnect required"
                : `last validated ${timeAgo(apple.lastValidatedAt)}`
              : appleConfigured()
                ? "MusicKit on the Web · personalized library access"
                : "server missing APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AppleConnectButton disabled={!appleConfigured()} />
          {apple && (
            <form action={disconnectProviderAction}>
              <input type="hidden" name="provider" value="apple" />
              <button type="submit" className="btn-ghost">
                Disconnect
              </button>
            </form>
          )}
        </div>
      </div>

      <p className="text-xs text-zinc-600">
        Disconnecting a provider removes its stored credentials and pauses sync groups that depended on
        it. Account deletion (in{" "}
        <Link href="/settings/account" className="underline">
          account settings
        </Link>
        ) removes everything.
      </p>
    </div>
  );
}
