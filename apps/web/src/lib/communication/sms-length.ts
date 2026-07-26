/**
 * How long an SMS actually is, and where to break it.
 *
 * Nothing in the app knew this. Kyro's own replies to the owner were capped by
 * slicing the string, so asking "what is your drafted reply" over SMS returned
 * an answer that stopped mid-sentence. A hard slice is the worst option
 * available: it costs the same to send as a clean split and loses the end of
 * the message.
 *
 * Two encodings matter. If every character is in the GSM 03.38 alphabet the
 * carrier packs 7 bits each and a single message holds 160; otherwise the whole
 * message goes as UCS-2 and holds 70. Once a message needs more than one part,
 * each part gives up 7 characters to the concatenation header -- 153 and 67 --
 * so a 161-character GSM message costs two segments, not one and a bit.
 *
 * One curly quote or emoji anywhere drops the whole message to UCS-2 and less
 * than half the room, which is why smartQuotesToPlain exists.
 */
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

/** These exist in GSM-7 only as an escape pair, so each one costs two. */
const GSM_EXTENDED = "^{}\\[~]|€";

export const SMS_LIMITS = {
  gsm: { concatenated: 153, single: 160 },
  ucs2: { concatenated: 67, single: 70 },
} as const;

export function isGsmSevenBit(text: string) {
  return [...text].every(
    (character) =>
      GSM_BASIC.includes(character) || GSM_EXTENDED.includes(character),
  );
}

/**
 * Billable length. GSM extended characters cost two, and a UCS-2 message is
 * billed in UTF-16 code units -- so an emoji outside the BMP is two, not one,
 * which is why this counts `.length` rather than iterating code points.
 */
export function smsCharacterCount(text: string) {
  if (!isGsmSevenBit(text)) {
    return text.length;
  }

  return [...text].reduce(
    (total, character) => total + (GSM_EXTENDED.includes(character) ? 2 : 1),
    0,
  );
}

export function smsSegmentCount(text: string) {
  if (text.length === 0) {
    return 0;
  }

  const limits = isGsmSevenBit(text) ? SMS_LIMITS.gsm : SMS_LIMITS.ucs2;
  const length = smsCharacterCount(text);

  if (length <= limits.single) {
    return 1;
  }

  return Math.ceil(length / limits.concatenated);
}

/**
 * The budget to give a model writing an SMS, in characters.
 *
 * Expressed as "how many segments are we willing to pay for", because that is
 * the decision being made. Assumes GSM-7: a message that turns out to need
 * UCS-2 will run to more segments than planned, which costs a little more but
 * never truncates.
 */
export function smsCharacterBudget(segments: number) {
  if (segments <= 1) {
    return SMS_LIMITS.gsm.single;
  }

  return SMS_LIMITS.gsm.concatenated * segments;
}

/** Curly quotes and dashes force UCS-2 and less than half the room. */
export function smartQuotesToPlain(text: string) {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...");
}

function breakPoint(text: string, limit: number) {
  const window = text.slice(0, limit);

  // Prefer the end of a sentence, then a line, then a word. Anything else
  // splits a word across two messages, which reads like a fault.
  for (const pattern of [/[.!?]\s(?=[^]*$)/g, /\n(?=[^]*$)/g, /\s(?=[^]*$)/g]) {
    let index = -1;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(window))) {
      index = match.index + match[0].length;
    }

    if (index > limit * 0.5) {
      return index;
    }
  }

  return limit;
}

/**
 * Split into whole messages that each fit, breaking at sentence boundaries.
 *
 * Returns the text unsplit when it already fits, so the common case allocates
 * nothing. `maxParts` is a backstop, not a target -- the last part absorbs the
 * remainder rather than dropping it, because a slightly long final message
 * still arrives whereas a truncated one is simply wrong.
 */
export function splitIntoSmsMessages(text: string, maxParts = 2) {
  const trimmed = text.trim();

  if (!trimmed) {
    return [];
  }

  const limits = isGsmSevenBit(trimmed) ? SMS_LIMITS.gsm : SMS_LIMITS.ucs2;

  if (smsCharacterCount(trimmed) <= limits.single) {
    return [trimmed];
  }

  const parts: string[] = [];
  let rest = trimmed;

  while (rest && parts.length < maxParts - 1) {
    if (smsCharacterCount(rest) <= limits.concatenated) {
      break;
    }

    const at = breakPoint(rest, limits.concatenated);
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }

  if (rest) {
    parts.push(rest);
  }

  return parts;
}
