import type { Metadata } from "next";
import { RouterLink } from "@/components/RouterLink";
import "./globals.css";
import { getSessionUser } from "@/lib/auth";
import { AstryxTheme } from "@/components/AstryxTheme";
import { AppNav } from "@/components/AppNav";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Layout, LayoutContent, LayoutFooter, Section } from "@astryxdesign/core/Layout";
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fustat:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Manufacturing+Consent&display=swap"
        />
      </head>
      <body className="antialiased">
        <AstryxTheme>
          <AppShell
            height="auto"
            contentPadding={0}
            topNav={
              <TopNav
                heading={<TopNavHeading logo={<Mark />} heading="playlist-sync" headingHref="/" as={RouterLink} />}
                centerContent={user ? <AppNav /> : undefined}
                endContent={
                  user ? (
                    <>
                      <Button label="New sync" variant="primary" size="sm" href="/onboarding" as={RouterLink} />
                      <form action={logoutAction} className="contents">
                        <Button label="Log out" variant="ghost" size="sm" type="submit" />
                      </form>
                    </>
                  ) : (
                    <>
                      <TopNavItem label="Log in" href="/login" as={RouterLink} />
                      <Button label="Get started" variant="primary" size="sm" href="/signup" as={RouterLink} />
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
                  <Section variant="transparent" paddingInline={4} paddingBlockStart={8} paddingBlockEnd={10}>
                    {children}
                  </Section>
                </LayoutContent>
              }
              footer={
                <LayoutFooter hasDivider>
                  <Section variant="transparent" paddingInline={4} paddingBlock={2}>
                    <HStack hAlign="between" vAlign="center">
                      <Text type="supporting" color="secondary">
                        Additive sync only · Every 10 minutes
                      </Text>
                      <AstryxLink href="/privacy">Privacy</AstryxLink>
                    </HStack>
                  </Section>
                </LayoutFooter>
              }
            />
          </AppShell>
        </AstryxTheme>
      </body>
    </html>
  );
}
