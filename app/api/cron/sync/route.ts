import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { log } from "@/lib/log";
import { syncAllEnabled } from "@/lib/sync/engine";
import { getAdaptersForUser } from "@/lib/providers";

async function runCron(req: NextRequest): Promise<NextResponse> {
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const secret = config.cronSecret;
  if (secret) {
    if (provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  } else {
    log.warn("cron invoked without CRON_SECRET in dev — allowing");
  }

  const { attempted, results } = await syncAllEnabled(undefined, (userId) => getAdaptersForUser(userId));
  void results;
  return NextResponse.json({ ok: true, attempted });
}

export async function GET(req: NextRequest) {
  return runCron(req);
}

export async function POST(req: NextRequest) {
  return runCron(req);
}
