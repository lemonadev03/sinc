"use client";

import { Tab, TabList } from "@astryxdesign/core/TabList";
import { RouterLink } from "./RouterLink";

export function SettingsTabs({ value }: { value: "connections" | "account" }) {
  return (
    <TabList value={value} onChange={() => {}} hasDivider>
      <Tab value="connections" label="Connections" href="/settings/connections" as={RouterLink} />
      <Tab value="account" label="Account" href="/settings/account" as={RouterLink} />
    </TabList>
  );
}
