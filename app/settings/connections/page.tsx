import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { musicConnections } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { appleConfigured, spotifyConfigured } from "@/lib/config";
import { Ago, ProviderToken } from "@/components/ui";
import { disconnectProviderAction } from "@/app/actions";
import { AppleConnectButton } from "@/components/AppleConnectButton";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List } from "@astryxdesign/core/List";
import { ListItem } from "@astryxdesign/core/List";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { VStack } from "@astryxdesign/core/VStack";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { error } = await searchParams;

  const connections = await (await getDb()).select().from(musicConnections).where(eq(musicConnections.userId, user.id));
  const spotify = connections.find((c) => c.provider === "spotify");
  const apple = connections.find((c) => c.provider === "apple");

  return (
    <VStack gap={5}>
      <Heading level={1}>Settings</Heading>
      <TabList value="connections" onChange={() => {}} hasDivider>
        <Tab value="connections" label="Connections" href="/settings/connections" as={Link} />
        <Tab value="account" label="Account" href="/settings/account" as={Link} />
      </TabList>

      {error && (
        <Banner
          status="error"
          title="Connection failed"
          description={
            error === "oauth_state"
              ? "The Spotify sign-in expired. Try again."
              : error === "not_configured"
                ? "This service is not configured on this server yet."
                : "Something went wrong. Try again."
          }
        />
      )}

      <List hasDividers>
        <ListItem
          label="Spotify"
          description={
            <>
              {spotify ? `Connected · ${spotify.externalAccountName ?? spotify.externalAccountId ?? ""}` : "Not connected"}
              {spotify && !spotify.needsReconnect ? (
                <>
                  {" · Validated "}
                  <Ago date={spotify.lastValidatedAt} />
                </>
              ) : null}
              {spotify?.needsReconnect ? " · Authorization expired" : ""}
            </>
          }
          startContent={<ProviderToken provider="spotify" />}
          endContent={
            <HStack gap={2} wrap="wrap">
              {spotify ? (
                <>
                  <Button label="Reconnect" variant={spotify.needsReconnect ? "primary" : "secondary"} href="/api/auth/spotify/start" />
                  <form action={disconnectProviderAction}>
                    <input type="hidden" name="provider" value="spotify" />
                    <Button label="Disconnect" variant="ghost" type="submit" />
                  </form>
                </>
              ) : (
                <Button label="Connect" variant="primary" href="/api/auth/spotify/start" isDisabled={!spotifyConfigured()} />
              )}
            </HStack>
          }
        />
        <ListItem
          label="Apple Music"
          description={
            <>
              {apple ? `Connected${apple.storefront ? ` · ${apple.storefront}` : ""}` : "Not connected"}
              {apple && !apple.needsReconnect ? (
                <>
                  {" · Validated "}
                  <Ago date={apple.lastValidatedAt} />
                </>
              ) : null}
              {apple?.needsReconnect ? " · Authorization invalid" : ""}
            </>
          }
          startContent={<ProviderToken provider="apple" />}
          endContent={
            <HStack gap={2} wrap="wrap">
              <AppleConnectButton disabled={!appleConfigured()} />
              {apple && (
                <form action={disconnectProviderAction}>
                  <input type="hidden" name="provider" value="apple" />
                  <Button label="Disconnect" variant="ghost" type="submit" />
                </form>
              )}
            </HStack>
          }
        />
      </List>
    </VStack>
  );
}
