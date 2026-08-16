import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAdaptersForUser } from "@/lib/providers";

/** User-scoped catalog search for the suggestion picker. */
export async function GET(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const term = (new URL(req.url).searchParams.get("term") ?? "").trim();
  if (term.length < 2) return NextResponse.json({ results: [] });

  const adapters = await getAdaptersForUser(user.id);
  const results = await Promise.all(
    (Object.entries(adapters) as [("spotify" | "apple"), (typeof adapters)["spotify"]][])
      .filter(([, a]) => a && typeof a.searchTracks === "function")
      .map(async ([provider, adapter]) => {
        try {
          const tracks = await adapter!.searchTracks!(term, 8);
          return tracks.map((t) => ({
            provider,
            providerTrackId: t.providerTrackId,
            isrc: t.isrc,
            title: t.title,
            artist: t.artist,
            durationMs: t.durationMs,
          }));
        } catch {
          return [];
        }
      })
  );
  return NextResponse.json({ results: results.flat() });
}
