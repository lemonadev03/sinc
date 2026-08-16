import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex flex-col items-center gap-10 py-16 text-center">
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl">
        Your playlists,{" "}
        <span className="bg-gradient-to-r from-[#1DB954] to-[#FA2D48] bg-clip-text text-transparent">
          everywhere
        </span>
      </h1>
      <p className="max-w-xl text-lg text-zinc-400">
        Connect Spotify and Apple Music, pick the playlists you want kept in sync, and playlist-sync
        keeps them aligned — additively, every 10 minutes, with an internal canonical playlist as the
        source of truth.
      </p>
      <div className="flex gap-3">
        <Link href="/signup" className="btn-primary px-6 py-3 text-base">
          Create an account
        </Link>
        <Link href="/login" className="btn-secondary px-6 py-3 text-base">
          Log in
        </Link>
      </div>
      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        {[
          ["Connect", "Link your Spotify and Apple Music accounts — tokens encrypted at rest."],
          ["Pick", "Tell the assistant which playlists to sync. Link existing pairs or create mirrors."],
          ["Sync", "Add a song on either service; it shows up on the other within 10 minutes."],
        ].map(([title, body]) => (
          <div key={title} className="card text-left">
            <p className="mb-1 font-semibold text-zinc-100">{title}</p>
            <p className="text-sm text-zinc-500">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
