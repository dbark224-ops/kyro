"use client";

import { useRef, useState } from "react";

type ReplyGeneratorProps = {
  bodyFieldName?: string;
  conversationId?: string;
  skippedEmailId?: string;
  subjectFieldName?: string;
};

type DraftResponse = {
  body?: string;
  error?: string;
  subject?: string;
};

function setFormField(
  form: HTMLFormElement,
  selector: string,
  value: string | undefined,
) {
  if (!value) {
    return;
  }

  const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    selector,
  );

  if (!field) {
    return;
  }

  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function fieldSelector(tagName: "input" | "textarea", fieldName: string) {
  return `${tagName}[name="${fieldName.replace(/"/g, '\\"')}"]`;
}

export function ReplyGenerator({
  bodyFieldName = "body",
  conversationId,
  skippedEmailId,
  subjectFieldName = "subject",
}: ReplyGeneratorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  async function generateReply() {
    const form = rootRef.current?.closest("form");

    if (!form) {
      setStatus("Could not find the reply form.");
      return;
    }

    setIsGenerating(true);
    setStatus("Generating reply...");

    try {
      const response = await fetch("/api/inbox/reply-draft", {
        body: JSON.stringify({
          conversationId,
          prompt,
          skippedEmailId,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json()) as DraftResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to generate reply.");
      }

      setFormField(
        form,
        fieldSelector("input", subjectFieldName),
        payload.subject,
      );
      setFormField(
        form,
        fieldSelector("textarea", bodyFieldName),
        payload.body,
      );
      setStatus("Draft inserted. Give it a quick check before sending.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to generate reply.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="reply-generator" ref={rootRef}>
      <label className="reply-generator-input">
        <span>Prompt / generate with AI</span>
        <textarea
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Add notes for Kyro, then regenerate the email body..."
          value={prompt}
        />
      </label>
      <button
        className="secondary-button compact"
        aria-busy={isGenerating}
        disabled={isGenerating}
        onClick={generateReply}
        type="button"
      >
        {isGenerating ? (
          <span className="settings-submit-spinner" aria-hidden="true" />
        ) : null}
        {isGenerating ? "Generating..." : "Generate"}
      </button>
      {status ? <span className="reply-generator-status">{status}</span> : null}
    </div>
  );
}
