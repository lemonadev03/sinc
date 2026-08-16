import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getAdaptersForUser } from "@/lib/providers";
import { refreshProviderPlaylists } from "@/lib/sync/groups";

export async function POST() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const adapters = await getAdaptersForUser(user.id);
  const counts: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const [provider, adapter] of Object.entries(adapters)) {
    if (!adapter) continue;
    try {
      counts[provider] = await refreshProviderPlaylists(user.id, provider as "spotify" | "apple", adapter);
    } catch (err) {
      errors[provider] = (err as Error).message;
    }
  }
  return NextResponse.json({ ok: Object.keys(errors).length === 0, counts, errors });
}
