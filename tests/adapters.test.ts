import { describe, expect, it, vi, afterEach } from "vitest";
import { SpotifyAdapter } from "@/lib/providers/spotify";
import { AppleMusicAdapter } from "@/lib/providers/apple";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SpotifyAdapter (real adapter, stubbed HTTP)", () => {
  it("listPlaylists maps and paginates — regression: detached this.api", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        calls += 1;
        if (u.includes("/me/playlists")) {
          const offset = Number(new URL(u).searchParams.get("offset") ?? 0);
          const items =
            offset === 0
              ? [
                  // Feb 2026 shape: item count under `items.total`, present for owned playlists
                  { id: "pl1", name: "Gym", snapshot_id: "s1", external_urls: { spotify: "https://open.spotify.com/playlist/pl1" }, owner: { id: "me-user" }, items: { total: 12 } },
                  // followed playlist: no items summary at all
                  { id: "pl2", name: "Followed", owner: { id: "someone-else" }, tracks: { total: 3 } },
                ]
              : [];
          return jsonResponse({ items });
        }
        throw new Error(`unexpected fetch: ${u}`);
      })
    );

    const adapter = new SpotifyAdapter(async () => "token", "me-user");
    const playlists = await adapter.listPlaylists();

    expect(calls).toBe(1); // short page ends pagination (no second probe)
    expect(playlists).toHaveLength(2);
    expect(playlists[0]).toMatchObject({
      providerPlaylistId: "pl1",
      name: "Gym",
      editable: true,
      ownerExternalId: "me-user",
      providerRevision: "s1",
      trackCount: 12, // read from items.total, not the pre-2026 tracks.total
    });
    expect(playlists[1].editable).toBe(false); // followed playlist, different owner
    expect(playlists[1].trackCount).toBe(3); // legacy fallback still honored
  });

  it("getPlaylistItems reads the current `item` wrapper key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/playlists/plX/items")) {
          return jsonResponse({
            items: [
              { item: { id: "t1", uri: "spotify:track:t1", name: "Song", type: "track", duration_ms: 200000, explicit: false, artists: [{ name: "Artist" }], external_ids: { isrc: "GBAAA0000001" } } },
              { item: { id: "e1", uri: "spotify:episode:e1", name: "Podcast", type: "episode" } }, // ignored
              { item: null }, // removed track slot
              { track: { id: "t2", uri: "spotify:track:t2", name: "Legacy Key", type: "track", artists: [{ name: "Old" }] } }, // deprecated fallback
            ],
          });
        }
        throw new Error(`unexpected fetch: ${u}`);
      })
    );

    const adapter = new SpotifyAdapter(async () => "token", "me-user");
    const items = await adapter.getPlaylistItems("plX");

    expect(items.map((i) => i.providerTrackId)).toEqual(["t1", "t2"]);
    expect(items[0]).toMatchObject({ isrc: "GBAAA0000001", title: "Song", artist: "Artist" });
    expect(items[1].title).toBe("Legacy Key");
  });
});

describe("AppleMusicAdapter (real adapter, stubbed HTTP)", () => {
  const devToken = async () => "dev-token";

  it("getPlaylistItems reads ISRC from include=catalog materialization", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("/v1/me/library/playlists/pl9/tracks")) {
          return jsonResponse({
            data: [
              {
                id: "i.lib1",
                type: "library-songs",
                attributes: { name: "Local Cut", artistName: "Bedroom Band", durationInMillis: 100000 },
                relationships: {
                  catalog: { data: [{ id: "cat1", type: "songs", attributes: { name: "Local Cut", artistName: "Bedroom Band", isrc: "USXXX2100001", durationInMillis: 100000 } }] },
                },
              },
              {
                id: "i.lib2",
                type: "library-songs",
                attributes: { name: "Imported CD Rip", artistName: "Old Band", durationInMillis: 200000 },
                // no catalog relationship — library-only
              },
            ],
          });
        }
        throw new Error(`unexpected fetch: ${u}`);
      })
    );

    const adapter = new AppleMusicAdapter(devToken, async () => "mut", "us");
    const items = await adapter.getPlaylistItems("pl9");

    expect(items).toHaveLength(2);
    expect(items[0].isrc).toBe("USXXX2100001");
    expect(items[0].providerTrackId).toBe("cat1"); // catalog id preferred for adds
    expect(items[0].inCatalog).toBe(true);
    expect(items[1].inCatalog).toBe(false);
    expect(items[1].providerTrackId).toBe("i.lib2");
  });

  it("resolveTrack prefers catalog ISRC lookup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes("filter[isrc]=GBAAA0000042")) {
          return jsonResponse({ data: [{ id: "am-song-42", type: "songs", attributes: { name: "Hit", artistName: "Star" } }] });
        }
        throw new Error(`unexpected fetch: ${u}`);
      })
    );

    const adapter = new AppleMusicAdapter(devToken, async () => "mut", "gb");
    const res = await adapter.resolveTrack({ isrc: "GBAAA0000042", title: "Hit", artist: "Star", durationMs: 180000 });
    expect(res).toMatchObject({ status: "matched", providerTrackId: "am-song-42", matchMethod: "isrc" });
  });
});
