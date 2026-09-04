export const metadata = { title: "Privacy — playlist-sync" };

import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

export default function PrivacyPage() {
  return (
    <VStack gap={4}>
      <Heading level={1}>Privacy</Heading>
      <Text color="secondary">
        This app syncs playlists you explicitly select between Spotify and Apple Music. To do that,
        it stores your account email and password hash, encrypted provider tokens, and playlist
        metadata (names, titles, artists, ISRCs) for synced playlists only.
      </Text>
      <Text color="secondary">
        Audio, artwork, and previews are never stored. Provider content is never sent to any AI
        model — matching is deterministic application code.
      </Text>
      <Text color="secondary">
        Disconnecting a provider deletes its credentials and pauses its syncs. Deleting your
        account deletes everything.
      </Text>
    </VStack>
  );
}
