"use client";

import { useId, useState } from "react";

import { sendSkippedEmailReplyAction } from "./actions";
import { ReplyGenerator } from "./reply-generator";

type SkippedEmailReplyDetailsProps = {
  defaultSubject: string;
  emailId: string;
  replyRedirectHref: string;
};

export function SkippedEmailReplyDetails({
  defaultSubject,
  emailId,
  replyRedirectHref,
}: SkippedEmailReplyDetailsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const submissionKey = useId();

  return (
    <details
      className="skipped-email-reply"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary>Reply</summary>
      {isOpen ? (
        <form
          action={sendSkippedEmailReplyAction}
          className="skipped-email-reply-form"
        >
          <input name="eventId" type="hidden" value={emailId} />
          <input name="redirectTo" type="hidden" value={replyRedirectHref} />
          <input name="submissionKey" type="hidden" value={submissionKey} />
          <label className="skipped-email-reply-subject">
            <span>Subject</span>
            <input defaultValue={defaultSubject} name="subject" type="text" />
          </label>
          <ReplyGenerator skippedEmailId={emailId} />
          <label className="skipped-email-reply-body">
            <span>Reply</span>
            <textarea
              name="body"
              placeholder="Write a quick reply, or generate one with Kyro..."
              required
            />
          </label>
          <div className="skipped-email-reply-footer">
            <div className="email-signature-control">
              <label className="signature-include-control">
                <input defaultChecked name="includeSignature" type="checkbox" />
                <span>Signature</span>
              </label>
              <select
                aria-label="Email signature"
                defaultValue="manual"
                name="signatureVariant"
              >
                <option value="manual">User signature</option>
                <option value="ai_generated">Assistant signature</option>
              </select>
            </div>
            <button className="primary-button compact" type="submit">
              Send reply
            </button>
          </div>
        </form>
      ) : null}
    </details>
  );
}
