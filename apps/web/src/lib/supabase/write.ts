/**
 * Make a failed write loud.
 *
 * PostgREST returns errors, it does not throw them, so `await supabase.from(x)
 * .update(y)` succeeds as a statement whether or not the row changed. Sixty-nine
 * writes across the app were written that way. Most are harmless. On the money
 * and delivery paths they are not:
 *
 *   - the write that records an email's provider_message_id runs *after* the
 *     email is sent, so losing it means Kyro retries and the customer gets the
 *     message twice;
 *   - invoice status transitions decide whether a charged invoice still looks
 *     open, and whether dunning ever starts;
 *   - cancelling an urgent escalation step is a write, so losing it keeps a
 *     cancelled escalation escalating.
 *
 * None of those announce themselves. This turns them into ordinary failures the
 * caller -- usually a retried background job -- can see and act on.
 *
 * Named after the operation, not the table, because the message ends up in a log
 * someone reads at 2am.
 */
type WriteResult = { error: { message?: string | null } | null };

/** Throw on an already-awaited result. Use when the caller needs `data` too. */
export function throwOnDatabaseError(result: WriteResult, operation: string) {
  if (result.error) {
    throw new Error(
      `${operation}: ${result.error.message ?? "unknown database error"}`,
    );
  }
}

/**
 * Report a failed write without failing the caller.
 *
 * For writes that genuinely should not stop the work: telemetry, event trails,
 * a UI hint, or bookkeeping that runs inside an error handler where throwing
 * would replace the real failure with a database one. The point is that they
 * stop being *silent* -- "this write does not matter enough to throw" and "no
 * one will ever know it failed" are different decisions, and only the first is
 * ever intended.
 */
export async function logWriteError<T extends WriteResult>(
  write: PromiseLike<T>,
  operation: string,
): Promise<T> {
  const result = await write;

  if (result.error) {
    console.error(
      `${operation}: ${result.error.message ?? "unknown database error"}`,
    );
  }

  return result;
}

/** Await and throw in one step. Use when the result is not otherwise needed. */
export async function writeOrThrow<T extends WriteResult>(
  write: PromiseLike<T>,
  operation: string,
): Promise<T> {
  const result = await write;

  throwOnDatabaseError(result, operation);

  return result;
}
