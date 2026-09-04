"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";

// Astryx passes both `href` and `to` (react-router convention) to custom link
// components. Next.js Link forwards unknown props to the DOM, so `to` must be
// stripped here — otherwise every link renders `<a to="..." href="...">`.
export function RouterLink({ to, href, ...rest }: ComponentProps<typeof NextLink> & { to?: string }) {
  void to;
  return <NextLink href={href} {...rest} />;
}
