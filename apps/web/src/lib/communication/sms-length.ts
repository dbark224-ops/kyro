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

/**
 * Markdown does not render on a messaging channel, so it arrives as itself.
 *
 * Kyro's replies to the owner were written as if for a screen: 21 of the 807
 * messages ever sent went out with `**bold**` in them, which the owner reads as
 * literal asterisks, and 236 characters were spent on markup nobody sees.
 *
 * WhatsApp does have bold, but it wants a single asterisk, so `**x**` is just
 * as broken there as on SMS. Passing "*" converts to it; passing nothing
 * removes the markup, which is the only correct answer for SMS.
 *
 * Deliberately conservative. Only the constructs that actually turned up are
 * handled, plus links, which would otherwise hide the URL. A lone asterisk is
 * left alone: guessing at italics risks mangling a message that simply
 * contains an asterisk.
 */
export function markdownToMessageText(text: string, boldMarker = "") {
  return (
    text
      // Headings carry no weight here; the line is just a line.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/\*\*([^*]+)\*\*/g, `${boldMarker}$1${boldMarker}`)
      .replace(/__([^_]+)__/g, `${boldMarker}$1${boldMarker}`)
      // The URL is the useful half, and it has to survive.
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2")
      .replace(/`([^`]+)`/g, "$1")
  );
}

/**
 * Swap characters that force UCS-2 for their GSM-7 equivalents.
 *
 * Curly quotes and dashes are what models produce, and one anywhere costs more
 * than half the room. Superscripts are what this trade produces: after the
 * quotes and markdown were dealt with, 24 of 812 sent messages were still
 * UCS-2, and 22 of those were a single "m²" in an inquiry alert about retiling
 * a floor. Emoji, which was the obvious suspect, caused none of them.
 *
 * Every substitution here means the same thing to a reader -- "4m2" is how the
 * measurement gets typed anyway -- so nothing is lost for the room gained.
 */
export function smartQuotesToPlain(text: string) {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/¹/g, "1")
    .replace(/²/g, "2")
    .replace(/³/g, "3")
    // Invisible, and it costs exactly as much as a visible character would.
    .replace(/\u00a0/g, " ");
}

/**
 * Move a break back to a character boundary.
 *
 * The UCS-2 concatenated limit is 67, an odd number, and every emoji is two
 * UTF-16 code units. So a run of emoji with nowhere to break falls through to a
 * raw slice at 67 and cuts one in half: the first message ends with a lone
 * surrogate and the second starts with its other half, and both arrive as a
 * replacement character. Three of five emoji samples did this.
 *
 * Snapping to a grapheme keeps flags, skin tones and family sequences whole
 * too, which the surrogate check alone would still tear apart. Where
 * Intl.Segmenter is missing the surrogate pair is still repaired, since that is
 * the case that produces invalid text rather than merely ugly text.
 */
function snapToCharacterBoundary(text: string, index: number) {
  if (index <= 0 || index >= text.length) {
    return index;
  }

  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;

  if (segmenter) {
    let boundary = 0;

    for (const { index: start } of segmenter.segment(text)) {
      if (start >= index) {
        break;
      }

      boundary = start;
    }

    // Never return 0 -- a break at the start makes no progress and would spin.
    return boundary > 0 ? boundary : index;
  }

  const high = text.charCodeAt(index - 1);
  const low = text.charCodeAt(index);

  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff
    ? index - 1
    : index;
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

  return snapToCharacterBoundary(text, limit);
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
