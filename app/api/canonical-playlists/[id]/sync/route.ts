import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { canonicalPlaylists } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAdaptersForUser } from "@/lib/providers";
import { syncCanonicalPlaylist } from "@/lib/sync/engine";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const owned = (
    await (await getDb())
      .select({ id: canonicalPlaylists.id })
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.id, id), eq(canonicalPlaylists.userId, user.id)))
      .limit(1)
  )[0];
  if (!owned) return NextResponse.json({ error: "not found" }, { status: 404 });

  const adapters = await getAdaptersForUser(user.id);
  const outcome = await syncCanonicalPlaylist(user.id, id, "manual", adapters);
  return NextResponse.json(outcome);
}
