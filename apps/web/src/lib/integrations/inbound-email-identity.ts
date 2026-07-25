type InboundEmailIdentityInput = {
  bodyText?: string | null;
  fromEmail?: string | null;
  fromName?: string | null;
};

const SIGN_OFF_PATTERN =
  /^(kind regards|best regards|many thanks|regards|thank you|thanks|cheers|sincerely|best)[,!\.\s-]*(.*)$/i;

const NON_PERSON_PATTERN =
  /\b(?:accounts?|admin|billing|company|contractors?|customer care|helpdesk|inc|inquiries|inquiry|llc|ltd|marketing|notifications?|plumbing|pty|sales|services?|support|team)\b/i;

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function comparable(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function emailLocalPart(email: string | null | undefined) {
  return textValue(email)?.split("@")[0] ?? null;
}

function formatPersonName(value: string) {
  const name = value.replace(/\s+/g, " ").trim();

  if (!name || (!/^[A-Z\s.'-]+$/.test(name) && !/^[a-z\s.'-]+$/.test(name))) {
    return name;
  }

  return name
    .toLowerCase()
    .replace(
      /(^|[\s'-])([a-z])/g,
      (_, boundary: string, letter: string) =>
        `${boundary}${letter.toUpperCase()}`,
    );
}

function reliablePersonNameCandidate(
  value: string | null | undefined,
  fromEmail: string | null | undefined,
  source: "body" | "header",
) {
  const candidate = textValue(value)
    ?.replace(/^['"]+|['"]+$/g, "")
    .replace(/^[,;:\s-]+|[,;:\s.-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !candidate ||
    candidate.length > 70 ||
    candidate.includes("@") ||
    /https?:|www\.|<|>|\d/.test(candidate) ||
    /^(?:sent from|get outlook|download|view|unsubscribe)\b/i.test(candidate) ||
    NON_PERSON_PATTERN.test(candidate)
  ) {
    return null;
  }

  const words = candidate.split(/\s+/).filter(Boolean);

  if (
    words.length > 5 ||
    words.some((word) => !/^[A-Za-z][A-Za-z.'-]*$/.test(word))
  ) {
    return null;
  }

  const localPart = emailLocalPart(fromEmail);
  const matchesLocalPart =
    Boolean(localPart) &&
    comparable(candidate) === comparable(localPart as string);

  if (source === "header" && matchesLocalPart && words.length === 1) {
    return null;
  }

  return formatPersonName(candidate);
}

function signOffName(
  bodyText: string | null | undefined,
  fromEmail: string | null | undefined,
) {
  const body = textValue(bodyText);

  if (!body) {
    return null;
  }

  const currentMessage = body
    .split(/\n(?:On .+ wrote:|From:\s|-{2,}\s*Original Message\s*-{2,})/i)[0]
    .replace(/\r/g, "");
  const lines = currentMessage
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index].match(SIGN_OFF_PATTERN);

    if (!match) {
      continue;
    }

    const sameLineName = reliablePersonNameCandidate(
      match[2],
      fromEmail,
      "body",
    );

    if (sameLineName) {
      return sameLineName;
    }

    for (
      let candidateIndex = index + 1;
      candidateIndex < lines.length;
      candidateIndex += 1
    ) {
      const candidate = reliablePersonNameCandidate(
        lines[candidateIndex],
        fromEmail,
        "body",
      );

      if (candidate) {
        return candidate;
      }

      if (candidateIndex > index + 1) {
        break;
      }
    }
  }

  return null;
}

export function isSyntheticInboundEmailName(
  name: string | null | undefined,
  email: string | null | undefined,
) {
  const candidate = textValue(name);
  const localPart = emailLocalPart(email);

  return Boolean(
    candidate &&
    localPart &&
    comparable(candidate) === comparable(localPart) &&
    !candidate.includes(" "),
  );
}

export function resolveInboundEmailContactName({
  bodyText,
  fromEmail,
  fromName,
}: InboundEmailIdentityInput) {
  return (
    reliablePersonNameCandidate(fromName, fromEmail, "header") ??
    signOffName(bodyText, fromEmail)
  );
}
