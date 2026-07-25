const ACRONYM_WORDS = new Set([
  "ABN",
  "AC",
  "AI",
  "CRM",
  "EV",
  "GST",
  "HVAC",
  "PDF",
  "SMS",
  "TV",
  "URL",
]);

function normalizeWhitespace(value: string) {
  return value.replace(/[_\s]+/g, " ").trim();
}

function titleCasePart(value: string) {
  if (!value) {
    return value;
  }

  if (/\d/.test(value) && !/[a-z]/i.test(value)) {
    return value;
  }

  const upper = value.toUpperCase();

  if (ACRONYM_WORDS.has(upper)) {
    return upper;
  }

  if (value.length <= 4 && value === upper) {
    return value;
  }

  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

export function titleCaseBusinessText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = normalizeWhitespace(value);

  if (!normalized) {
    return null;
  }

  return normalized.replace(/[a-zA-Z0-9][a-zA-Z0-9'/-]*/g, (word) =>
    word
      .split(/([/-])/)
      .map((part) =>
        part === "/" || part === "-" ? part : titleCasePart(part),
      )
      .join(""),
  );
}

function compactTitle(value: string, maxWords = 7) {
  const words = normalizeWhitespace(value).split(" ").filter(Boolean);

  return words.length > maxWords ? words.slice(0, maxWords).join(" ") : value;
}

function firstName(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "");

  if (!normalized || normalized.includes("@")) {
    return null;
  }

  return normalized.split(" ")[0]?.replace(/[^a-z0-9'-]/gi, "") || null;
}

export function formatServiceType(value: string | null | undefined) {
  const title = titleCaseBusinessText(
    normalizeWhitespace(value ?? "")
      .replace(
        /\b(?:email|e-mail|message|inquiry|enquiry|request|lead)\b.*$/i,
        "",
      )
      .trim(),
  );

  return title ? compactTitle(title, 5) : null;
}

export function formatLeadTitle(
  value: string | null | undefined,
  contactName?: string | null,
) {
  const raw = normalizeWhitespace(value ?? "");

  if (!raw) {
    return null;
  }

  const sourceMatch = raw.match(
    /^(.+?)\s+(?:email|e-mail|message|inquiry|enquiry|request|lead)\s+from\s+(.+)$/i,
  );

  if (sourceMatch) {
    const base = titleCaseBusinessText(sourceMatch[1]) ?? "Inquiry";
    const name = firstName(sourceMatch[2]) ?? firstName(contactName);
    return compactTitle([base, name].filter(Boolean).join(" "), 7);
  }

  const titled = titleCaseBusinessText(raw);

  return titled ? compactTitle(titled, 7) : null;
}

export function buildEmailLeadTitle({
  contactName,
  serviceType,
  subject,
}: {
  contactName?: string | null;
  serviceType?: string | null;
  subject?: string | null;
}) {
  const service = formatServiceType(serviceType);
  const name = firstName(contactName);

  if (service) {
    return [service, name].filter(Boolean).join(" ");
  }

  return (
    formatLeadTitle(subject, contactName) ??
    (name ? `Email ${name}` : "Email Inquiry")
  );
}
