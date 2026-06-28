"use client";

import type {
  AddressSuggestion,
  StructuredAddress,
} from "../../lib/addresses/types";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type SignupPlaceAutocompleteFieldProps = {
  autoComplete?: string;
  className?: string;
  country?: string;
  error?: string;
  label: ReactNode;
  mode: "location" | "postcode";
  name: string;
  onValueChange?: () => void;
  placeholder?: string;
  required?: boolean;
};

function hiddenValue(value: string | number | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function newSessionToken() {
  return crypto.randomUUID();
}

function serializePlace(place: StructuredAddress | null) {
  return place ? JSON.stringify(place) : "";
}

function selectedValue(
  mode: SignupPlaceAutocompleteFieldProps["mode"],
  place: StructuredAddress,
  suggestion: AddressSuggestion,
) {
  if (mode === "postcode") {
    return place.postalCode ?? suggestion.mainText;
  }

  return place.formattedAddress ?? suggestion.description;
}

export function SignupPlaceAutocompleteField({
  autoComplete,
  className,
  country,
  error,
  label,
  mode,
  name,
  onValueChange,
  placeholder,
  required = false,
}: SignupPlaceAutocompleteFieldProps) {
  const id = useId();
  const listId = `${id}-place-suggestions`;
  const errorId = error ? `${name}-error` : undefined;
  const [value, setValue] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<StructuredAddress | null>(
    null,
  );
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [shouldSearch, setShouldSearch] = useState(false);
  const sessionTokenRef = useRef(newSessionToken());

  const hiddenFields = useMemo(
    () => ({
      administrativeArea: selectedPlace?.administrativeArea ?? "",
      countryCode: selectedPlace?.countryCode ?? "",
      formatted: selectedPlace?.formattedAddress ?? "",
      latitude: hiddenValue(selectedPlace?.latitude),
      locality: selectedPlace?.locality ?? "",
      longitude: hiddenValue(selectedPlace?.longitude),
      placeId: selectedPlace?.placeId ?? "",
      postalCode: selectedPlace?.postalCode ?? "",
      source: selectedPlace?.source ?? "manual",
      structured: serializePlace(selectedPlace),
      validationStatus: selectedPlace?.validationStatus ?? "",
    }),
    [selectedPlace],
  );

  useEffect(() => {
    if (!shouldSearch) {
      return;
    }

    const query = value.trim();

    if (query.length < 3) {
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
          type: "regions",
        });

        if (country) {
          params.set("country", country);
        }

        const response = await fetch(
          `/api/auth/create-account/places/autocomplete?${params}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as {
          data?: AddressSuggestion[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to search locations.");
        }

        setSuggestions(payload.data ?? []);
        setIsOpen(Boolean(payload.data?.length));
        setStatus("idle");
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }

        setSuggestions([]);
        setIsOpen(false);
        setStatus("error");
        setMessage(
          fetchError instanceof Error
            ? fetchError.message
            : "Location search is unavailable.",
        );
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [country, mode, shouldSearch, value]);

  function updateValue(nextValue: string) {
    setValue(nextValue);
    onValueChange?.();
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
      const response = await fetch(
        `/api/auth/create-account/places/place?${params}`,
      );
      const payload = (await response.json()) as {
        data?: StructuredAddress;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Unable to load location details.");
      }

      setSelectedPlace(payload.data);
      updateValue(selectedValue(mode, payload.data, suggestion));
      setSuggestions([]);
      setShouldSearch(false);
      setStatus("idle");
      sessionTokenRef.current = newSessionToken();
    } catch (selectError) {
      setSelectedPlace(null);
      setStatus("error");
      setMessage(
        selectError instanceof Error
          ? selectError.message
          : "Unable to select this location.",
      );
    }
  }

  return (
    <label
      className={[
        "address-autocomplete-field",
        "signup-place-autocomplete-field",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
      <span className="address-autocomplete-control">
        <input
          aria-autocomplete="list"
          aria-controls={listId}
          aria-describedby={errorId}
          aria-expanded={isOpen}
          aria-invalid={Boolean(error)}
          autoComplete={autoComplete}
          name={name}
          onBlur={() => {
            window.setTimeout(() => setIsOpen(false), 150);
          }}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;

            setShouldSearch(true);
            setSelectedPlace(null);
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
          value={value}
        />
        {status === "loading" ? (
          <span className="address-autocomplete-spinner" aria-hidden="true" />
        ) : null}
        {isOpen ? (
          <span className="address-autocomplete-menu" id={listId} role="listbox">
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
      {error ? (
        <span className="auth-field-error" id={errorId}>
          {error}
        </span>
      ) : null}
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
      <input name={`${name}Locality`} type="hidden" value={hiddenFields.locality} />
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
      <input name={`${name}Latitude`} type="hidden" value={hiddenFields.latitude} />
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
