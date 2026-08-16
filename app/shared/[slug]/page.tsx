import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { canonicalPlaylistTracks, canonicalTracks } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getShareBySlug } from "@/lib/sharing";
import { importSharedAction } from "@/app/actions";
import { ProviderBadge } from "@/components/ui";

export default async function SharedPlaylistPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;
  const share = await getShareBySlug(slug);
  if (!share || share.revokedAt) notFound();

  const viewer = await getSessionUser();
  const isOwner = viewer?.id === share.ownerId;

  const tracks = await (await getDb())
    .select({
      position: canonicalPlaylistTracks.position,
      title: canonicalTracks.displayTitle,
      artist: canonicalTracks.displayArtist,
      isrc: canonicalTracks.isrc,
    })
    .from(canonicalPlaylistTracks)
    .innerJoin(canonicalTracks, eq(canonicalTracks.id, canonicalPlaylistTracks.canonicalTrackId))
    .where(eq(canonicalPlaylistTracks.canonicalPlaylistId, share.canonicalId))
    .orderBy(canonicalPlaylistTracks.position);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="card flex flex-col gap-2 border-violet-900/50 bg-gradient-to-br from-violet-950/30 to-zinc-900/60">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{share.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            shared by <span className="text-zinc-300">{share.ownerEmail}</span> · {tracks.length} tracks
          </p>
          <p className="mt-1 text-xs text-zinc-600">this playlist is created and managed by sinc</p>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {viewer && !isOwner ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <form action={importSharedAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="follow" value="true" />
              <button type="submit" className="btn-primary">
                ★ Follow
              </button>
            </form>
            <form action={importSharedAction}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="follow" value="false" />
              <button type="submit" className="btn-secondary">
                ⤓ Import once
              </button>
            </form>
          </div>
        ) : isOwner ? (
          <p className="mt-2 text-sm text-violet-300">this is your share link ✓</p>
        ) : (
          <p className="mt-2 text-sm text-zinc-400">
            <Link href="/signup" className="text-violet-400 underline">
              create an account
            </Link>{" "}
            to follow or import this playlist
          </p>
        )}
      </div>

      <div className="card divide-y divide-zinc-800/70 p-0">
        {tracks.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">No tracks yet.</p>}
        {tracks.map((t) => (
          <div key={t.position} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-200">
                <span className="mr-2 text-xs text-zinc-600">{t.position}</span>
                {t.title}
              </p>
              <p className="truncate text-xs text-zinc-500">{t.artist}</p>
            </div>
            <span className="shrink-0 text-[11px] text-zinc-600">{t.isrc ?? ""}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-zinc-600">
        Following keeps your copy updated when the owner adds songs (additive-only). Import makes a
        one-time copy. Either way, tracks land in your own Spotify/Apple mirrors when you create them.
      </p>
      <p className="text-xs text-zinc-600">
        <ProviderBadge provider="spotify" /> + <ProviderBadge provider="apple" /> synced by sinc
      </p>
    </div>
  );
}
