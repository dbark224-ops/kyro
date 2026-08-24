import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRepoFile, repoSourceFiles } from "../testing/repo-files";

/**
 * A log line nobody can act on.
 *
 * Sixteen call sites logged a message and the raw error and nothing else, so
 * when one fired in production there was no way to tell which workspace,
 * contact or event it happened to. Ten of them were reported; the other six
 * turned up on a sweep, which is why this is a test rather than a one-off tidy.
 *
 * Two rules, and the second matters more than the first. Every log gets a
 * context object, and that object carries identifiers only. Logs may be shipped
 * to a third party later, and Kyro handles customer messages, phone numbers and
 * addresses -- none of which should leave our own infrastructure.
 */
const FILES = repoSourceFiles("apps/web/src/**/*.ts", "apps/web/src/**/*.tsx");
const shortName = (file: string) => file.replace("apps/web/src/", "");

/**
 * Blanks out quoted text so only real code is searched.
 *
 * "Unable to verify inquiry address: ..." contains `address:` and is a message,
 * not a key. Without this the check reports the safest call sites as the leaky
 * ones, which is how a rule like this gets switched off.
 *
 * Deliberately naive about escaped quotes: a stray one can only cause a false
 * positive, and the failure names the file and the key, so that is a minute to
 * dismiss rather than a silent gap.
 */
function withoutStringLiterals(code: string) {
  const DOUBLE = /"[^"]*"/g;
  const SINGLE = /'[^']*'/g;
  const TEMPLATE = new RegExp("`[^`]*`", "g");

  return code
    .replace(DOUBLE, '""')
    .replace(SINGLE, "''")
    .replace(TEMPLATE, "``");
}

describe("a log line says who it happened to", () => {
  it("never passes a bare error as the second argument", () => {
    const bare: string[] = [];

    for (const file of FILES) {
      readRepoFile(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          // console.error("...", somethingThatIsNotAnObject
          if (
            /console\.(error|warn)\(\s*(?:"|`)[^"`]*(?:"|`)\s*,\s*[^\s{)]/.test(
              line,
            )
          ) {
            bare.push(`${shortName(file)}:${index + 1}`);
          }
        });
    }

    assert.deepEqual(
      bare,
      [],
      `these log a raw value instead of a context object:\n  ${bare.join("\n  ")}`,
    );
  });
});

describe("and never says who they are", () => {
  /**
   * Keys that would put a customer into a log. `name` is deliberately absent:
   * `businessName` and `providerName` are common and harmless, and a rule that
   * cries wolf gets deleted by the next person who trips it.
   */
  const FORBIDDEN =
    /\b(phone|phoneNumber|email|emailAddress|address|body|bodyText|messageBody|contactName|customerName|fromNumber|toNumber)\s*:/;

  it("keeps customer details out of the context object", () => {
    const leaks: string[] = [];

    for (const file of FILES) {
      const source = readRepoFile(file);

      // Walk each console.error/warn call and read only its own parentheses, so
      // a key belonging to the next statement cannot raise a false alarm.
      for (const match of source.matchAll(/console\.(error|warn)\(/g)) {
        const start = match.index ?? 0;
        let depth = 0;
        let end = source.length;

        for (let i = start; i < source.length; i += 1) {
          if (source[i] === "(") depth += 1;

          if (source[i] === ")") {
            depth -= 1;

            if (depth === 0) {
              end = i;
              break;
            }
          }
        }

        const found = withoutStringLiterals(source.slice(start, end)).match(
          FORBIDDEN,
        );

        if (found) {
          const line = source.slice(0, start).split(/\r?\n/).length;

          leaks.push(`${shortName(file)}:${line} (${found[1]})`);
        }
      }
    }

    assert.deepEqual(
      leaks,
      [],
      `these would put customer details in a log:\n  ${leaks.join("\n  ")}`,
    );
  });
});
