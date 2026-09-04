"use client";

import { useMemo, useState } from "react";
import { createGroupAction, refreshPlaylistsAction } from "@/app/actions";
import { ProviderToken } from "./ui";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { SelectableCard } from "@astryxdesign/core/SelectableCard";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

export type PlaylistCardData = {
  rowId: string;
  provider: "spotify" | "apple";
  name: string;
  trackCount: number;
  editable: boolean;
  linked: boolean;
};

export function OnboardingPanel({ playlists, bothConnected }: { playlists: PlaylistCardData[]; bothConnected: boolean }) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spotify = useMemo(() => playlists.filter((p) => p.provider === "spotify"), [playlists]);
  const apple = useMemo(() => playlists.filter((p) => p.provider === "apple"), [playlists]);
  const selectedList = playlists.filter((p) => selected[p.rowId]);
  const selectedSpotify = selectedList.filter((p) => p.provider === "spotify");
  const selectedApple = selectedList.filter((p) => p.provider === "apple");

  function toggle(id: string, value: boolean) {
    setError(null);
    setSelected((prev) => ({ ...prev, [id]: value }));
  }

  async function submit() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("rowIds", selectedList.map((p) => p.rowId).join(","));
    fd.set("mode", selectedList.length === 1 ? "mirror" : "pair");
    const result = await createGroupAction({}, fd);
    setPending(false);
    if (result && typeof result === "object" && "error" in result && result.error) {
      setError(result.error);
    }
  }

  const validMirror = selectedList.length === 1 && bothConnected;
  const validPair = selectedSpotify.length === 1 && selectedApple.length === 1;
  const tooMany = selectedList.length > 2;
  const canSubmit = !pending && !tooMany && (validMirror || validPair);

  return (
    <VStack gap={5}>
      <Text color="secondary">
        One playlist mirrors to the other service. One from each links them together.
      </Text>

      {!bothConnected && (
        <Banner
          status="warning"
          title="Connect both services to mirror"
          description="Linking an existing pair works with the two services involved."
        />
      )}

      {spotify.length > 0 && (
        <VStack gap={3}>
          <Heading level={2}>Spotify · {spotify.length}</Heading>
          <Grid columns={{ minWidth: 240 }} gap={2}>
            {spotify.map((p) => (
              <PlaylistCard key={p.rowId} p={p} selected={!!selected[p.rowId]} onToggle={toggle} />
            ))}
          </Grid>
        </VStack>
      )}

      {apple.length > 0 && (
        <VStack gap={3}>
          <Heading level={2}>Apple Music · {apple.length}</Heading>
          <Grid columns={{ minWidth: 240 }} gap={2}>
            {apple.map((p) => (
              <PlaylistCard key={p.rowId} p={p} selected={!!selected[p.rowId]} onToggle={toggle} />
            ))}
          </Grid>
        </VStack>
      )}

      {error && <Banner status="error" title="Could not create the sync" description={error} />}

      <HStack hAlign="between" vAlign="center" wrap="wrap">
        <Text color="secondary">
          {selectedList.length === 0 && "Select up to two playlists"}
          {selectedList.length === 1 && `Mirror ${selectedList[0].name}`}
          {selectedSpotify.length === 1 && selectedApple.length === 1 && `Link ${selectedSpotify[0].name} and ${selectedApple[0].name}`}
          {tooMany && "Select at most two — one per service"}
        </Text>
        <HStack gap={2}>
          <Button label="Refresh" variant="ghost" onClick={() => void refreshPlaylistsAction()} />
          <Button label={pending ? "Creating" : "Create sync"} variant="primary" isLoading={pending} isDisabled={!canSubmit} onClick={() => void submit()} />
        </HStack>
      </HStack>
    </VStack>
  );
}

function PlaylistCard({ p, selected, onToggle }: { p: PlaylistCardData; selected: boolean; onToggle: (id: string, value: boolean) => void }) {
  return (
    <SelectableCard label={p.name} isSelected={selected} onChange={(v) => onToggle(p.rowId, v)} isDisabled={p.linked}>
      <VStack gap={2}>
        <HStack hAlign="between" vAlign="center">
          <ProviderToken provider={p.provider} />
          {p.linked ? (
            <Text type="supporting" color="secondary">
              Syncing
            </Text>
          ) : !p.editable ? (
            <Text type="supporting" color="secondary">
              Read-only
            </Text>
          ) : null}
        </HStack>
        <VStack gap={1}>
          <Text weight="medium">{p.name}</Text>
          <Text type="supporting" color="secondary">
            {p.provider === "apple" && p.trackCount === 0 ? "Count loads on first sync" : `${p.trackCount} tracks`}
          </Text>
        </VStack>
      </VStack>
    </SelectableCard>
  );
}
