const MAX_RETRIES = 3;
const BASE_DELAY_MS = 800;

function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('networkerror') || msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch') || msg.includes('load failed');
  }
  return false;
}

export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isNetworkError(e) || attempt === MAX_RETRIES - 1) {
        throw e;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.log(`[Retry] ${label} attempt ${attempt + 1}/${MAX_RETRIES} failed (network), retrying in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}
