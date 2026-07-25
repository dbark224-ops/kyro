"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ResetStatus = {
  tone: "success" | "error";
  message: string;
};

export function StripeResetButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isResetting, setIsResetting] = useState(false);
  const [status, setStatus] = useState<ResetStatus | null>(null);
  const busy = isResetting || isPending;

  async function resetStripeSetup() {
    setStatus(null);
    setIsResetting(true);

    try {
      const response = await fetch("/api/settings/stripe/reset", {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to reset Stripe setup.");
      }

      setStatus({
        message:
          payload.message ??
          "Stripe setup has been reset. Start setup again to create a fresh payout account.",
        tone: "success",
      });
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setStatus({
        message:
          error instanceof Error
            ? error.message
            : "Unable to reset Stripe setup.",
        tone: "error",
      });
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="stripe-reset-control">
      <button
        aria-busy={busy}
        className="settings-submit-button secondary-button compact danger"
        disabled={busy}
        onClick={resetStripeSetup}
        type="button"
      >
        {busy ? (
          <>
            <span aria-hidden="true" className="settings-submit-spinner" />
            <span>Resetting...</span>
          </>
        ) : (
          "Reset setup"
        )}
      </button>
      {status ? (
        <small className={`stripe-reset-status ${status.tone}`} role="status">
          {status.message}
        </small>
      ) : null}
    </div>
  );
}
