"use client";

import { HStack } from "@astryxdesign/core/HStack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Table, proportional, pixel } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";

export type SyncRunRow = {
  id: string;
  status: string;
  startedAt: string;
  trigger: string;
  ingested: number;
  spotify: number;
  apple: number;
  unmatched: number;
  error: string | null;
};

interface Row extends Record<string, unknown>, SyncRunRow {}

function statusVariant(status: string): "success" | "warning" | "error" | "neutral" {
  if (status === "success") return "success";
  if (status === "running" || status === "partial") return "warning";
  if (status === "error") return "error";
  return "neutral";
}

function statusLabel(status: string): string {
  if (status === "success") return "Synced";
  if (status === "running") return "Syncing";
  if (status === "partial") return "Partial";
  if (status === "error") return "Failed";
  return status;
}

export function SyncRunsTable({ runs }: { runs: SyncRunRow[] }) {
  return (
    <Table
      data={runs as Row[]}
      idKey="id"
      density="compact"
      columns={[
        {
          key: "status",
          header: "Status",
          width: pixel(110),
          renderCell: (r) => (
            <HStack gap={1} vAlign="center">
              <StatusDot variant={statusVariant(String(r.status))} label={statusLabel(String(r.status))} />
              <Text type="supporting">{statusLabel(String(r.status))}</Text>
            </HStack>
          ),
        },
        {
          key: "startedAt",
          header: "When",
          width: pixel(130),
          renderCell: (r) => <Timestamp value={String(r.startedAt)} format="relative" />,
        },
        {
          key: "trigger",
          header: "Trigger",
          width: pixel(90),
          renderCell: (r) => <Text type="supporting">{String(r.trigger)}</Text>,
        },
        {
          key: "added",
          header: "Added",
          width: proportional(1),
          renderCell: (r) => (
            <Text type="supporting">
              +{Number(r.ingested)} in · +{Number(r.spotify)} Spotify · +{Number(r.apple)} Apple ·{" "}
              {Number(r.unmatched)} unmatched
            </Text>
          ),
        },
        {
          key: "error",
          header: "Error",
          width: proportional(1),
          renderCell: (r) =>
            r.error ? <Text type="supporting">{String(r.error)}</Text> : <Text type="supporting">—</Text>,
        },
      ]}
    />
  );
}
