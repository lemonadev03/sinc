import { Badge } from "@astryxdesign/core/Badge";
import { EmptyState as AstryxEmptyState } from "@astryxdesign/core/EmptyState";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Token } from "@astryxdesign/core/Token";

export function ProviderToken({ provider }: { provider: string }) {
  if (provider === "spotify") return <Token label="Spotify" color="green" size="sm" />;
  if (provider === "apple") return <Token label="Apple Music" color="red" size="sm" />;
  return <Token label={provider} size="sm" />;
}

const SYNC_STATUS: Record<string, { label: string; variant: "success" | "warning" | "error" | "neutral" }> = {
  success: { label: "Synced", variant: "success" },
  running: { label: "Syncing", variant: "warning" },
  partial: { label: "Partial", variant: "warning" },
  error: { label: "Failed", variant: "error" },
};

export function SyncStatus({ status, pulsing }: { status: string | null; pulsing?: boolean }) {
  const meta = status ? SYNC_STATUS[status] : undefined;
  if (!meta) {
    return (
      <HStack gap={2}>
        <StatusDot variant="neutral" label="Not synced yet" />
        <Text color="secondary">Not synced yet</Text>
      </HStack>
    );
  }
  return (
    <HStack gap={2}>
      <StatusDot variant={meta.variant} label={meta.label} isPulsing={pulsing ?? meta.variant !== "success"} />
      <Text color="secondary">{meta.label}</Text>
    </HStack>
  );
}

export function Ago({ date, short }: { date: Date | null | undefined; short?: boolean }) {
  if (!date)
    return (
      <Text color="secondary" type="inherit">
        never
      </Text>
    );
  return <Timestamp value={date.toISOString()} format={short ? "relative_short" : "relative"} isLive />;
}

export function CountBadge({ count }: { count: number }) {
  return <Badge variant="neutral" label={String(count)} />;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return <AstryxEmptyState title={title} description={body} actions={action} />;
}

export { Timestamp };
