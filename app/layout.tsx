import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getSessionUser } from "@/lib/auth";
import { AstryxTheme } from "@/components/AstryxTheme";
import { AppNav } from "@/components/AppNav";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { TopNav } from "@astryxdesign/core/TopNav";
import { TopNavHeading, TopNavItem } from "@astryxdesign/core/TopNav";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { Text } from "@astryxdesign/core/Text";
import { AstryxLink } from "@/components/AstryxLink";
import { logoutAction } from "./actions";

export const metadata: Metadata = {
  title: "playlist-sync — Spotify and Apple Music",
  description: "Keep the same playlists on Spotify and Apple Music.",
};

function Mark() {
  return (
    <NavIcon
      icon={
        <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
          <path
            d="M2 5.5h8.5M8.5 3l2.5 2.5L8.5 8M12 8.5H3.5M5.5 6L3 8.5 5.5 11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      }
    />
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser().catch(() => null);
  return (
    <html lang="en">
      <body>
        <AstryxTheme>
          <AppShell
            height="auto"
            contentPadding={0}
            topNav={
              <TopNav
                heading={<TopNavHeading logo={<Mark />} heading="playlist-sync" headingHref="/" as={Link} />}
                centerContent={user ? <AppNav /> : undefined}
                endContent={
                  user ? (
                    <>
                      <Button label="New sync" variant="primary" size="sm" href="/onboarding" as={Link} />
                      <form action={logoutAction}>
                        <Button label="Log out" variant="ghost" size="sm" type="submit" />
                      </form>
                    </>
                  ) : (
                    <>
                      <TopNavItem label="Log in" href="/login" as={Link} />
                      <Button label="Get started" variant="primary" size="sm" href="/signup" as={Link} />
                    </>
                  )
                }
              />
            }
          >
            <Layout
              height="auto"
              contentWidth={960}
              content={
                <LayoutContent>
                  {children}
                </LayoutContent>
              }
              footer={
                <LayoutFooter hasDivider>
                  <HStack hAlign="between" vAlign="center">
                    <Text type="supporting" color="secondary">
                      Additive sync only · Every 10 minutes
                    </Text>
                    <AstryxLink href="/privacy">Privacy</AstryxLink>
                  </HStack>
                </LayoutFooter>
              }
            />
          </AppShell>
        </AstryxTheme>
      </body>
    </html>
  );
}
