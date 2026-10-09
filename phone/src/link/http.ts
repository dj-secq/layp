export type PostResult = { status: number; body: string; aborted: boolean };

/** Timeout and the caller's abort are separate. Only the caller's signal counts as superseded. */
export async function postText(url: string, body: string, timeoutMs: number, signal?: AbortSignal): Promise<PostResult> {
  if (signal?.aborted) return { status: 0, body: "", aborted: true };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const onAbort = () => timeout.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal: timeout.signal,
    });
    const text = await response.text();
    if (signal?.aborted) return { status: response.status, body: text, aborted: true };
    return { status: response.status, body: text, aborted: false };
  } catch {
    if (signal?.aborted) return { status: 0, body: "", aborted: true };
    return { status: 0, body: "", aborted: false };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
