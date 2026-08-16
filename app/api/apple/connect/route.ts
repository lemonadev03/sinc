import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { musicConnections } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { requireUser } from "@/lib/auth";
import { validateAppleConnection } from "@/lib/providers";
import { refreshProviderPlaylists } from "@/lib/sync/groups";
import { getAppleAdapter } from "@/lib/providers";
import { log } from "@/lib/log";

/**
 * Receives the Music User Token obtained via MusicKit on the Web and stores it
 * (encrypted) so background sync can run without the browser being open.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { musicUserToken?: string } | null;
  const musicUserToken = body?.musicUserToken?.trim();
  if (!musicUserToken || musicUserToken.length < 20) {
    return NextResponse.json({ error: "musicUserToken missing or malformed" }, { status: 400 });
  }

  let storefront: string;
  try {
    ({ storefront } = await validateAppleConnection(user.id, musicUserToken));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  const db = await getDb();
  const existing = (
    await db
      .select()
      .from(musicConnections)
      .where(and(eq(musicConnections.userId, user.id), eq(musicConnections.provider, "apple")))
      .limit(1)
  )[0];

  const values = {
    musicUserTokenEncrypted: encryptSecret(musicUserToken),
    storefront,
    needsReconnect: false,
    lastValidatedAt: new Date(),
  };
  if (existing) {
    await db.update(musicConnections).set(values).where(eq(musicConnections.id, existing.id));
  } else {
    await db.insert(musicConnections).values({
      id: crypto.randomUUID(),
      userId: user.id,
      provider: "apple",
      connectedAt: new Date(),
      ...values,
    });
  }

  // index playlists right away
  try {
    const adapter = await getAppleAdapter(user.id);
    if (adapter) await refreshProviderPlaylists(user.id, "apple", adapter);
  } catch (err) {
    log.warn("initial apple playlist index failed", { err: (err as Error).message });
  }

  return NextResponse.json({ ok: true, storefront });
}
