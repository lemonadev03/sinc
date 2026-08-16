import { ProviderRateLimitError } from "./types";

const MAX_RETRIES = 3;

export async function providerFetch(
  provider: "spotify" | "apple",
  url: string,
  init: RequestInit & { providerHeaders?: Record<string, string> } = {}
): Promise<Response> {
  let attempt = 0;
  // exponential backoff; 429 honors Retry-After
  for (;;) {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.providerHeaders ?? init.headers) },
      cache: "no-store",
    });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "2");
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
      await sleep(Math.min(delayMs, 30_000));
      attempt += 1;
      continue;
    }
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(2 ** attempt * 500);
      attempt += 1;
      continue;
    }
    return res;
  }
}

export async function providerFetchJson<T>(
  provider: "spotify" | "apple",
  url: string,
  init: RequestInit & { providerHeaders?: Record<string, string> } = {}
): Promise<T> {
  const res = await providerFetch(provider, url, init);
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "5");
    throw new ProviderRateLimitError(provider, (Number.isFinite(retryAfter) ? retryAfter : 5) * 1000);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`[${provider}] ${init.method ?? "GET"} ${url} -> ${res.status} ${body.slice(0, 300)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Offset-based pagination shared by both providers: keep fetching pages of
 * `pageSize` until a short/empty page arrives. Circuit-breaker at 10k items.
 */
export async function paginate<T>(
  fetchPage: (offset: number) => Promise<T[]>,
  pageSize: number
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const items = await fetchPage(offset);
    out.push(...items);
    if (items.length < pageSize || out.length > 10_000) break;
    offset += pageSize;
  }
  return out;
}
