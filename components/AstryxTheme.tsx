"use client";

import { Theme } from "@astryxdesign/core";
import { gothicTheme } from "@astryxdesign/theme-gothic/built";

export function AstryxTheme({ children }: { children: React.ReactNode }) {
  return (
    <Theme theme={gothicTheme} mode="dark">
      {children}
    </Theme>
  );
}
