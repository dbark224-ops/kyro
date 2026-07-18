import { settingsPanelHref } from "./settings-navigation";
import type { SettingsSection } from "./settings-shell";

export type SettingsSearchEntry = {
  description: string;
  developerOnly?: boolean;
  group: string;
  href: string;
  id: string;
  keywords: string;
  panel: string;
  section: SettingsSection;
  title: string;
};

type SettingsSearchEntryInput = Omit<SettingsSearchEntry, "href">;

const SEARCH_SYNONYM_GROUPS = [
  ["address", "addresses", "location", "locations"],
  [
    "appointment",
    "appointments",
    "booking",
    "bookings",
    "calendar",
    "event",
    "events",
    "schedule",
    "scheduling",
  ],
  [
    "bill",
    "billing",
    "card",
    "cards",
    "charge",
    "charges",
    "credit",
    "invoice",
    "invoices",
    "payment",
    "payments",
    "stripe",
  ],
  ["call", "calling", "calls", "phone", "telephone", "voice"],
  ["color", "colors", "colour", "colours"],
  [
    "connect",
    "connected",
    "connection",
    "integration",
    "integrations",
    "link",
    "linked",
    "sync",
  ],
  [
    "contact",
    "contacts",
    "employee",
    "employees",
    "staff",
    "team",
    "worker",
    "workers",
  ],
  ["customer", "customers", "client", "clients", "lead", "leads"],
  ["email", "emails", "gmail", "inbox", "mail", "outlook"],
  ["emergency", "escalate", "escalation", "urgent", "urgency"],
  ["message", "messages", "sms", "text", "texts"],
  ["missed", "noanswer", "unanswered", "voicemail", "overflow"],
  ["notification", "notifications", "reminder", "reminders", "alert", "alerts"],
  ["postcode", "postcodes", "postal", "zip", "zipcode"],
  ["pronounce", "pronunciation", "pronounciation", "spoken", "speech"],
  ["signature", "signatures", "signoff"],
  ["timezone", "timezones", "zone", "zones"],
] as const;

const STOP_WORDS = new Set([
  "a",
  "an",
  "change",
  "for",
  "my",
  "set",
  "setting",
  "settings",
  "the",
  "to",
  "update",
]);

const synonymsByToken = new Map<string, readonly string[]>();

for (const group of SEARCH_SYNONYM_GROUPS) {
  for (const token of group) {
    synonymsByToken.set(token, group);
  }
}

function searchEntry(input: SettingsSearchEntryInput): SettingsSearchEntry {
  return {
    ...input,
    href: settingsPanelHref(input.section, input.panel),
  };
}

export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  searchEntry({
    id: "business-profile",
    section: "general",
    panel: "business",
    group: "Business profile / Core profile",
    title: "Core business profile",
    description:
      "Business identity, industry, location and workspace defaults.",
    keywords: "company workspace profile setup basics trade occupation",
  }),
  searchEntry({
    id: "business-name",
    section: "general",
    panel: "business",
    group: "Business profile / Core profile",
    title: "Business name",
    description: "Set the customer-facing business name Kyro uses.",
    keywords: "company name trading name front facing workspace name",
  }),
  searchEntry({
    id: "account-holder-name",
    section: "general",
    panel: "business",
    group: "Business profile / Core profile",
    title: "Account holder name",
    description: "Set the Kyro user's first and last name.",
    keywords: "owner user first name last name personal details",
  }),
  searchEntry({
    id: "industry",
    section: "general",
    panel: "business",
    group: "Business profile / Core profile",
    title: "Industry and trade",
    description: "Describe the trade or service the business provides.",
    keywords:
      "industry business type plumber plumbing electrician builder occupation",
  }),
  searchEntry({
    id: "service-area",
    section: "general",
    panel: "business",
    group: "Business profile / Core profile",
    title: "Service area",
    description: "Choose the towns, cities or regions the business services.",
    keywords:
      "coverage area suburb suburbs city cities town towns region regions postcode zip travel",
  }),
  searchEntry({
    id: "workspace-timezone",
    section: "general",
    panel: "business",
    group: "Business profile / Core profile",
    title: "Workspace timezone",
    description:
      "Control the timezone used for schedules, activity and automation.",
    keywords: "time zone utc gmt local time daylight savings dst",
  }),
  searchEntry({
    id: "display-currency",
    section: "general",
    panel: "business",
    group: "Business profile / Core profile",
    title: "Display currency",
    description: "Choose the currency shown in Kyro.",
    keywords: "money dollar dollars aud usd currency symbol prices costs",
  }),
  searchEntry({
    id: "phone-region",
    section: "general",
    panel: "business",
    group: "Business profile / Core profile",
    title: "Phone country and region",
    description: "Set the default country used to format phone numbers.",
    keywords:
      "country code calling code mobile number format international region",
  }),
  searchEntry({
    id: "public-details",
    section: "general",
    panel: "public-details",
    group: "Business profile / Public details",
    title: "Public business details",
    description: "Manage the public address, email, phone and website.",
    keywords: "customer facing contact details listing profile",
  }),
  searchEntry({
    id: "business-address",
    section: "general",
    panel: "public-details",
    group: "Business profile / Public details",
    title: "Business address",
    description: "Set the public business address with address suggestions.",
    keywords:
      "street property office location google maps autocomplete verified",
  }),
  searchEntry({
    id: "public-email",
    section: "general",
    panel: "public-details",
    group: "Business profile / Public details",
    title: "Public email",
    description: "Set the customer-facing email address.",
    keywords: "contact email business mail reply address",
  }),
  searchEntry({
    id: "public-phone",
    section: "general",
    panel: "public-details",
    group: "Business profile / Public details",
    title: "Public phone numbers",
    description:
      "Manage the business phone and Kyro assistant number shown publicly.",
    keywords:
      "contact number assistant number operational number vapi twilio mobile telephone",
  }),
  searchEntry({
    id: "website",
    section: "general",
    panel: "public-details",
    group: "Business profile / Public details",
    title: "Business website",
    description: "Set the public website used by Kyro.",
    keywords: "url domain homepage web site link",
  }),
  searchEntry({
    id: "working-hours",
    section: "general",
    panel: "availability",
    group: "Business profile / Availability",
    title: "Working hours",
    description: "Set the days and times the team normally performs work.",
    keywords:
      "opening hours business hours active days availability holidays start end roster",
  }),
  searchEntry({
    id: "contact-hours",
    section: "general",
    panel: "availability",
    group: "Business profile / Availability",
    title: "Contact hours",
    description: "Set when customers can expect a response from the business.",
    keywords:
      "response hours office hours reachable available customer communication",
  }),
  searchEntry({
    id: "branding-logo",
    section: "general",
    panel: "branding-logo",
    group: "Business profile / Branding and logo",
    title: "Branding and logo",
    description: "Upload a logo and manage brand colours and style.",
    keywords: "brand image upload primary accent palette theme appearance",
  }),
  searchEntry({
    id: "brand-colours",
    section: "general",
    panel: "branding-logo",
    group: "Business profile / Branding and logo",
    title: "Primary and accent colours",
    description:
      "Choose the primary and accent colours used in generated material.",
    keywords: "color colour picker swatch hue hex branding pink blue",
  }),
  searchEntry({
    id: "brand-style-notes",
    section: "general",
    panel: "branding-logo",
    group: "Business profile / Branding and logo",
    title: "Brand style notes",
    description: "Describe how Kyro should present the business brand.",
    keywords: "tone visual identity look feel design guidance",
  }),
  searchEntry({
    id: "human-email-signature",
    section: "general",
    panel: "email-signature",
    group: "Business profile / Email signature",
    title: "Human email signature",
    description: "Edit the signature used for staff-written email.",
    keywords: "owner staff sign off logo email footer closing kind regards",
  }),
  searchEntry({
    id: "assistant-email-signature",
    section: "general",
    panel: "email-signature",
    group: "Business profile / Email signature",
    title: "AI assistant email signature",
    description: "Edit and enable the signature used by Kyro in email replies.",
    keywords: "automatic ai kyro sign off logo email footer disclosure",
  }),
  searchEntry({
    id: "workplace-contacts",
    section: "general",
    panel: "workplace-contacts",
    group: "Business profile / Workplace contacts",
    title: "Workplace contacts",
    description:
      "Manage owners, administrators, field staff and trusted team contacts.",
    keywords:
      "people person employee staff tradie pa boss team phone role vehicle registration",
  }),
  searchEntry({
    id: "staff-availability",
    section: "general",
    panel: "workplace-contacts",
    group: "Business profile / Workplace contacts",
    title: "Staff working hours",
    description:
      "Set individual active days and working hours for a workplace contact.",
    keywords:
      "employee roster availability schedule business default team hours",
  }),
  searchEntry({
    id: "urgent-escalation",
    section: "general",
    panel: "urgent-escalation",
    group: "Business profile / Urgent escalation",
    title: "Urgent escalation",
    description:
      "Control what requires stronger escalation and who receives it.",
    keywords:
      "emergency wake someone up urgent customer safety damage complaint vip owner callback",
  }),
  searchEntry({
    id: "escalation-steps",
    section: "general",
    panel: "urgent-escalation",
    group: "Business profile / Urgent escalation",
    title: "Escalation channels and delays",
    description:
      "Set the ordered SMS, email, app and phone-call escalation steps.",
    keywords:
      "retry recipient acknowledge acknowledgement primary fallback contact delay minutes",
  }),
  searchEntry({
    id: "escalation-hours",
    section: "general",
    panel: "urgent-escalation",
    group: "Business profile / Urgent escalation",
    title: "Escalation hours",
    description: "Choose when urgent escalation behaviour is active.",
    keywords: "always custom after hours overnight days start end window",
  }),
  searchEntry({
    id: "emergency-work",
    section: "general",
    panel: "emergency-work",
    group: "Business profile / Emergency work",
    title: "Emergency and after-hours work",
    description:
      "Configure emergency job availability, windows and pricing notes.",
    keywords:
      "urgent jobs weekend overnight callout rates surcharge availability",
  }),
  searchEntry({
    id: "inbound-email-sync",
    section: "integrations",
    panel: "inbound-email",
    group: "Connected accounts / Inbound email sync",
    title: "Inbound email sync",
    description: "Manage inbox polling, filtering, health and sync history.",
    keywords:
      "gmail outlook read inbox automatic polling manual check fetch mail receiver",
  }),
  searchEntry({
    id: "email-polling",
    section: "integrations",
    panel: "inbound-email",
    group: "Connected accounts / Inbound email sync",
    title: "Email polling frequency",
    description: "Choose how often Kyro checks connected inboxes.",
    keywords:
      "every 5 minutes interval automatic refresh check inbox sync mode",
  }),
  searchEntry({
    id: "email-quiet-hours",
    section: "integrations",
    panel: "inbound-email",
    group: "Connected accounts / Inbound email sync",
    title: "Email quiet hours",
    description: "Reduce or pause scheduled inbox checks overnight.",
    keywords: "night overnight polling cost pause start end active hours sleep",
  }),
  searchEntry({
    id: "email-filtering-rules",
    section: "integrations",
    panel: "inbound-email",
    group: "Connected accounts / Inbound email sync",
    title: "Email filtering and sender rules",
    description: "Manage which senders and messages Kyro promotes or ignores.",
    keywords:
      "spam filtered out emails allow block promote ignore classification rules",
  }),
  searchEntry({
    id: "outbound-channels",
    section: "integrations",
    panel: "outbound",
    group: "Connected accounts / Outbound communication",
    title: "Allowed outbound channels",
    description:
      "Choose which channels Kyro may use for customer communication.",
    keywords:
      "send email sms phone call message customer communication permissions",
  }),
  searchEntry({
    id: "outbound-approval",
    section: "integrations",
    panel: "outbound",
    group: "Connected accounts / Outbound communication",
    title: "Outbound approval rules",
    description:
      "Control which replies require approval before Kyro sends them.",
    keywords:
      "review confirm auto send autonomy permission drafts action queue",
  }),
  searchEntry({
    id: "follow-up-reminders",
    section: "integrations",
    panel: "outbound",
    group: "Connected accounts / Outbound communication",
    title: "Follow-up reminders",
    description:
      "Configure customer follow-up reminders and their default delay.",
    keywords: "chase customer reply followup follow up due wait days delay",
  }),
  searchEntry({
    id: "outbound-writing-style",
    section: "integrations",
    panel: "outbound",
    group: "Connected accounts / Outbound communication",
    title: "Outbound writing style",
    description: "Set the tone and style Kyro uses when drafting messages.",
    keywords:
      "tone wording email reply concise friendly professional voice style",
  }),
  searchEntry({
    id: "phone-sms",
    section: "integrations",
    panel: "phone-sms",
    group: "Connected accounts / Phone and SMS",
    title: "Phone and SMS number",
    description:
      "Set up the public Kyro assistant number and calling capabilities.",
    keywords:
      "buy purchase assign active number twilio vapi inbound outbound texting calling",
  }),
  searchEntry({
    id: "stripe-payments",
    section: "integrations",
    panel: "stripe",
    group: "Connected accounts / Stripe payments",
    title: "Stripe payments",
    description:
      "Connect or reset the account used to collect customer payments.",
    keywords:
      "stripe connect setup reset checkout customer payment links invoices money",
  }),
  searchEntry({
    id: "invoice-template",
    section: "integrations",
    panel: "stripe",
    group: "Connected accounts / Stripe payments",
    title: "Default invoice template",
    description: "Choose the default template used for invoices.",
    keywords: "billing document quote template dropdown receipts",
  }),
  searchEntry({
    id: "google-account",
    section: "integrations",
    panel: "email-accounts",
    group: "Connected accounts / Email accounts",
    title: "Google Workspace account",
    description: "Connect Gmail, Google Drive and Google Calendar permissions.",
    keywords:
      "google oauth reconnect disconnect permissions scopes mail drive calendar account",
  }),
  searchEntry({
    id: "microsoft-account",
    section: "integrations",
    panel: "email-accounts",
    group: "Connected accounts / Email accounts",
    title: "Microsoft Outlook account",
    description: "Connect Outlook email and Microsoft calendar permissions.",
    keywords:
      "microsoft office 365 oauth reconnect disconnect permissions scopes mail calendar account",
  }),
  searchEntry({
    id: "calendar-sync",
    section: "calendar",
    panel: "calendar-sync",
    group: "Calendar / Calendar sync",
    title: "Calendar sync",
    description: "Control Google or Outlook import and writeback behaviour.",
    keywords:
      "google outlook push pull external calendar connected account import export writeback",
  }),
  searchEntry({
    id: "calendar-defaults",
    section: "calendar",
    panel: "calendar-defaults",
    group: "Calendar / Calendar defaults",
    title: "Calendar defaults",
    description: "Set the default view, event duration and booking buffers.",
    keywords:
      "day week month appointment length one hour buffer travel schedule defaults",
  }),
  searchEntry({
    id: "calendar-sms-reminders",
    section: "notifications",
    panel: "calendar-notifications",
    group: "Notifications / Calendar SMS",
    title: "Calendar SMS reminders",
    description: "Text the user before upcoming calendar events.",
    keywords:
      "event alert phone text notification 15 minutes 1 hour 2 hours before",
  }),
  searchEntry({
    id: "daily-calendar-report",
    section: "notifications",
    panel: "calendar-notifications",
    group: "Notifications / Calendar SMS",
    title: "Daily calendar report",
    description: "Send a morning-of or night-before SMS schedule summary.",
    keywords:
      "daily agenda digest schedule summary morning evening night report text",
  }),
  searchEntry({
    id: "notification-recipient",
    section: "notifications",
    panel: "calendar-notifications",
    group: "Notifications / Calendar SMS",
    title: "Notification SMS recipient",
    description: "Choose the phone number that receives calendar reminders.",
    keywords: "mobile number destination recipient send alerts texts",
  }),
  searchEntry({
    id: "voice-assistant-style",
    section: "voice",
    panel: "voice-assistant",
    group: "Voice assistant / Voice assistant",
    title: "Voice assistant style",
    description: "Choose the assistant voice and conversational style.",
    keywords:
      "elevenlabs voice preset speaker sound demeanor detail warmth humour humor personality",
  }),
  searchEntry({
    id: "phone-assistant",
    section: "voice",
    panel: "phone-assistant",
    group: "Voice assistant / Phone assistant",
    title: "Phone assistant",
    description: "Enable and configure inbound, outbound and overflow calling.",
    keywords:
      "calls caller agent answer customer voicemail team internal infrastructure",
  }),
  searchEntry({
    id: "voicemail-overflow",
    section: "voice",
    panel: "voicemail-overflow",
    group: "Voice assistant / Voicemail overflow",
    title: "Voicemail overflow",
    description:
      "Find the forwarding number and missed-call setup instructions.",
    keywords:
      "missed call missed calls no answer unanswered conditional forwarding personal iphone mint live voicemail overflow destination",
  }),
  searchEntry({
    id: "pronunciation",
    section: "voice",
    panel: "pronunciation",
    group: "Voice assistant / Pronunciation",
    title: "Pronunciation dictionary",
    description: "Teach Kyro how to pronounce names, places and acronyms.",
    keywords:
      "say it like aliases phrase speech spoken word preview play pronunciation pronounciation",
  }),
  searchEntry({
    id: "usage-summary",
    section: "usage",
    panel: "usage-summary",
    group: "Usage and billing / Usage summary",
    title: "Usage summary and ledger",
    description: "Review metered work, customer charges and usage history.",
    keywords:
      "cost price margin spend ai calls sms polling events export breakdown this week month",
  }),
  searchEntry({
    id: "payment-method",
    section: "usage",
    panel: "payment-method",
    group: "Usage and billing / Payment method",
    title: "Kyro payment method",
    description:
      "Manage the card used for Kyro usage billing and free-trial status.",
    keywords:
      "credit card debit card last four trial subscription charge billing dunning failed payment",
  }),
  searchEntry({
    id: "developer-tools",
    section: "developer",
    panel: "developer-tools",
    group: "Developer settings / Developer tools",
    title: "Developer tools and diagnostics",
    description: "Open internal operational tools and diagnostic controls.",
    keywords: "dev testing debug smoke health tutorial internal diagnostics",
    developerOnly: true,
  }),
  searchEntry({
    id: "provider-ids",
    section: "developer",
    panel: "provider-ids",
    group: "Developer settings / Provider internals",
    title: "Voice provider IDs",
    description: "Manage internal assistant, number and provider identifiers.",
    keywords: "vapi twilio assistant id provider webhook tools secret internal",
    developerOnly: true,
  }),
];

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function searchableTokens(value: string) {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

function queryTokenVariants(token: string) {
  const variants = new Set<string>([token]);
  const synonymGroup = synonymsByToken.get(token);

  synonymGroup?.forEach((synonym) => variants.add(synonym));

  if (token.length > 4 && token.endsWith("s")) {
    variants.add(token.slice(0, -1));
  }

  return [...variants];
}

function editDistance(left: string, right: string) {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function isPrefixMatch(left: string, right: string) {
  return (
    Math.min(left.length, right.length) >= 3 &&
    Math.abs(left.length - right.length) <= 3 &&
    (left.startsWith(right) || right.startsWith(left))
  );
}

function tokenMatchScore(
  variants: readonly string[],
  titleTokens: readonly string[],
  keywordTokens: readonly string[],
  supportingTokens: readonly string[],
) {
  let best = 0;

  for (const variant of variants) {
    for (const token of titleTokens) {
      if (token === variant) best = Math.max(best, 42);
      else if (isPrefixMatch(token, variant)) {
        best = Math.max(best, 32);
      } else if (
        variant.length >= 5 &&
        Math.abs(token.length - variant.length) <= 1 &&
        editDistance(token, variant) <= 1
      ) {
        best = Math.max(best, 18);
      }
    }

    for (const token of keywordTokens) {
      if (token === variant) best = Math.max(best, 25);
      else if (isPrefixMatch(token, variant)) {
        best = Math.max(best, 18);
      } else if (
        variant.length >= 5 &&
        Math.abs(token.length - variant.length) <= 1 &&
        editDistance(token, variant) <= 1
      ) {
        best = Math.max(best, 11);
      }
    }

    for (const token of supportingTokens) {
      if (token === variant) best = Math.max(best, 14);
      else if (isPrefixMatch(token, variant)) {
        best = Math.max(best, 9);
      }
    }
  }

  return best;
}

export function searchSettings(
  query: string,
  options: { includeDeveloper?: boolean; limit?: number } = {},
) {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = searchableTokens(query).filter(
    (token) => !STOP_WORDS.has(token),
  );

  if (!normalizedQuery || queryTokens.length === 0) {
    return [];
  }

  return SETTINGS_SEARCH_ENTRIES.filter(
    (entry) => options.includeDeveloper || !entry.developerOnly,
  )
    .map((entry) => {
      const normalizedTitle = normalizeSearchText(entry.title);
      const normalizedKeywords = normalizeSearchText(entry.keywords);
      const normalizedSupporting = normalizeSearchText(
        `${entry.group} ${entry.description}`,
      );
      const titleTokens = searchableTokens(entry.title);
      const keywordTokens = searchableTokens(entry.keywords);
      const supportingTokens = searchableTokens(
        `${entry.group} ${entry.description}`,
      );
      let score = 0;

      if (normalizedTitle === normalizedQuery) score += 320;
      else if (normalizedTitle.startsWith(normalizedQuery)) score += 190;
      else if (normalizedTitle.includes(normalizedQuery)) score += 150;

      if (normalizedKeywords.includes(normalizedQuery)) score += 105;
      if (normalizedSupporting.includes(normalizedQuery)) score += 65;

      for (const token of queryTokens) {
        const tokenScore = tokenMatchScore(
          queryTokenVariants(token),
          titleTokens,
          keywordTokens,
          supportingTokens,
        );

        if (tokenScore === 0) {
          return { entry, score: 0 };
        }

        score += tokenScore;
        if (titleTokens.includes(token)) score += 14;
        else if (keywordTokens.includes(token)) score += 9;
        else if (supportingTokens.includes(token)) score += 5;
      }

      return { entry, score };
    })
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.title.localeCompare(right.entry.title),
    )
    .slice(0, options.limit ?? 8)
    .map((result) => result.entry);
}
