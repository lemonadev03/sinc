"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TopNavItem } from "@astryxdesign/core/TopNav";

const ITEMS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Playlists", href: "/playlists" },
  { label: "Settings", href: "/settings/connections" },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <>
      {ITEMS.map((item) => (
        <TopNavItem
          key={item.href}
          label={item.label}
          href={item.href}
          as={Link}
          isSelected={pathname === item.href || pathname.startsWith(`${item.href}/`)}
        />
      ))}
    </>
  );
}
