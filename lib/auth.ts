import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { hashPassword, verifyPassword, randomToken } from "./crypto";

const SESSION_COOKIE = "ps_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SessionUser = { id: string; email: string };

export async function createSession(userId: string): Promise<void> {
  const token = randomToken();
  const db = await getDb();
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await await (await getDb()).delete(sessions).where(eq(sessions.id, hashToken(token)));
  }
  jar.delete(SESSION_COOKIE);
}

/** Returns the signed-in user, or null. Validates the session against the DB. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

/** Throwing variant for server actions / route handlers. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function signUp(email: string, password: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return { ok: false, error: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  const db = await getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).limit(1);
  if (existing.length > 0) return { ok: false, error: "An account with that email already exists." };
  const id = crypto.randomUUID();
  await db.insert(users).values({ id, email: normalized, passwordHash: hashPassword(password) });
  await createSession(id);
  return { ok: true, userId: id };
}

export async function signIn(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalized = email.trim().toLowerCase();
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: "Invalid email or password." };
  }
  await createSession(user.id);
  return { ok: true };
}

/** Deletes the user and, via FK cascade, every credential, playlist, and sync datum. */
export async function deleteUser(userId: string): Promise<void> {
  await await (await getDb()).delete(users).where(eq(users.id, userId));
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
