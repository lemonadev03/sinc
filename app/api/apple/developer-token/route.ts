import { NextResponse } from "next/server";
import { appleConfigured, config } from "@/lib/config";
import { getAppleDeveloperToken } from "@/lib/providers/apple";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!appleConfigured()) {
    return NextResponse.json({ error: "Apple Music is not configured on this server" }, { status: 503 });
  }
  const { developerToken, expiresInSeconds } = await getAppleDeveloperToken(config.apple);
  return NextResponse.json({ developerToken, expiresIn: expiresInSeconds });
}
