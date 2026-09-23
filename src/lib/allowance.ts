/** RFC-0010 outcome of one resource allocation, as the host SDK reports it. */
export type AllowanceOutcome = "Allocated" | "Rejected" | "NotAvailable";

/**
 * Ask the host for the allowance covering a sponsored write. Resolves null when
 * the call itself failed (host unreachable, undecodable reply) — treated like a
 * refusal by {@link withAllowanceRetry}.
 */
export type RequestAllowance = () => Promise<AllowanceOutcome | null>;

const ALLOWANCE_FAILURE = /not\s+authori[sz]ed|unauthori[sz]ed|allowance|permission|quota|insufficient/i;

/** Does a rejected sponsored write look like a missing or expired allowance? */
export function looksLikeAllowanceFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return ALLOWANCE_FAILURE.test(message);
}

/**
 * Run a sponsored host write; if it fails for want of an allowance, request the
 * allowance ONCE and retry the write once.
 *
 * The happy path never asks: RFC-0010 provisions slot-table allowances
 * implicitly on the first submission, so requesting up front would only add a
 * host dialog. But allowances are quotas with an expiry, and once one lapses
 * every save fails with "not authorized" until something re-requests it — this
 * is that something, on the failure path only. Any other failure, a refused
 * allowance, or a failed retry surfaces to the caller with the outcome attached.
 */
export async function withAllowanceRetry<T>(
  write: () => Promise<T>,
  requestAllowance: RequestAllowance,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!looksLikeAllowanceFailure(error)) throw error;
    const outcome = await requestAllowance().catch(() => null);
    if (outcome !== "Allocated") {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${reason} (allowance request: ${outcome ?? "failed"})`, { cause: error });
    }
    return write();
  }
}
