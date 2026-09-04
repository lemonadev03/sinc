import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List } from "@astryxdesign/core/List";
import { ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

const STEPS = [
  {
    n: "01",
    title: "Connect",
    body: "Link Spotify and Apple Music.",
  },
  {
    n: "02",
    title: "Pick",
    body: "Mirror one playlist, or link a pair.",
  },
  {
    n: "03",
    title: "Done",
    body: "New songs appear on both sides.",
  },
];

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <VStack gap={8}>
      <VStack gap={4}>
        <Heading level={1} type="display-2">
          The same playlists, on both services.
        </Heading>
        <Text type="large" color="secondary">
          playlist-sync copies new additions between Spotify and Apple Music. Additive only — nothing
          is ever deleted.
        </Text>
        <HStack gap={2}>
          <Button label="Get started" variant="primary" href="/signup" as={Link} />
          <Button label="Log in" variant="secondary" href="/login" as={Link} />
        </HStack>
      </VStack>

      <List hasDividers>
        {STEPS.map((s) => (
          <ListItem
            key={s.n}
            label={s.title}
            description={s.body}
            startContent={
              <Text type="supporting" color="secondary">
                {s.n}
              </Text>
            }
          />
        ))}
      </List>
    </VStack>
  );
}
