import NextLink from "next/link";
import { Link } from "@astryxdesign/core/Link";

export function AstryxLink({
  href,
  children,
  color = "accent",
}: {
  href: string;
  children: React.ReactNode;
  color?: "primary" | "secondary" | "accent" | "inherit";
}) {
  return (
    <Link href={href} as={NextLink} color={color} isStandalone>
      {children}
    </Link>
  );
}
