"use client";

import type { WorkspacePhoneNumberPoolRow } from "../../lib/voice/phone-number-pool";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { enableWorkspacePhoneSmsAction } from "./actions";

function AssignNumberButton({ disabled }: Readonly<{ disabled: boolean }>) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className="primary-button phone-number-picker-submit"
      disabled={disabled || pending}
      type="submit"
    >
      {pending ? (
        <span className="settings-submit-spinner" aria-hidden="true" />
      ) : null}
      {pending ? "Assigning..." : "Get this Kyro number"}
    </button>
  );
}

export function PhoneNumberPicker({
  numbers,
  phoneRegion,
}: Readonly<{
  numbers: WorkspacePhoneNumberPoolRow[];
  phoneRegion: string;
}>) {
  const countryNumbers = useMemo(
    () => numbers.filter((number) => number.countryCode === phoneRegion),
    [numbers, phoneRegion],
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(countryNumbers[0]?.id ?? "");
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const filteredNumbers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return countryNumbers;
    }

    return countryNumbers.filter((number) =>
      [
        number.phoneNumber,
        number.normalizedPhone,
        number.friendlyName,
        number.region,
        number.countryCode,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    );
  }, [countryNumbers, query]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="primary-button phone-number-picker-open"
        disabled={countryNumbers.length === 0}
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        {countryNumbers.length > 0
          ? "Choose a number"
          : `No ${phoneRegion} numbers available`}
      </button>

      {open ? (
        <div
          className="phone-number-picker-backdrop"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <section
            aria-labelledby={titleId}
            aria-modal="true"
            className="phone-number-picker-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header className="phone-number-picker-header">
              <div>
                <p className="eyebrow">Kyro number</p>
                <h2 id={titleId}>Choose a phone number</h2>
              </div>
              <button
                aria-label="Close number selector"
                className="phone-number-picker-close"
                onClick={() => setOpen(false)}
                title="Close"
                type="button"
              >
                X
              </button>
            </header>

            <div className="phone-number-picker-toolbar">
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${phoneRegion} numbers...`}
                ref={searchRef}
                type="search"
                value={query}
              />
              <span className="pill">{phoneRegion} only</span>
            </div>

            <form
              action={enableWorkspacePhoneSmsAction}
              className="phone-number-picker-form"
            >
              <div className="phone-number-picker-list">
                {filteredNumbers.length > 0 ? (
                  filteredNumbers.map((number) => (
                    <label
                      className="phone-number-picker-option"
                      key={number.id}
                    >
                      <input
                        checked={selectedId === number.id}
                        name="phoneNumberId"
                        onChange={() => setSelectedId(number.id)}
                        type="radio"
                        value={number.id}
                      />
                      <span>
                        <strong>{number.phoneNumber}</strong>
                        <small>
                          {[number.region, number.countryCode, "Calls and SMS"]
                            .filter(Boolean)
                            .join(" - ")}
                        </small>
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="empty-copy phone-number-picker-empty">
                    No matching {phoneRegion} numbers.
                  </p>
                )}
              </div>

              <footer className="phone-number-picker-footer">
                <span>A one-time US$6 setup charge applies when assigned.</span>
                <AssignNumberButton disabled={!selectedId} />
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
