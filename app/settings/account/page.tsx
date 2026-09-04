import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { deleteAccountAction } from "@/app/actions";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <VStack gap={5}>
      <Heading level={1}>Settings</Heading>
      <TabList value="account" onChange={() => {}} hasDivider>
        <Tab value="connections" label="Connections" href="/settings/connections" as={Link} />
        <Tab value="account" label="Account" href="/settings/account" as={Link} />
      </TabList>

      <Card>
        <VStack gap={1}>
          <Text weight="medium">Signed in as {user.email}</Text>
          <Text type="supporting" color="secondary">
            Sync is additive only — removing a song never propagates.
          </Text>
        </VStack>
      </Card>

      <Banner
        status="error"
        title="Delete account"
        description="Removes your account, credentials, playlists, and sync history. This cannot be undone."
        endContent={
          <form action={deleteAccountAction}>
            <Button label="Delete everything" variant="destructive" type="submit" />
          </form>
        }
      />
    </VStack>
  );
}
