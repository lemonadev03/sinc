export const metadata = { title: "Privacy — playlist-sync" };

export default function PrivacyPage() {
  return (
    <article className="flex max-w-2xl flex-col gap-4 text-sm leading-relaxed text-zinc-400">
      <h1 className="text-2xl font-bold text-zinc-100">Privacy</h1>
      <p>
        This app synchronizes playlists you explicitly opt in to syncing between your Spotify and Apple
        Music accounts. To do that, it accesses and stores:
      </p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Your account email and a password hash (scrypt) for app sign-in.</li>
        <li>
          Provider authorization tokens (Spotify access/refresh tokens, Apple Music user token), which
          are encrypted at rest and never written to logs.
        </li>
        <li>
          Playlist metadata (names, track titles, artists, durations, ISRCs, provider IDs) needed to
          match and transfer tracks — for playlists you connect and sync only.
        </li>
      </ul>
      <p>
        We do not store audio, audio previews, or provider artwork. Provider content is never sent to
        any AI/ML model, LLM, or embedding pipeline — playlist selection and matching are deterministic
        application code. When Spotify metadata is displayed, it links back to Spotify.
      </p>
      <p>
        Disconnecting a provider deletes its stored credentials and pauses its syncs. Deleting your
        account deletes your credentials, inventory, canonical playlists, mappings, and sync history.
      </p>
      <p>
        Sync runs automatically roughly every 10 minutes for enabled playlists, and may also be
        triggered manually. Provider terms of service (Spotify Developer Policy, Apple Music API terms)
        apply to all use of provider content.
      </p>
    </article>
  );
}
