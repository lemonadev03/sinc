# playlist-sync

Spotify ⇄ Apple Music playlist synchronization with an internal **canonical playlist** as the
source of truth. Built for [STA-2151](https://linear.app/bscale-labs/issue/STA-2151).

A user signs up, connects both providers, and picks which playlists to sync (opt-in — indexing is
not mirroring). Every sync group maps to a `CanonicalPlaylist` in our DB that owns logical track
membership and insertion order; external Spotify/Apple playlists are mirrors linked through
`PlaylistLink` records. Sync is **additive-only two-way**: a track added on either service appears
on the other within the next 10-minute run. Deletes and reorders never propagate in v1.

## Stack

- Next.js 15 App Router + TypeScript, Tailwind CSS v4
- Postgres + Drizzle ORM (migrations auto-applied on boot, advisory-locked)
- Zero-dependency session auth (scrypt password hashing, hashed session tokens in httpOnly cookies)
- AES-256-GCM encryption for all provider tokens at rest
- Vitest for the sync engine + auth boundary tests (runs against a real Postgres; see `TEST_DATABASE_URL`)

## Getting started

```bash
npm install
cp .env.example .env   # point DATABASE_URL at any Postgres; fill provider creds as you get them
npm run dev
```

Migrations apply automatically on first DB access (advisory-locked, safe for concurrent boots).
Without provider credentials the app still runs — connect buttons show a "not configured" state.

Running tests: point `TEST_DATABASE_URL` at a scratch Postgres (tests create + migrate isolated
databases per case):

```bash
docker run -d --name sinc-test-pg -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=test -p 54331:5432 postgres:16-alpine
npm test
```

### Spotify setup

1. Create an app at <https://developer.spotify.com/dashboard>.
2. Add redirect URI `{APP_URL}/api/auth/spotify/callback`.
3. Set `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`.

Uses the Authorization Code flow with the minimal playlist scopes
(`playlist-read-private playlist-modify-private playlist-modify-public`), automatic token refresh,
and the **current** Web API playlist item routes (`GET /playlists/{id}/items`,
`POST /playlists/{id}/items` — the post-February-2026 routes).

### Apple Music setup

1. Create a MusicKit key at <https://developer.apple.com> (Apple Developer Program required).
2. Set `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the `.p8` PEM contents).
3. Users connect via MusicKit on the Web (`/settings/connections`): the client fetches a developer
   token from `/api/apple/developer-token`, runs `authorize()`, and POSTs the resulting **Music User
   Token** to `/api/apple/connect`, which validates it against `/v1/me/storefront` and stores it
   encrypted with the user's storefront. The MUT is long-lived, so background sync runs without the
   browser being open.

## How sync works

`lib/sync/engine.ts` — for each canonical playlist, guarded by an atomic claim (no overlapping
runs, stale takeover after 15 min):

1. Fetch current items for every linked provider playlist.
2. Ingest external tracks missing from the canonical playlist (dedupe by ISRC, else normalized
   title + primary artist; first-seen order preserved). Local Spotify files and non-catalog tracks
   are recorded as unmatched instead of guessed.
3. For each linked playlist, compute missing canonical tracks (membership checked both by mapped
   provider ID and by identity key, so provider-side ID differences don't duplicate tracks).
4. Resolve missing tracks using existing `TrackMapping` → ISRC → provider catalog ISRC lookup
   (Apple `filter[isrc]`) → normalized metadata + duration + explicitness scoring. Low-confidence
   matches become visible `UnmatchedTrack` rows with retry, never silent wrong adds.
5. Append in batches; record a `SyncRun` with counts and error summary. A provider failure marks
   the run `partial` and never aborts other playlists or users.

The every-10-minute job is `POST /api/cron/sync` (also GET for Vercel Cron, configured in
`vercel.json`), authenticated with `Bearer ${CRON_SECRET}`.

## Spotify AI-policy compliance

No Spotify content (playlist names, track metadata, artwork, API responses) is ever sent to an LLM,
embedding model, or training pipeline. The "assistant-style" onboarding panel is deterministic UI
rendered from our own inventory tables; typed/selection actions resolve in application code only.

## Security

- Provider tokens + Apple MUT encrypted at rest (`ENCRYPTION_KEY`), never logged (log payloads are
  identifiers only; error summaries redact bearer tokens).
- All queries user-scoped; ownership verified before writes (see `tests/ownership.test.ts`).
- OAuth `state` cookie validation; cron Bearer auth; httpOnly SameSite=Lax sessions.
- Disconnect removes credentials and pauses affected syncs; account deletion cascades away
  everything (tokens, inventory, canonical data, history).

## Scripts

```bash
npm run dev         # dev server
npm run build       # production build
npm run test        # vitest suite (25 tests)
npm run typecheck   # tsc --noEmit
npm run db:generate # regenerate migrations after schema changes
```

## Deployment notes

- **Railway** (primary target): add a Postgres service, set `DATABASE_URL` from it, set
  `APP_URL`/`ENCRYPTION_KEY`/`CRON_SECRET` (+ provider creds), deploy from the repo. For the
  every-10-minute job, schedule a request to `POST /api/cron/sync` with `Authorization: Bearer
  ${CRON_SECRET}` (Railway scheduled jobs / GitHub Actions schedule both work).
- Set `CRON_SECRET` in production; the cron endpoint refuses to run without it.
- Verify Apple Media User Token retention against current MusicKit behavior before launch — if
  Apple changes MUT reusability, surface it as a blocker rather than shipping silent failures.
