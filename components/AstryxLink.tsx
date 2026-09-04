import { Link } from "@astryxdesign/core/Link";
import { RouterLink } from "./RouterLink";

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
    <Link href={href} as={RouterLink} color={color} isStandalone>
      {children}
    </Link>
  );
}
