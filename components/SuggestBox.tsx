"use client";

import { useState } from "react";
import { suggestTrackAction } from "@/app/actions";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { List } from "@astryxdesign/core/List";
import { ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";

type SearchResult = {
  provider: string;
  providerTrackId: string;
  isrc: string | null;
  title: string;
  artist: string;
  durationMs: number | null;
};

export function SuggestBox({ canonicalPlaylistId }: { canonicalPlaylistId: string }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  async function search() {
    if (term.trim().length < 2) return;
    setLoading(true);
    setSent(null);
    try {
      const res = await fetch(`/api/tracks/search?term=${encodeURIComponent(term)}`);
      const json = (await res.json()) as { results: SearchResult[] };
      setResults(json.results ?? []);
    } finally {
      setLoading(false);
    }
  }

  async function suggest(r: SearchResult) {
    const fd = new FormData();
    fd.set("canonicalPlaylistId", canonicalPlaylistId);
    fd.set("title", r.title);
    fd.set("artist", r.artist);
    fd.set("isrc", r.isrc ?? "");
    fd.set("durationMs", String(r.durationMs ?? ""));
    fd.set("provider", r.provider);
    fd.set("providerTrackId", r.providerTrackId);
    await suggestTrackAction(fd);
    setSent(`Sent “${r.title}” to the owner.`);
    setResults([]);
    setTerm("");
  }

  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="end">
        <TextInput
          label="Song or artist"
          value={term}
          onChange={setTerm}
          placeholder="Search"
          onEnter={() => void search()}
          className="flex-1"
        />
        <Button label={loading ? "Searching" : "Search"} variant="secondary" isLoading={loading} onClick={() => void search()} />
      </HStack>
      {sent && <Text>{sent}</Text>}
      {results.length > 0 && (
        <List hasDividers>
          {results.map((r) => (
            <ListItem
              key={`${r.provider}:${r.providerTrackId}`}
              label={r.title}
              description={r.artist}
              onClick={() => void suggest(r)}
              endContent={
                <Text type="supporting" color="secondary">
                  Suggest
                </Text>
              }
            />
          ))}
        </List>
      )}
    </VStack>
  );
}
