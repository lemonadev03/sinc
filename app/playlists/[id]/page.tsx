import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  canonicalPlaylistTracks,
  canonicalPlaylists,
  canonicalTracks,
  playlistLinks,
  providerPlaylists,
  syncRuns,
  trackMappings,
  unmatchedTracks,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ProviderToken, SyncStatus, Ago } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { SuggestBox } from "@/components/SuggestBox";
import {
  syncNowAction,
  toggleSyncAction,
  shareAction,
  detachFollowAction,
  suggestionDecisionAction,
  createMirrorAction,
} from "@/app/actions";
import { getFollowForOwnCanonical, listSuggestions } from "@/lib/sharing";
import { getAppUrl } from "@/lib/config";
import { musicConnections, playlistShares } from "@/db/schema";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List } from "@astryxdesign/core/List";
import { ListItem } from "@astryxdesign/core/List";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Table, proportional, pixel } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { VStack } from "@astryxdesign/core/VStack";

interface RunRow extends Record<string, unknown> {
  id: string;
  status: string;
  startedAt: Date;
  trigger: string;
  ingested: number;
  spotify: number;
  apple: number;
  unmatched: number;
  error: string | null;
}

export default async function CanonicalPlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;

  const db = await getDb();
  const canonical = (
    await db
      .select()
      .from(canonicalPlaylists)
      .where(and(eq(canonicalPlaylists.id, id), eq(canonicalPlaylists.userId, user.id)))
      .limit(1)
  )[0];
  if (!canonical) notFound();

  const links = await db
    .select({
      provider: providerPlaylists.provider,
      name: providerPlaylists.name,
      externalUrl: providerPlaylists.externalUrl,
      providerPlaylistId: providerPlaylists.providerPlaylistId,
      editable: providerPlaylists.editable,
      archivedAt: providerPlaylists.archivedAt,
    })
    .from(playlistLinks)
    .innerJoin(providerPlaylists, eq(providerPlaylists.id, playlistLinks.providerPlaylistId))
    .where(eq(playlistLinks.canonicalPlaylistId, id));

  const trackRows = await db
    .select({
      canonicalTrackId: canonicalPlaylistTracks.canonicalTrackId,
      position: canonicalPlaylistTracks.position,
      firstSeenProvider: canonicalPlaylistTracks.firstSeenProvider,
      title: canonicalTracks.displayTitle,
      artist: canonicalTracks.displayArtist,
      isrc: canonicalTracks.isrc,
      dedupeKey: canonicalTracks.dedupeKey,
    })
    .from(canonicalPlaylistTracks)
    .innerJoin(canonicalTracks, eq(canonicalTracks.id, canonicalPlaylistTracks.canonicalTrackId))
    .where(eq(canonicalPlaylistTracks.canonicalPlaylistId, id))
    .orderBy(canonicalPlaylistTracks.position);

  const mappings = trackRows.length
    ? await db
        .select()
        .from(trackMappings)
        .where(inArray(trackMappings.canonicalTrackId, trackRows.map((t) => t.canonicalTrackId)))
    : [];
  const mappingMap = new Map<string, { spotify?: string; apple?: string }>();
  for (const m of mappings) {
    const entry = mappingMap.get(m.canonicalTrackId) ?? {};
    entry[m.provider as "spotify" | "apple"] = m.matchMethod;
    mappingMap.set(m.canonicalTrackId, entry);
  }

  const runs = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.canonicalPlaylistId, id))
    .orderBy(desc(syncRuns.startedAt))
    .limit(10);

  const runRows: RunRow[] = runs.map((r) => ({
    id: r.id,
    status: r.status,
    startedAt: r.startedAt,
    trigger: r.trigger,
    ingested: r.ingestedCount,
    spotify: r.spotifyAddedCount,
    apple: r.appleAddedCount,
    unmatched: r.unmatchedCount,
    error: r.errorSummary,
  }));

  const unmatched = await db
    .select({
      id: unmatchedTracks.id,
      sourceProvider: unmatchedTracks.sourceProvider,
      reason: unmatchedTracks.reason,
      canonicalTrackId: unmatchedTracks.canonicalTrackId,
      displayLabel: unmatchedTracks.displayLabel,
      title: canonicalTracks.displayTitle,
      artist: canonicalTracks.displayArtist,
    })
    .from(unmatchedTracks)
    .leftJoin(canonicalTracks, eq(canonicalTracks.id, unmatchedTracks.canonicalTrackId))
    .where(and(eq(unmatchedTracks.canonicalPlaylistId, id), eq(unmatchedTracks.status, "open")))
    .orderBy(desc(unmatchedTracks.lastAttemptAt));

  // sharing state
  const follow = await getFollowForOwnCanonical(user.id, id);
  const suggestions = await listSuggestions(user.id, id);
  const share = (
    await db.select().from(playlistShares).where(eq(playlistShares.canonicalPlaylistId, id)).limit(1)
  )[0];
  const connections = await db
    .select({ provider: musicConnections.provider })
    .from(musicConnections)
    .where(eq(musicConnections.userId, user.id));
  const connectedProviders = new Set(connections.map((c) => c.provider));
  const linkedProviders = new Set(links.map((l) => l.provider));
  const pendingSuggestions = (suggestions ?? []).filter((s) => s.status === "pending");
  const lastFailed = runs.find((r) => r.status === "error" || r.status === "partial");

  return (
    <VStack gap={6}>
      <HStack hAlign="between" vAlign="start" wrap="wrap">
        <VStack gap={1}>
          <HStack gap={3} vAlign="center" wrap="wrap">
            <Heading level={1}>{canonical.name}</Heading>
            <SyncStatus status={canonical.lastSyncStatus} />
          </HStack>
          <Text color="secondary">
            {trackRows.length} {trackRows.length === 1 ? "track" : "tracks"} ·{" "}
            {canonical.syncEnabled ? "On" : "Paused"} · <Ago date={canonical.lastSyncCompletedAt} />
          </Text>
        </VStack>
        <HStack gap={2}>
          <form action={syncNowAction}>
            <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
            <SubmitButton label="Sync now" pendingLabel="Syncing" variant="primary" />
          </form>
          <form action={toggleSyncAction}>
            <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
            <input type="hidden" name="enabled" value={canonical.syncEnabled ? "false" : "true"} />
            <SubmitButton label={canonical.syncEnabled ? "Pause" : "Resume"} pendingLabel="Saving" />
          </form>
        </HStack>
      </HStack>

      {canonical.lastSyncStatus === "error" && lastFailed?.errorSummary && (
        <Banner
          status="error"
          title="Last sync failed"
          description={`${lastFailed.errorSummary} · ${lastFailed.trigger} run`}
        />
      )}

      <List hasDividers>
        {links.map((l) => (
          <ListItem
            key={l.providerPlaylistId}
            label={l.name}
            description={!l.editable ? "Read-only" : undefined}
            startContent={<ProviderToken provider={l.provider} />}
            endContent={
              l.externalUrl ? (
                <Button label="Open" variant="ghost" size="sm" href={l.externalUrl} target="_blank" rel="noreferrer" />
              ) : undefined
            }
          />
        ))}
        {(["spotify", "apple"] as const)
          .filter((p) => !linkedProviders.has(p) && connectedProviders.has(p))
          .map((p) => (
            <ListItem
              key={p}
              label={p === "spotify" ? "Spotify" : "Apple Music"}
              description="No copy yet"
              startContent={<ProviderToken provider={p} />}
              endContent={
                <form action={createMirrorAction}>
                  <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
                  <input type="hidden" name="provider" value={p} />
                  <SubmitButton label="Create mirror" pendingLabel="Creating" size="sm" />
                </form>
              }
            />
          ))}
      </List>

      {follow && (
        <Card>
          <HStack hAlign="between" vAlign="center">
            <VStack gap={1}>
              <Text weight="medium">
                {follow.detachedAt ? "Detached from " : "Following "}
                {follow.ownerEmail}
              </Text>
              <Text type="supporting" color="secondary">
                {follow.detachedAt
                  ? "This copy is independent now."
                  : "New songs from the owner arrive on each sync."}
              </Text>
            </VStack>
            {!follow.detachedAt && (
              <form action={detachFollowAction}>
                <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
                <SubmitButton label="Detach" pendingLabel="Detaching" />
              </form>
            )}
          </HStack>
        </Card>
      )}

      {follow && !follow.detachedAt && (
        <VStack gap={3}>
          <Heading level={2}>Suggest a song</Heading>
          <SuggestBox canonicalPlaylistId={canonical.id} />
        </VStack>
      )}

      {pendingSuggestions.length > 0 && (
        <VStack gap={3}>
          <Heading level={2}>Suggestions · {pendingSuggestions.length}</Heading>
          <List hasDividers>
            {pendingSuggestions.map((s) => (
              <ListItem
                key={s.id}
                label={`${s.title} — ${s.artist}`}
                description={`Suggested by ${s.suggesterEmail}`}
                endContent={
                  <HStack gap={2}>
                    <form action={suggestionDecisionAction}>
                      <input type="hidden" name="suggestionId" value={s.id} />
                      <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
                      <input type="hidden" name="decision" value="accept" />
                      <SubmitButton label="Accept" pendingLabel="Adding" variant="primary" size="sm" />
                    </form>
                    <form action={suggestionDecisionAction}>
                      <input type="hidden" name="suggestionId" value={s.id} />
                      <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
                      <input type="hidden" name="decision" value="dismiss" />
                      <SubmitButton label="Dismiss" pendingLabel="Saving" variant="ghost" size="sm" />
                    </form>
                  </HStack>
                }
              />
            ))}
          </List>
        </VStack>
      )}

      {unmatched.length > 0 && (
        <VStack gap={3}>
          <VStack gap={1}>
            <Heading level={2}>Unmatched · {unmatched.length}</Heading>
            <Text type="supporting" color="secondary">
              Not found on the other service. Kept in place, retried automatically.
            </Text>
          </VStack>
          <List hasDividers>
            {unmatched.map((u) => {
              const label = u.title ? `${u.title} — ${u.artist}` : (u.displayLabel ?? "Unknown track");
              return (
                <ListItem
                  key={u.id}
                  label={label}
                  description={friendlyReason(u.reason)}
                  startContent={<ProviderToken provider={u.sourceProvider} />}
                  endContent={
                    <form action={syncNowAction}>
                      <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
                      <SubmitButton label="Retry" pendingLabel="Retrying" size="sm" />
                    </form>
                  }
                />
              );
            })}
          </List>
        </VStack>
      )}

      <Card>
        <HStack hAlign="between" vAlign="center" wrap="wrap">
          <VStack gap={1}>
            <Heading level={3}>Share</Heading>
            {share && !share.revokedAt ? (
              <Text type="code" color="secondary">
                {getAppUrl()}/shared/{share.slug}
              </Text>
            ) : (
              <Text type="supporting" color="secondary">
                Others can follow this playlist or copy it once.
              </Text>
            )}
          </VStack>
          {share && !share.revokedAt ? (
            <form action={shareAction}>
              <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
              <input type="hidden" name="revoke" value="true" />
              <SubmitButton label="Stop sharing" pendingLabel="Saving" variant="ghost" />
            </form>
          ) : (
            <form action={shareAction}>
              <input type="hidden" name="canonicalPlaylistId" value={canonical.id} />
              <SubmitButton label="Create link" pendingLabel="Creating" />
            </form>
          )}
        </HStack>
      </Card>

      <VStack gap={3}>
        <Heading level={2}>Tracks · {trackRows.length}</Heading>
        {trackRows.length === 0 ? (
          <Text color="secondary">No tracks yet — they appear after the first sync.</Text>
        ) : (
        <List hasDividers>
          {trackRows.map((t) => {
            const m = mappingMap.get(t.canonicalTrackId) ?? {};
            return (
              <ListItem
                key={t.canonicalTrackId}
                label={t.title}
                description={t.artist}
                startContent={
                  <Text type="supporting" color="secondary">
                    {t.position}
                  </Text>
                }
                endContent={
                  <HStack gap={3}>
                    <HStack gap={1}>
                      <StatusDot variant={m.spotify ? "success" : "neutral"} label={m.spotify ? "On Spotify" : "Missing on Spotify"} />
                      <Text type="supporting" color="secondary">
                        Spotify
                      </Text>
                    </HStack>
                    <HStack gap={1}>
                      <StatusDot variant={m.apple ? "success" : "neutral"} label={m.apple ? "On Apple Music" : "Missing on Apple Music"} />
                      <Text type="supporting" color="secondary">
                        Apple
                      </Text>
                    </HStack>
                  </HStack>
                }
              />
            );
          })}
        </List>
        )}
      </VStack>

      <VStack gap={3}>
        <Heading level={2}>Activity</Heading>
        {runRows.length === 0 ? (
          <Text color="secondary">No runs yet.</Text>
        ) : (
          <Table
            data={runRows}
            idKey="id"
            density="compact"
            columns={[
              {
                key: "status",
                header: "Status",
                width: pixel(110),
                renderCell: (r) => (
                  <HStack gap={1} vAlign="center">
                    <StatusDot
                      variant={r.status === "success" ? "success" : r.status === "running" ? "warning" : r.status === "partial" ? "warning" : "error"}
                      label={String(r.status)}
                    />
                    <Text type="supporting">{String(r.status)}</Text>
                  </HStack>
                ),
              },
              {
                key: "startedAt",
                header: "When",
                width: pixel(130),
                renderCell: (r) => <Timestamp value={(r.startedAt as Date).toISOString()} format="relative" />,
              },
              { key: "trigger", header: "Trigger", width: pixel(90) },
              {
                key: "added",
                header: "Added",
                width: proportional(1),
                renderCell: (r) => (
                  <Text type="supporting">
                    +{Number(r.ingested)} in · +{Number(r.spotify)} Spotify · +{Number(r.apple)} Apple ·{" "}
                    {Number(r.unmatched)} unmatched
                  </Text>
                ),
              },
              {
                key: "error",
                header: "Error",
                width: proportional(1),
                renderCell: (r) =>
                  r.error ? <Text type="supporting">{String(r.error)}</Text> : <Text type="supporting">—</Text>,
              },
            ]}
          />
        )}
      </VStack>
    </VStack>
  );
}

function friendlyReason(raw: string): string {
  if (raw.startsWith("local file")) return "Local file — only on the original device";
  if (raw.includes("no match on apple")) return "Not found on Apple Music";
  if (raw.includes("no match on spotify")) return "Not found on Spotify";
  if (raw.includes("no confident metadata match")) return "No confident match";
  if (raw.includes("missing title/artist")) return "Missing title or artist";
  return raw.replace(/\[\w+\]\s*/g, "");
}
