"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { canonicalPlaylists, musicConnections, playlistLinks, providerPlaylists } from "@/db/schema";
import { deleteUser, requireUser, signIn, signUp, destroySession } from "@/lib/auth";
import { getAdaptersForUser } from "@/lib/providers";
import { createSyncGroup, createSyncGroupWithMirror, refreshProviderPlaylists } from "@/lib/sync/groups";
import { syncCanonicalPlaylist } from "@/lib/sync/engine";

export type ActionState = { error?: string; ok?: boolean; message?: string };

export async function signupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await signUp(email, password);
  if (!result.ok) return { error: result.error };
  redirect("/onboarding");
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await signIn(email, password);
  if (!result.ok) return { error: result.error };
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

export async function refreshPlaylistsAction(): Promise<void> {
  const user = await requireUser();
  const adapters = await getAdaptersForUser(user.id);
  for (const [provider, adapter] of Object.entries(adapters)) {
    if (adapter) await refreshProviderPlaylists(user.id, provider as "spotify" | "apple", adapter);
  }
  revalidatePath("/playlists");
  revalidatePath("/onboarding");
}

export async function createGroupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const mode = String(formData.get("mode") ?? "pair");
  const rowIds = String(formData.get("rowIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let result;
  if (mode === "mirror") {
    result = await createSyncGroupWithMirror(user.id, rowIds[0]);
  } else {
    result = await createSyncGroup(user.id, { providerPlaylistRowIds: rowIds });
  }
  if (!result.ok) return { error: result.error };
  revalidatePath("/dashboard");
  revalidatePath("/playlists");
  redirect(`/playlists/${result.canonicalPlaylistId}`);
}

export async function syncNowAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("canonicalPlaylistId") ?? "");
  // user-scoped: only sync own canonical playlists
  const owned = (
    await (await getDb())
      .select({ id: canonicalPlaylists.id })
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.id, id), eq(canonicalPlaylists.userId, user.id)))
      .limit(1)
  )[0];
  if (!owned) return;
  const adapters = await getAdaptersForUser(user.id);
  await syncCanonicalPlaylist(user.id, id, "manual", adapters);
  revalidatePath(`/playlists/${id}`);
  revalidatePath("/dashboard");
}

export async function toggleSyncAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("canonicalPlaylistId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  await (await getDb())
    .update(canonicalPlaylists)
    .set({ syncEnabled: enabled })
    .where(and(eq(canonicalPlaylists.id, id), eq(canonicalPlaylists.userId, user.id)));
  revalidatePath(`/playlists/${id}`);
  revalidatePath("/dashboard");
}

export async function disconnectProviderAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const provider = String(formData.get("provider") ?? "");
  if (provider !== "spotify" && provider !== "apple") return;
  const db = await getDb();
  await db
    .delete(musicConnections)
    .where(and(eq(musicConnections.userId, user.id), eq(musicConnections.provider, provider)));
  // stop syncs that relied on this provider: disable canonical playlists now missing an adapter side
  const links = await db
    .select({ canonicalPlaylistId: playlistLinks.canonicalPlaylistId, provider: providerPlaylists.provider })
    .from(playlistLinks)
    .innerJoin(providerPlaylists, eq(providerPlaylists.id, playlistLinks.providerPlaylistId))
    .where(eq(providerPlaylists.provider, provider));
  const affected = links.map((l) => l.canonicalPlaylistId);
  for (const canonicalId of affected) {
    await db
      .update(canonicalPlaylists)
      .set({ syncEnabled: false })
      .where(and(eq(canonicalPlaylists.id, canonicalId), eq(canonicalPlaylists.userId, user.id)));
  }
  revalidatePath("/settings/connections");
  revalidatePath("/dashboard");
}

export async function deleteAccountAction(): Promise<void> {
  const user = await requireUser();
  // cascades: sessions, connections (tokens), playlists, links, canonical data, runs
  await deleteUser(user.id);
  redirect("/");
}
