import { createWorkspaceSlug } from "./workspace.service";

export type WorkspaceBootstrapInput = {
  businessName: string;
  industry?: string;
  serviceArea?: string;
};

export function createWorkspaceBootstrapDefaults(input: WorkspaceBootstrapInput) {
  const workspaceName = input.businessName.trim();
  const slugBase = createWorkspaceSlug(workspaceName);

  return {
    workspace: {
      name: workspaceName,
      slug: `${slugBase}-${crypto.randomUUID().slice(0, 8)}`
    },
    businessProfile: {
      businessName: workspaceName,
      industry: input.industry?.trim() || null,
      description: null,
      serviceArea: input.serviceArea?.trim() || null,
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
          displayCurrency: "USD",
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
