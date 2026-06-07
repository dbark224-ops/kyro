import { createWorkspaceSlug } from "./workspace.service";

export type WorkspaceBootstrapInput = {
  businessName: string;
  businessLocation?: string;
  country?: string;
  industry?: string;
  postcode?: string;
  publicEmail?: string;
  serviceArea?: string;
};

function textValue(value?: string) {
  return value?.trim() || null;
}

function countryDefaults(country?: string) {
  const normalized = country?.trim().toLowerCase();

  if (!normalized) {
    return {
      currency: "USD",
      phoneRegion: "US"
    };
  }

  if (["australia", "au", "aus"].includes(normalized)) {
    return {
      currency: "AUD",
      phoneRegion: "AU"
    };
  }

  if (["united kingdom", "uk", "gb", "great britain", "england"].includes(normalized)) {
    return {
      currency: "GBP",
      phoneRegion: "GB"
    };
  }

  if (["new zealand", "nz"].includes(normalized)) {
    return {
      currency: "NZD",
      phoneRegion: "NZ"
    };
  }

  if (["canada", "ca"].includes(normalized)) {
    return {
      currency: "CAD",
      phoneRegion: "CA"
    };
  }

  if (["usa", "us", "united states", "united states of america"].includes(normalized)) {
    return {
      currency: "USD",
      phoneRegion: "US"
    };
  }

  return {
    currency: "USD",
    phoneRegion: "US"
  };
}

export function createWorkspaceBootstrapDefaults(input: WorkspaceBootstrapInput) {
  const workspaceName = input.businessName.trim();
  const slugBase = createWorkspaceSlug(workspaceName);
  const country = textValue(input.country);
  const industry = textValue(input.industry);
  const location = textValue(input.businessLocation);
  const postcode = textValue(input.postcode);
  const publicEmail = textValue(input.publicEmail);
  const fallbackServiceArea =
    [location, postcode, country].filter(Boolean).join(", ") || null;
  const serviceArea = textValue(input.serviceArea) ?? fallbackServiceArea;
  const defaults = countryDefaults(country ?? undefined);

  return {
    workspace: {
      name: workspaceName,
      slug: `${slugBase}-${crypto.randomUUID().slice(0, 8)}`
    },
    businessProfile: {
      businessName: workspaceName,
      industry,
      description: null,
      serviceArea,
      toneOfVoice: "Clear, helpful, and professional.",
      defaultReplyInstructions:
        "Be concise, capture lead details, and avoid committing to pricing or dates without business owner confirmation."
    },
    policies: [
      {
        policyType: "outbound_email",
        settings: {
          mode: "require_approval",
          quietHoursEnabled: false,
          trustedContactOnly: false
        }
      },
      {
        policyType: "outbound_sms",
        settings: {
          mode: "require_approval",
          quietHoursEnabled: true,
          trustedContactOnly: true
        }
      },
      {
        policyType: "ai_actions",
        settings: {
          requireApprovalForHighRisk: true,
          allowAutonomousLowRiskActions: false
        }
      },
      {
        policyType: "model_routing",
        settings: {
          allowedModelTiers: ["low_cost", "balanced", "high_capability"],
          preferLowerCostForRoutineTasks: true
        }
      },
      {
        policyType: "workspace_general",
        settings: {
          businessProfile: {
            businessName: workspaceName,
            businessAddress: [location, postcode, country].filter(Boolean).join(", "),
            industry: industry ?? "",
            operatingCountry: country ?? "",
            publicEmail: publicEmail ?? "",
            serviceArea: serviceArea ?? "",
            servicePostcodes: postcode ?? "",
            serviceSuburbs: location ?? "",
            brandStyle: "Clear, helpful, and professional."
          },
          defaultPhoneRegion: defaults.phoneRegion,
          displayCurrency: defaults.currency,
          exchangeRateProvider: "placeholder_static",
          exchangeRateUpdatedAt: null,
          timeZone: "UTC"
        }
      },
      {
        policyType: "document_templates",
        settings: {
          accentTheme: "graphite",
          currency: "AUD",
          footerText:
            "Thank you for the opportunity. Please review the scope, inclusions, exclusions, and pricing before approving any work.",
          paymentTerms:
            "Payment terms, deposit requirements, and final pricing must be confirmed before this quote is sent to a customer.",
          quoteStyleDirection:
            "Clean, professional, service-business quote. Keep it practical, trustworthy, and easy for a customer to scan on mobile or PDF.",
          showPreparedBy: true,
          validityDays: 14
        }
      },
      {
        policyType: "usage_budget",
        settings: {
          alertThresholdPercent: 80,
          hardStopEnabled: false
        }
      }
    ],
    entitlements: [
      { entitlementKey: "can_use_ai_chat", value: true, source: "bootstrap" },
      { entitlementKey: "can_generate_documents", value: true, source: "bootstrap" },
      { entitlementKey: "can_generate_images", value: true, source: "bootstrap" },
      { entitlementKey: "can_auto_send_email", value: false, source: "bootstrap" },
      { entitlementKey: "can_auto_send_sms", value: false, source: "bootstrap" },
      {
        entitlementKey: "allowed_model_tiers",
        value: ["low_cost", "balanced", "high_capability"],
        source: "bootstrap"
      }
    ],
    budget: {
      period: "monthly",
      softLimit: "75",
      hardLimit: null,
      currency: "USD",
      settings: {
        notifyAtPercent: 80,
        requireApprovalAboveEstimatedCost: 5
      }
    },
    pricingRules: [
      {
        service: "llm",
        provider: "openai",
        model: null,
        usageType: "llm_input_tokens",
        unit: "token",
        markupType: "percentage",
        markupValue: "25",
        currency: "USD"
      },
      {
        service: "llm",
        provider: "openai",
        model: null,
        usageType: "llm_output_tokens",
        unit: "token",
        markupType: "percentage",
        markupValue: "25",
        currency: "USD"
      },
      {
        service: "messaging",
        provider: "twilio",
        model: null,
        usageType: "sms_segments",
        unit: "segment",
        markupType: "percentage",
        markupValue: "25",
        currency: "USD"
      }
    ]
  };
}
