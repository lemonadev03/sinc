import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createSyncGroup, createSyncGroupWithMirror } from "@/lib/sync/groups";
import { getDb } from "@/db";
import { canonicalPlaylists } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const rows = await (await getDb())
    .select({
      id: canonicalPlaylists.id,
      name: canonicalPlaylists.name,
      syncEnabled: canonicalPlaylists.syncEnabled,
      lastSyncStatus: canonicalPlaylists.lastSyncStatus,
      lastSyncCompletedAt: canonicalPlaylists.lastSyncCompletedAt,
    })
    .from(canonicalPlaylists)
    .where(eq(canonicalPlaylists.userId, user.id));
  return NextResponse.json({ canonicalPlaylists: rows });
}

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { providerPlaylistIds?: string[]; createMirror?: boolean; name?: string }
    | null;
  const ids = body?.providerPlaylistIds ?? [];
  if (ids.length === 0) return NextResponse.json({ error: "providerPlaylistIds required" }, { status: 400 });

  const result =
    body?.createMirror && ids.length === 1
      ? await createSyncGroupWithMirror(user.id, ids[0])
      : await createSyncGroup(user.id, { providerPlaylistRowIds: ids, name: body?.name });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, canonicalPlaylistId: result.canonicalPlaylistId });
}
