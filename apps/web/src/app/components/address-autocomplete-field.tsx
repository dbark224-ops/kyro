"use client";

import type {
  AddressSuggestion,
  StructuredAddress,
} from "../../lib/addresses/types";
import { useEffect, useId, useMemo, useRef, useState } from "react";

type AddressAutocompleteFieldProps = {
  className?: string;
  defaultValue?: string | null;
  label?: string;
  name?: string;
  onAddressChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  value?: string;
};

function hiddenValue(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function serializeAddress(address: StructuredAddress | null) {
  return address ? JSON.stringify(address) : "";
}

function newSessionToken() {
  return crypto.randomUUID();
}

export function AddressAutocompleteField({
  className,
  defaultValue,
  label = "Address",
  name = "address",
  onAddressChange,
  placeholder = "Start typing an address...",
  required = false,
  value,
}: AddressAutocompleteFieldProps) {
  const id = useId();
  const isControlled = value !== undefined;
  const [localValue, setLocalValue] = useState(defaultValue ?? "");
  const [selectedAddress, setSelectedAddress] =
    useState<StructuredAddress | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [shouldSearch, setShouldSearch] = useState(false);
  const sessionTokenRef = useRef(newSessionToken());
  const currentValue = isControlled ? value : localValue;
  const listId = `${id}-address-suggestions`;

  const hiddenFields = useMemo(
    () => ({
      administrativeArea: selectedAddress?.administrativeArea ?? "",
      countryCode: selectedAddress?.countryCode ?? "",
      formatted: selectedAddress?.formattedAddress ?? "",
      latitude: hiddenValue(selectedAddress?.latitude),
      line1: selectedAddress?.line1 ?? "",
      line2: selectedAddress?.line2 ?? "",
      locality: selectedAddress?.locality ?? "",
      longitude: hiddenValue(selectedAddress?.longitude),
      placeId: selectedAddress?.placeId ?? "",
      postalCode: selectedAddress?.postalCode ?? "",
      source: selectedAddress?.source ?? "manual",
      structured: serializeAddress(selectedAddress),
      validationStatus: selectedAddress?.validationStatus ?? "",
    }),
    [selectedAddress],
  );

  useEffect(() => {
    if (!shouldSearch) {
      const resetTimeout = window.setTimeout(() => {
        setSuggestions([]);
        setIsOpen(false);
        setStatus("idle");
      }, 0);

      return () => window.clearTimeout(resetTimeout);
    }

    const query = currentValue.trim();

    if (query.length < 3 || selectedAddress?.formattedAddress === query) {
      if (query.length < 3) {
        const resetTimeout = window.setTimeout(() => {
          setSuggestions([]);
          setIsOpen(false);
          setStatus("idle");
        }, 0);

        return () => window.clearTimeout(resetTimeout);
      }
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setStatus("loading");
      setMessage(null);

      try {
        const params = new URLSearchParams({
          q: query,
          sessionToken: sessionTokenRef.current,
        });
        const response = await fetch(`/api/addresses/autocomplete?${params}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          data?: AddressSuggestion[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to search addresses.");
        }

        setSuggestions(payload.data ?? []);
        setIsOpen(Boolean(payload.data?.length));
        setStatus("idle");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setSuggestions([]);
        setIsOpen(false);
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Address search is unavailable.",
        );
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [currentValue, selectedAddress?.formattedAddress, shouldSearch]);

  function updateValue(nextValue: string) {
    if (!isControlled) {
      setLocalValue(nextValue);
    }

    onAddressChange?.(nextValue);
  }

  async function chooseSuggestion(suggestion: AddressSuggestion) {
    setStatus("loading");
    setIsOpen(false);
    setMessage(null);

    try {
      const params = new URLSearchParams({
        placeId: suggestion.placeId,
        sessionToken: sessionTokenRef.current,
      });
      const response = await fetch(`/api/addresses/place?${params}`);
      const payload = (await response.json()) as {
        data?: StructuredAddress;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Unable to load address details.");
      }

      setSelectedAddress(payload.data);
      updateValue(payload.data.formattedAddress ?? suggestion.description);
      setSuggestions([]);
      setShouldSearch(false);
      setStatus("idle");
      sessionTokenRef.current = newSessionToken();
    } catch (error) {
      setSelectedAddress(null);
      setStatus("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to select this address.",
      );
    }
  }

  return (
    <label
      className={["address-autocomplete-field", className]
        .filter(Boolean)
        .join(" ")}
    >
      {label ? (
        <span className="address-autocomplete-label">{label}</span>
      ) : null}
      <span className="address-autocomplete-control">
        <input
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={isOpen}
          autoComplete="street-address"
          name={name}
          onBlur={() => {
            window.setTimeout(() => setIsOpen(false), 150);
          }}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;

            setShouldSearch(true);
            setSelectedAddress(null);
            if (nextValue.trim().length < 3) {
              setSuggestions([]);
              setIsOpen(false);
              setStatus("idle");
            }
            updateValue(nextValue);
          }}
          onFocus={() => setIsOpen(shouldSearch && suggestions.length > 0)}
          placeholder={placeholder}
          required={required}
          role="combobox"
          type="text"
          value={currentValue}
        />
        {status === "loading" ? (
          <span className="address-autocomplete-spinner" aria-hidden="true" />
        ) : null}
        {isOpen ? (
          <span
            className="address-autocomplete-menu"
            id={listId}
            role="listbox"
          >
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.placeId}
                aria-selected={false}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void chooseSuggestion(suggestion)}
                role="option"
                type="button"
              >
                <strong>{suggestion.mainText}</strong>
                {suggestion.secondaryText ? (
                  <small>{suggestion.secondaryText}</small>
                ) : null}
              </button>
            ))}
            <span className="address-autocomplete-attribution">
              Powered by Google
            </span>
          </span>
        ) : null}
      </span>
      {message ? (
        <small className="address-autocomplete-message">{message}</small>
      ) : null}
      <input
        name={`${name}GooglePlaceId`}
        type="hidden"
        value={hiddenFields.placeId}
      />
      <input
        name={`${name}Formatted`}
        type="hidden"
        value={hiddenFields.formatted}
      />
      <input name={`${name}Line1`} type="hidden" value={hiddenFields.line1} />
      <input name={`${name}Line2`} type="hidden" value={hiddenFields.line2} />
      <input
        name={`${name}Locality`}
        type="hidden"
        value={hiddenFields.locality}
      />
      <input
        name={`${name}AdministrativeArea`}
        type="hidden"
        value={hiddenFields.administrativeArea}
      />
      <input
        name={`${name}PostalCode`}
        type="hidden"
        value={hiddenFields.postalCode}
      />
      <input
        name={`${name}CountryCode`}
        type="hidden"
        value={hiddenFields.countryCode}
      />
      <input
        name={`${name}Latitude`}
        type="hidden"
        value={hiddenFields.latitude}
      />
      <input
        name={`${name}Longitude`}
        type="hidden"
        value={hiddenFields.longitude}
      />
      <input name={`${name}Source`} type="hidden" value={hiddenFields.source} />
      <input
        name={`${name}ValidationStatus`}
        type="hidden"
        value={hiddenFields.validationStatus}
      />
      <input
        name={`${name}Structured`}
        type="hidden"
        value={hiddenFields.structured}
      />
    </label>
  );
}
