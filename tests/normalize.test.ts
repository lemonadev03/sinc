import { describe, expect, it } from "vitest";
import { dedupeKey, normalizeArtist, normalizeIsrc, normalizeTitle, durationsClose } from "@/lib/normalize";

describe("track identity normalization", () => {
  it("strips remaster/feat noise from titles", () => {
    expect(normalizeTitle("Song One (Remastered 2011)")).toBe("song one");
    expect(normalizeTitle("Song One - Remastered Version")).toBe("song one");
    expect(normalizeTitle("Song One (feat. Other Artist)")).toBe("song one");
    expect(normalizeTitle("Song One")).toBe("song one");
  });

  it("keeps only the primary artist", () => {
    expect(normalizeArtist("Artist X ft. Somebody")).toBe("artist x");
    expect(normalizeArtist("Artist X & Artist Y")).toBe("artist x & artist y");
  });

  it("normalizes ISRCs case/format", () => {
    expect(normalizeIsrc("gb-abc-12-34567")).toBe("GBABC1234567");
    expect(normalizeIsrc(null)).toBeNull();
    expect(normalizeIsrc("TOOSHORT")).toBeNull();
  });

  it("prefers ISRC in the dedupe key, else falls back to metadata", () => {
    expect(dedupeKey({ isrc: "GBABC1234567", title: "a", artist: "b" })).toBe("isrc:GBABC1234567");
    expect(dedupeKey({ isrc: null, title: "Song One ", artist: "Artist X" })).toBe(
      `meta:${normalizeTitle("Song One ")}|${normalizeArtist("Artist X")}`
    );
  });

  it("treats near-identical durations as equal", () => {
    expect(durationsClose(200_000, 201_500)).toBe(true);
    expect(durationsClose(200_000, 210_000)).toBe(false);
    expect(durationsClose(null, 200_000)).toBe(true);
  });
});
