export type VoiceCallProfileFacts = {
  address: string | null;
  email: string | null;
  name: string | null;
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = textValue(value);

    if (text) {
      return text;
    }
  }

  return null;
}

function cleanLabeledValue(value: string | null) {
  return (
    value
      ?.trim()
      .replace(/^["']+/, "")
      .replace(/["';,]+$/, "")
      .trim() || null
  );
}

function noteSegments(note: string) {
  return note
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function labeledNoteValue(note: string, labels: string[]) {
  const labelPattern = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const expression = new RegExp(`^(?:${labelPattern})\\s*:\\s*(.+)$`, "i");

  for (const segment of noteSegments(note)) {
    const match = segment.match(expression);

    if (match?.[1]) {
      return cleanLabeledValue(match[1].replace(/[.!?]+$/, ""));
    }
  }

  return null;
}

function usableName(value: string | null) {
  if (!value || value.length > 80 || /\d/.test(value)) {
    return null;
  }

  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");

  if (
    !normalized ||
    [
      "anonymous",
      "caller",
      "customer",
      "notprovided",
      "thecaller",
      "unknown",
      "unknowncaller",
      "unknownphonecaller",
    ].includes(normalized)
  ) {
    return null;
  }

  return value;
}

function usableAddress(value: string | null) {
  if (!value || value.length < 4 || value.length > 240) {
    return null;
  }

  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");

  return ["na", "none", "notprovided", "unknown"].includes(normalized)
    ? null
    : value;
}

function usableEmail(value: string | null) {
  if (!value || value.length > 254) {
    return null;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

export function isPlaceholderVoiceContactName(value: string | null) {
  if (!value) {
    return true;
  }

  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");

  return [
    "caller",
    "customer",
    "unknown",
    "unknowncaller",
    "unknownphonecaller",
  ].includes(normalized);
}

export function voiceCallProfileFacts(input: {
  args: Record<string, unknown>;
  note: string;
}): VoiceCallProfileFacts {
  const explicitName = firstText(
    input.args.contactName,
    input.args.callerName,
    input.args.customerName,
    input.args.name,
  );
  const explicitAddress = firstText(
    input.args.address,
    input.args.jobAddress,
    input.args.serviceAddress,
    input.args.location,
  );
  const explicitEmail = firstText(input.args.email, input.args.customerEmail);

  return {
    address: usableAddress(
      explicitAddress ??
        labeledNoteValue(input.note, [
          "job address",
          "service address",
          "site address",
          "address",
          "location",
        ]),
    ),
    email: usableEmail(
      explicitEmail ??
        labeledNoteValue(input.note, [
          "customer email",
          "caller email",
          "email",
        ]),
    ),
    name: usableName(
      explicitName ??
        labeledNoteValue(input.note, [
          "caller name",
          "customer name",
          "caller",
          "customer",
          "name",
        ]),
    ),
  };
}
