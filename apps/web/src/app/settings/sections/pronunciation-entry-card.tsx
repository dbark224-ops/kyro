import {
  PronunciationAutosaveForm,
} from "../pronunciation-autosave-form";
import {
  PronunciationPreviewPlayer,
} from "../pronunciation-preview-player";
import {
  autosavePronunciationEntryAction,
  ignorePronunciationEntryAction,
} from "../actions";
import {
  formatDate,
  formatLabel,
} from "../shared";
import {
  type AssistantPronunciationEntry,
  defaultPronunciationHint,
  formatPronunciationAliases,
  PRONUNCIATION_CATEGORIES,
} from "../../../lib/assistant/pronunciation";
/**
 * The Pronunciation entry section of the Settings screen.
 *
 * Moved out of settings/page.tsx unchanged.
 */

export function pronunciationUsageLabel(entry: AssistantPronunciationEntry) {
  const usage =
    entry.usageCount === 1 ? "Used once" : `Used ${entry.usageCount} times`;

  return entry.lastSeenAt
    ? `${usage} - last ${formatDate(entry.lastSeenAt)}`
    : usage;
}

export function pronunciationEntrySourceLabel(entry: AssistantPronunciationEntry) {
  return entry.source === "manual"
    ? "Manual entry"
    : entry.source === "assistant"
      ? "Assistant updated"
      : "Auto-added";
}

export function pronunciationHintValue(entry: AssistantPronunciationEntry) {
  return entry.pronunciationHint ?? defaultPronunciationHint(entry.phrase);
}

export function PronunciationEntryCard({
  entry,
}: Readonly<{
  entry: AssistantPronunciationEntry;
}>) {
  return (
    <article className="pronunciation-entry-card">
      <div className="pronunciation-entry-row">
        <PronunciationAutosaveForm
          action={autosavePronunciationEntryAction}
          className="pronunciation-entry-inline-form"
        >
          <input name="entryId" type="hidden" value={entry.id} />
          <label className="pronunciation-row-field">
            <span>Phrase</span>
            <input defaultValue={entry.phrase} name="phrase" required />
          </label>
          <label className="pronunciation-row-field pronunciation-hint-field">
            <span>Say it like</span>
            <input
              defaultValue={pronunciationHintValue(entry)}
              name="pronunciationHint"
            />
          </label>
          <label className="pronunciation-row-field pronunciation-category-field">
            <span>Category</span>
            <select defaultValue={entry.category} name="category">
              {PRONUNCIATION_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {formatLabel(category)}
                </option>
              ))}
            </select>
          </label>
          <label className="pronunciation-row-field pronunciation-aliases-field">
            <span>Aliases</span>
            <input
              defaultValue={formatPronunciationAliases(entry.aliases)}
              name="aliases"
            />
          </label>
          <PronunciationPreviewPlayer
            entryId={entry.id}
            fallbackSrc={`/api/assistant/pronunciation/preview?entryId=${entry.id}`}
          />
          <div className="pronunciation-row-meta">
            <small>
              {pronunciationEntrySourceLabel(entry)} -{" "}
              {pronunciationUsageLabel(entry)}
            </small>
          </div>
        </PronunciationAutosaveForm>

        <form
          action={ignorePronunciationEntryAction}
          className="pronunciation-entry-remove-form"
        >
          <input name="entryId" type="hidden" value={entry.id} />
          <input name="phrase" type="hidden" value={entry.phrase} />
          <input
            name="pronunciationHint"
            type="hidden"
            value={pronunciationHintValue(entry)}
          />
          <input name="category" type="hidden" value={entry.category} />
          <input
            name="aliases"
            type="hidden"
            value={formatPronunciationAliases(entry.aliases)}
          />
          <button
            aria-label={`Remove ${entry.phrase}`}
            className="pronunciation-icon-button danger"
            title="Remove pronunciation"
            type="submit"
          >
            <span aria-hidden="true">X</span>
          </button>
        </form>
      </div>
    </article>
  );
}
