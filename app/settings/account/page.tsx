import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { deleteAccountAction } from "@/app/actions";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Account</h1>
        <p className="mt-1 text-sm text-zinc-500">Signed in as {user.email}</p>
      </div>

      <div className="card">
        <p className="font-semibold text-zinc-100">What syncs</p>
        <p className="mt-1 text-sm text-zinc-500">
          Sync is additive-only in v1: songs you add on either provider appear on the other; removing a
          song never propagates. Canonical playlists in this app are the source of truth.
        </p>
      </div>

      <div className="card border-red-900/40">
        <p className="font-semibold text-red-300">Delete account</p>
        <p className="mt-1 text-sm text-zinc-500">
          Permanently deletes your account, stored provider credentials (tokens), playlist inventory,
          canonical playlists, mappings, and sync history. This cannot be undone.
        </p>
        <form action={deleteAccountAction} className="mt-4">
          <button
            type="submit"
            className="btn border border-red-800 bg-red-950/40 text-red-300 hover:bg-red-950/70"
          >
            Delete my account and all data
          </button>
        </form>
      </div>
    </div>
  );
}
