"use client";

import { SignupPlaceAutocompleteField } from "../components/signup-place-autocomplete-field";
import { OPERATING_COUNTRY_OPTIONS } from "../../lib/workspace/operating-countries";
import { useState } from "react";

export function OnboardingBusinessBasicsFields() {
  const [operatingCountry, setOperatingCountry] = useState("");

  return (
    <div className="auth-form-grid">
      <label>
        Business name
        <input name="businessName" type="text" autoComplete="organization" required />
      </label>
      <label>
        Industry
        <input
          name="industry"
          type="text"
          placeholder="Plumbing, tiling, landscaping..."
        />
      </label>
      <label>
        Operating country
        <select
          name="country"
          required
          defaultValue=""
          onChange={(event) => setOperatingCountry(event.currentTarget.value)}
        >
          <option value="" disabled>
            Select operating country
          </option>
          {OPERATING_COUNTRY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <SignupPlaceAutocompleteField
        key={`location-${operatingCountry}`}
        country={operatingCountry}
        label="Location"
        mode="location"
        name="businessLocation"
        placeholder="Suburb, city, or operating region"
      />
      <SignupPlaceAutocompleteField
        key={`postcode-${operatingCountry}`}
        autoComplete="postal-code"
        country={operatingCountry}
        label="Postcode / ZIP"
        mode="postcode"
        name="postcode"
      />
      <label>
        Service area
        <input name="serviceArea" type="text" placeholder="City, region, or remote" />
      </label>
    </div>
  );
}
