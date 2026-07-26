/**
 * Next's `redirect()` and `notFound()` do not return -- they throw.
 *
 * That makes them invisible to a reader and lethal to `catch (error)`. Three
 * server actions called a redirect helper on the *success* path inside a try
 * whose catch caught everything, so the redirect was swallowed and re-reported
 * as a failure: the work had already committed, and the user was told it had
 * not, with "NEXT_REDIRECT" as the error text.
 *
 * Any catch block that wraps a redirect must re-throw the signal first.
 *
 * The digest carries the shape `NEXT_REDIRECT;<type>;<destination>;<status>;`
 * (see next/dist/client/components/redirect-error). Matching the prefix rather
 * than importing that module keeps this off a private path that can move
 * between Next versions.
 */
const CONTROL_FLOW_DIGESTS = ["NEXT_REDIRECT", "NEXT_NOT_FOUND"];

export function isNextControlFlowSignal(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("digest" in error)) {
    return false;
  }

  const { digest } = error as { digest?: unknown };

  if (typeof digest !== "string") {
    return false;
  }

  return CONTROL_FLOW_DIGESTS.some(
    (code) => digest === code || digest.startsWith(`${code};`),
  );
}

/**
 * Call first in any catch that might have wrapped a `redirect()`/`notFound()`.
 * Re-throws navigation, returns for anything that is a genuine error.
 */
export function rethrowNextControlFlow(error: unknown): void {
  if (isNextControlFlowSignal(error)) {
    throw error;
  }
}
