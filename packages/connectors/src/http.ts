/** fetch that throws a readable error on a non-2xx answer and parses JSON. */
export async function requestJson<T>(
  fetchImpl: typeof fetch,
  platform: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${platform} answered HTTP ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** Base64 of a UTF-8 string, in Node and Workers alike. */
export function base64(s: string): string {
  let bin = "";
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

export async function verifyBy(check: () => Promise<unknown>) {
  try {
    await check();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, reason: (e as Error).message };
  }
}
