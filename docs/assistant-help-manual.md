# Kyro User Manual

This manual is Kyro's user-facing help source. Kyro can use it to answer questions from the text Assistant and the live Voice assistant. It explains what exists now, what each screen is for, which settings matter, and what Kyro can safely do on the user's behalf.

## Quick Summary

Kyro is a CRM and operations assistant for trade and service businesses. It is designed to help a small business keep on top of enquiries, customers, replies, quote drafts, connected email, documents, and day-to-day follow-up work.

The current app is a web app. The long-term product direction is iOS-first, so the web app is being used to prove the workflow, data model, assistant behaviour, and integrations before the mobile app becomes the main customer experience.

Kyro currently has these main areas:

- Assistant: chat with Kyro about work queue, customers, quotes, settings, help, and general questions.
- Voice: speak with the same Kyro assistant through OpenAI realtime voice.
- Inbox: review business conversations and action customer enquiries.
- CRM: manage contacts, leads, customers, suppliers, builders, contractors, and property managers.
- Files: view generated and uploaded files, plus create, edit, print/save, and file customer quote/invoice PDFs from structured quote drafts.
- Log: inspect recent workspace activity.
- Settings: configure communication rules, voice, integrations, usage visibility, and general workspace defaults.
- Developer: internal testing tools, not an end-user screen.

## What Kyro Can Do

Kyro can currently help with:

- answering questions about the workspace and current CRM records,
- summarising contacts, leads, conversations, and quote drafts,
- finding work that needs attention,
- generating one-off images, renovation concept renders, and simple marketing/social graphics from text prompts and optional uploaded image references,
- creating saved internal quote drafts from existing reusable document templates,
- drafting and sending user-approved manual replies through connected email,
- sending and receiving workspace SMS through Twilio when the workspace has an
  active Kyro/Twilio number or testing sender configured,
- recording Vapi/Twilio phone activity for inbound customer calls, voicemail
  overflow, user-to-Kyro calls, and outbound customer calls once Vapi is
  configured,
- queuing outbound email in a durable delivery ledger so failed sends can be retried or dismissed,
- checking connected Gmail or Outlook inboxes on request,
- classifying inbound email and promoting business-actionable messages into the CRM,
- showing filtered-out emails separately so personal/newsletter/noise stays out of the work queue,
- preserving inbound and outbound email attachment metadata, with private file storage when provider or upload bytes are available,
- generating a draft reply from a short user instruction,
- adding internal Inbox tasks, site-visit appointment records, message-resolution markers, and private notes,
- remembering explicit instructions when the user says to remember or note something,
- suggesting likely durable memories for user approval when the user implies a
  stable preference without explicitly saying "remember",
- updating pronunciation vocabulary when the user asks,
- updating a small allowlist of safe workspace settings,
- updating basic quote document template settings when the user asks,
- creating and revising reusable document templates when the user asks,
- preparing quote-send emails that include a generated PDF and customer approval link,
- generating saved quote/invoice PDF records from quote drafts,
- filing user-approved generated PDFs to Google Drive,
- answering whether a customer has viewed, approved, requested changes to, or received a revised version of a quote,
- using web search for public/current internet information when enabled,
- answering help questions from this manual and architecture notes.

Kyro should not claim to have done work it has not done. It should not invent customers, prices, dates, provider responses, CRM records, messages, or completed business actions.

## What Kyro Cannot Do Yet

Some product areas are intentionally not complete yet:

- Vapi/Twilio phone calling has a live backend path for configured workspaces,
  but live numbers, assistant ids, production prompts, and call-provider
  credentials still need to be configured and tested before real calls should be
  trusted.
- SMS has an early Twilio foundation for workspace-owned Kyro numbers, but
  number search/purchase and richer staff-vs-customer SMS routing are still future work.
- Generated images, uploaded files, inbound attachments, and generated PDFs are saved as private Kyro files and can be opened or downloaded from Files.
- Quote drafts can now render as print-ready customer quote documents, generate server-side quote/invoice PDFs, store those PDFs privately as generated document records, file user-approved PDFs to Google Drive, and collect customer approval or change requests through secure quote links.
- Payment processing, bookkeeping, reconciliation, taxes, and billing collection are not implemented.
- Provider push/webhook inbox sync is not implemented; current inbound email uses scheduled/manual polling.
- Kyro does not automatically send approval-gated AI replies without a user action.
- OAuth connection setup remains a Settings flow, not a chat-only flow.
- The current web UI is not the final iOS app, but it is being shaped around iOS-first behaviour.

## Asking Kyro For Help

Users can ask Kyro things like:

- "How does Kyro decide what goes into Inbox?"
- "What does lookback mean?"
- "How do quiet hours work?"
- "How do I change the voice?"
- "What can you do?"
- "Can you explain the pronunciation list?"
- "Where do I reconnect Gmail?"
- "Why was an email filtered out?"
- "What settings can you change for me?"

When a user asks how Kyro works, what a setting means, or how to use a screen, Kyro should answer from this manual first. If the user asks a technical or product-build question, Kyro can also use architecture notes, but it should translate them into plain language.

## Assistant Screen

The Assistant screen is the main text chat with Kyro.

Use it to:

- ask what needs attention,
- ask about a customer or inquiry,
- look up quote drafts,
- create a quote draft from a template,
- attach images/files and ask Kyro to generate a concept render, social graphic, simple flyer, or other one-off visual,
- ask Kyro to check email,
- ask what inbound email has seen recently, including skipped/filter decisions and attachment-bearing email,
- ask for help understanding failed outbound delivery or outbox retry status,
- ask how Kyro or a setting works,
- ask Kyro to remember explicit instructions,
- approve or dismiss suggested memories,
- ask Kyro to update pronunciation vocabulary,
- ask Kyro to update safe basic settings,
- ask Kyro to update quote document template direction, currency, validity, payment terms, or footer text,
- ask general questions.

When no preview card is open, the Assistant screen can also show a Kyro activity
pane for communication events outside the chat, such as recent inbound SMS,
outbound SMS/email, and linked CRM conversations. This is a visibility surface;
questions and instructions still go through the Assistant message box.

Assistant results can include cards. Cards are deterministic UI generated by the app, not arbitrary layouts invented by the model. For example, if Kyro finds a conversation or quote draft, the UI can render a card to open it. Some answers can also include summary cards, approval queues, contact timelines, usage summaries, generated-image cards, and memory suggestions. Kyro uses the model to decide which approved app tool fits the request, then the app code validates and executes that tool.

If the user asks Kyro in text chat to call a customer, Kyro resolves the intended
contact, phone number, and call instructions, then shows an outbound-call review
card. The call only starts when the signed-in user presses Start call. If the
request comes from a configured internal phone number through user-to-Kyro SMS or
internal Vapi voice, Kyro can start the same Vapi outbound call directly after
resolving the contact and instructions. External customer callers cannot trigger
arbitrary outbound calls.

Image generation works best from the text Assistant because the user can attach photos, plans, inspiration images, or written direction and then review the generated image card. Kyro stores uploaded references privately, calls OpenAI Images when the request is clearly visual, saves the result as a Kyro file, and shows open/download actions in chat and Files. Follow-up edits such as "make it night time" reuse the latest generated image saved in the current Assistant thread, so they can recover even after a browser refresh or dev-server restart. Kyro lets OpenAI choose the image size by default, but pins the closest supported size when the user clearly asks for a format: landscape/wide/16:9-style requests use the landscape size, portrait/vertical/9:16-style requests use the portrait size, and square/1:1/9:9 requests use square. For quote/invoice PDFs, use Files; image generation is for one-off visuals, concepts, and marketing material rather than transactional documents.

The suggestion buttons above the Assistant message box are adaptive. Kyro keeps a
small stored set of reusable, customer-agnostic prompts for each workspace user,
based on the user's recent first-of-day or first-of-session Assistant requests.
The visible four suggestions can rotate from the stored list over time. Kyro must
not turn specific customer names, addresses, emails, phone numbers, or one-off
file ids into suggestion buttons.

The Assistant persists conversation history for the main user chat without making the user manage chat threads. Kyro uses internal threads, summaries, and best-effort context snapshots to keep context efficient over time. If snapshot storage is unavailable, chat turns continue from raw recent messages and saved memories. Separate customer-facing calls or future channel conversations can use their own internal threads while still receiving the right CRM context.

## Voice Screens

The Voice screen is Kyro's current OpenAI Realtime voice mode. It uses WebRTC so the user can talk naturally and hear Kyro respond in the selected assistant voice.

The Vapi Voice screen is a separate developer/test surface for the newer Vapi
voice runtime. It keeps the OpenAI Voice screen intact while testing whether Vapi
should become the internal voice transport used by web and mobile. Vapi Voice uses
the same main Assistant thread and saves completed turns back into that thread, so
the text Assistant can see what was discussed after the call.

Voice mode is intended to be the same assistant as the text Assistant:

- same workspace,
- same Assistant thread,
- same memory context,
- same LLM-first tool planner and audited tool executors,
- same help/manual access,
- same safe settings permissions,
- same audited CRM contact update tool for profile fields and notes,
- same connected email sync tool,
- same public web search tool when enabled.

Use Voice or Vapi Voice when the user wants a more natural back-and-forth conversation. Use text Assistant when the user wants to review cards, links, details, or typed instructions.

Voice can call Kyro tools while speaking. For example, if the user asks "check my email" or "what does lookback mean", voice should call the context tool rather than guessing. Voice can also start a simple image-generation request, but for complex visual work it should guide the user back to the text Assistant so they can attach images and inspect the result.

## Inbox Screen

Inbox is the main operational work queue. It shows business conversations that need review, replies, quote work, missing information, approval, or follow-up.

Inbox is for work that has become CRM work. Emails or messages that Kyro decides are not business-actionable are kept separate in the filtered-out email popup.

Inbox buckets can include:

- Needs reply: conversations where the customer likely needs a response.
- Missing info: Kyro needs details before a quote or next step is practical.
- Follow-up due: Kyro already replied, the workspace follow-up delay has passed, and the customer has not replied yet.
- Ready to quote: Kyro has enough information to prepare or send a quote.
- Site visit needed: the job likely needs an appointment or inspection.
- Awaiting customer: Kyro is waiting for the customer to reply.
- Resolved: conversation appears handled.
- Needs review: Kyro needs the user to check information or classification.
- Needs approval: an action is waiting for user approval.

Opening a conversation shows the customer profile, lead status, inquiry facts, thread messages, draft replies, proposed actions, quote draft links, internal tasks, site-visit appointment records, AI triage details, usage events, audit history, and status controls.

Each message in a conversation has message controls. The user can:

- assign a task to themselves,
- mark that specific message resolved without closing the whole conversation,
- add an internal note that is never sent to the customer.

Site-visit suggestions are saved as internal appointment/task records first. Calendar integration is future work; the saved Kyro record is the source of truth for now.

Follow-up reminders are internal CRM reminders. By default Kyro creates a follow-up reminder two days after an outbound reply is recorded, but the workspace default can be changed in Settings. The reminder only surfaces as due once that delay has passed, and it is cleared automatically if a new inbound customer message arrives.

## Replying From Inbox

Users can reply to a conversation from the inquiry review page, Inbox preview, or Assistant preview.

Email replies send through the connected Gmail or Outlook account when:

- an email provider is connected,
- the contact has an email address,
- the user writes or approves the reply,
- the channel is email.

SMS replies can send through Twilio when:

- Twilio is configured server-side,
- the workspace has an active SMS-capable Kyro/Twilio number or testing sender,
- the contact has a phone number,
- the user writes or approves the SMS reply,
- the channel is SMS.

Inbound SMS to a workspace Kyro/Twilio number follows the same CRM ingestion path
as manual or email inquiries: Kyro matches the sender by normalized phone where
possible, creates or reuses the contact/conversation, records the message, and
runs AI triage. Messages from the business owner, staff, family, or apprentices
will need explicit operator-number rules later; the current first pass treats
unknown inbound numbers as normal external messages.

Phone calls are handled differently from ordinary text messages. Kyro stores the
call itself as a `voice_calls` record, then links it to a contact, conversation,
or lead when there is enough context. The Assistant Kyro activity pane can show:

- inbound customer calls,
- voicemail overflow calls,
- calls from known user/team numbers,
- outbound customer calls started through the backend.

Opening a call activity item shows call status, call purpose, the customer or
caller number, linked CRM context, transcript, summary, recording URL when Vapi
provides one, and recent provider events. If a call came from a user/team number,
Kyro should treat it as an instruction source rather than a customer enquiry.

Outbound customer calls are durable `voice_calls` rows. Kyro records the queued
call before asking Vapi to place it, stores the Vapi provider call id when
available, and later updates the call with transcript, summary, recording URL,
events, and metered usage from Vapi webhooks.

The mobile app should use the same backend routes rather than implementing a
separate phone stack: `GET /api/assistant/activity` for the Kyro activity list,
`GET /api/voice/calls/[callId]` for call details, and `POST /api/voice/outbound`
for approved outbound calls.

Manual user-written replies are treated as approved because the user wrote the body and pressed send. AI-generated/action-queue replies still go through the relevant approval/execution flow.

The reply composer can also generate a draft from a short instruction. The user should review the generated draft before sending.

Email delivery is recorded through Kyro's outbox layer. That means Kyro creates a durable delivery row before calling Gmail or Outlook, records the attempt, links the resulting provider message id when available, and keeps enough metadata to inspect or retry delivery later.

The user-facing screens normally show only the useful result, such as a sent message, a failed send, or a retry option. The internal Developer -> Outbox operations page is for deeper delivery inspection.

## Filtered-Out Emails

Filtered-out emails are messages Kyro noticed but did not turn into CRM work. This keeps personal mail, newsletters, automated messages, spam, receipts, and low-value noise out of the main Inbox while still allowing the user to quickly review what was skipped.

The filtered-out email popup:

- opens from a compact button near the Inbox count,
- shows a last-24-hours count on the normal Inbox load,
- loads the heavier recent skipped-email list only when opened,
- keeps skipped mail visually separate from the real work queue,
- shows sender, date, classification pill, subject, and preview,
- collapses already-replied skipped emails into a short two-line row,
- can expand a replied row with the small expand control,
- has a primary Promote button to turn a skipped email into a CRM work item,
- can send a user-approved reply through the same connected-email outbox path as normal replies,
- hides decision details such as confidence, reason, classifier, and sender-learning actions inside the three-dot menu,
- can teach Kyro that future emails from a sender should be treated as relevant or ignored, with the menu showing whether each sender rule is currently set,
- links conceptually to Settings, where sender rules open in a dedicated pop-up manager for review, edits, additions, and removals,
- shows a Kyro `Replied` pill when Kyro has replied through this popup.

The `Replied` indicator is Kyro's internal log only. It does not try to detect replies sent directly in Gmail or Outlook.

Promoting a filtered-out email creates or reuses the normal CRM contact, lead, conversation, inbound message, and AI triage path. Kyro tries to refetch the original email from Gmail or Outlook when possible; if that is unavailable, it can still create a minimal work item from the stored sender, subject, summary, and classification metadata.

Replying to a filtered-out email does not create a normal conversation unless the user promotes it. Kyro still records the reply through the outbound delivery ledger and shows its own `Replied` indicator once the provider send has succeeded.

## Outbound Delivery And Outbox

Kyro uses a durable outbox for real email delivery. The outbox is different from the visible conversation thread:

- the outbox row tracks the delivery attempt, provider, recipient, subject, retry state, attachments, and errors,
- the conversation message is the user-facing communication history,
- skipped-email replies can use an outbox row without creating a full CRM conversation,
- failed sends can be retried without retyping the email,
- stale failed test sends can be dismissed without deleting the audit trail.

Common delivery states include:

- Queued: Kyro has recorded the outbound request and it is ready to send.
- Sending: Kyro is currently attempting the provider call.
- Sent: Gmail or Outlook accepted the message.
- Retry scheduled: the send failed temporarily and Kyro has scheduled another attempt.
- Failed: Kyro could not send after the available attempts or hit a non-retryable problem.
- Dismissed: an operator intentionally hid a stale or irrelevant failed row from the active operations view.

Quote PDFs and uploaded local files can be attached to outbound email. Kyro stores retryable attachment bytes in private Supabase Storage when needed, then keeps file metadata on the outbox row so a scheduled retry can rebuild the provider request without storing raw base64 in Postgres.

Scheduled retry processing lives behind the protected `/api/outbox/process` endpoint. End users should not need to call that route directly; it is for cron or operator tooling.

## CRM Screen

The CRM screen combines contacts and leads in one place.

Use it to:

- browse all contacts,
- filter to leads, clients, suppliers, contractors, builders, property managers, or other contacts,
- search by name, company, job, email, phone, or address,
- sort by last interacted, alphabetical order, most messages, or most leads,
- edit contact details,
- use Google-powered address autocomplete where available while still allowing manual address entry,
- set whether a profile is currently a lead or a client, separately from its contact category,
- see duplicate warnings when another profile shares the same normalized email or phone,
- review profile conflicts when email and phone point at different existing profiles,
- merge duplicate profiles without losing messages, leads, quote drafts, actions, or audit history,
- see other contacts attached to the same company name,
- review lifecycle suggestions when Kyro thinks a lead/client stage looks stale,
- inspect linked conversations, leads, messages, AI runs, actions, audit history, and quote drafts.

The old `/leads` route redirects to CRM because leads are now a CRM filter rather than a separate primary screen.

Contact category and lifecycle are intentionally separate. Category describes
what kind of person or organisation the profile is, such as client, supplier,
contractor, builder, property manager, or other. Lifecycle describes whether the
relationship is still a lead or has become a client. Users can change lifecycle
manually from the CRM profile editor. Manual lifecycle changes are treated as
authoritative until the user clears the manual lifecycle override from the CRM
profile panel.

Kyro can also review lifecycle status in the background or from the CRM review
buttons. It looks for evidence such as accepted quote links, approved/booked
work, repeated two-way communication, completed business actions, and future
commercial records such as paid invoices, work orders, and billing records.
Automated review does not silently change the profile; even high-confidence
findings create a suggestion with a reason that the user can apply or ignore.

Profile resolution is also handled in CRM. If a new inquiry has identity signals
that conflict, such as an email that matches one profile and a phone number that
matches another, Kyro creates or flags a profile for review instead of guessing.
The Profile review filter shows these records and normalized email/phone
duplicates. From the profile panel, the user can merge either direction or mark
the profiles reviewed and separate. A merge keeps the chosen profile active,
moves linked messages, conversations, leads, inquiry facts, quote drafts, and
contact-targeted actions to it, and archives the source profile so its audit
history remains traceable.

Address entry stores two layers of data. The visible `address` is the human-readable
address the user sees and can edit. When the user selects a Google address result,
Kyro also stores structured components such as line one, suburb/locality, state,
postcode, country, latitude/longitude, Google place id, and validation status.
If Google lookup is unavailable or the user types a non-standard job-site note,
Kyro still saves the manual address and marks it as manual/unverified rather than
blocking the workflow.

Autocomplete is country-aware. Kyro uses the workspace default phone region as
the address country filter, so an Australian workspace should not see Canadian
address suggestions for normal address entry. The server can also be configured
with an operating-area location bias so local addresses appear first while
interstate addresses inside the same country can still be selected.

## Files Screen

Files focuses on saved assets, quote drafts, reusable templates, generated quote/invoice PDFs, and customer quote output.

Use it to:

- open/download generated images, uploaded references, inbound attachments, and generated PDFs,
- list saved quote drafts,
- filter drafts by all, draft, ready, sent, archived, linked, or unlinked,
- open an unsaved quote-draft editor from a reusable template,
- create and review custom reusable quote templates from template direction, line items, terms, and example-file references,
- open and edit a quote draft in a full-width editor,
- search CRM contacts by name, company, email, phone, or address and select a customer to populate quote customer fields,
- save customer and job details,
- edit line items as structured rows with item, quantity, unit, unit price, total preview, and optional line note,
- open saved templates from the Templates pane to view/edit them before using them again,
- save basic document template direction such as accent colour, currency, validity period, payment terms, and footer text,
- open a customer-facing quote document and use the browser print flow,
- download a server-generated customer PDF from a quote draft,
- generate an invoice PDF from a saved quote draft without payment processing or bookkeeping,
- see recent saved generated PDFs and download or file them to Google Drive,
- prepare a customer email with the generated quote PDF attached for user review and approval,
- create a secure customer approval link so the customer can approve a quote or request changes,
- send a linked quote draft back to an inquiry composer with that draft preselected as the PDF attachment.

Kyro uses a structured-document approach for quotes. The editable quote data stays in `quote_drafts`, while the customer-facing output is rendered from an HTML template at view time. This is deliberate: quotes, invoices, and other transactional documents need predictable totals, customer details, terms, and auditability.

Starting a quote from a reusable template opens an unsaved editor first. Kyro does not create a saved `quote_drafts` row just because the user clicks Create draft. If the user backs out without pressing Save quote draft, nothing is added to the Documents list. Pressing Save quote draft creates the real saved draft.

The unsaved and saved quote draft editors use a single-column layout so the customer fields, line items, and notes have room to breathe. The editor intentionally does not show separate right-side summary, preview, or output cards. Users inspect the reusable template in the template builder/review screen and inspect the customer-facing document through the Print / PDF view.

Selecting a customer is a convenience step, not a locked merge. The quote editor uses a typeahead search instead of a full contact dropdown so it can handle large contact lists. Choosing a suggestion fills the customer fields from the selected CRM contact and links the quote to that contact when saved, but the user can still edit the populated name, company, email, phone, and job address before saving.

Line item rows are saved as structured data. Quantity and unit price are used to calculate the line total; the overall Notes box is for quote-wide notes, while each line item can have its own shorter note.

The template builder is where users create and review reusable quote templates. It starts blank: users add their own line items and overall notes instead of working from prefilled trade defaults. The builder includes inline information bubbles beside the main panels so users can quickly understand what each section controls without permanent explainer text crowding the screen. The builder includes a live customer-quote preview so the user can review the template before saving it. That preview is rendered from the same HTML document renderer used by the Print / PDF route, not from a separate mock layout, so the review screen and customer document stay aligned. Users can click the preview to open a larger modal inspection view without changing the template data. Saved templates can be opened again from the Templates pane with View/edit, revised, previewed, and saved without changing their stable template key. A template stores the natural-language direction, accent, currency, validity period, payment terms, footer text, line-item structure, overall notes, and lightweight reference-file metadata. Example files are currently kept as reference metadata for the template creation workflow rather than full parsed assets; deeper file parsing and visual template generation are future work. New drafts created from a template are titled from the template name plus a timestamp down to the minute.

The template review screen has a Kyro edits box. The user can describe the edits they want, such as "make this more premium", "add staged bathroom renovation sections", or "remove pricing placeholders", then apply that request to the on-screen preview before saving. This uses AI to propose structured template edits, but the user still reviews and saves the result. Kyro should not treat previewed AI changes as saved until the user presses Save.

Users can also ask Kyro in Assistant or Voice to create or revise reusable templates directly, for example "create a premium invoice template", "make the invoice template more concise", or "add a deposit line to the renovation quote template". Kyro uses the same structured template revision path as the Kyro edits box and saves the result into the reusable Templates list. If a revision request could apply to more than one template, Kyro asks which template should be changed instead of guessing. The created or updated template is still reviewable through the template page before being used for customer documents.

The template direction is for the business' preferred quote style, not text that should be shown to the customer. Users can describe the desired feel in natural language, then Kyro and the renderer use that direction to keep document output consistent. When a draft is created from a template, Kyro stores a snapshot of that template's design settings on the quote draft so the same template can keep rendering consistently even if workspace defaults change later.

Users can also ask Kyro in Assistant or Voice to update basic document template settings, such as "set the quote template direction to premium and minimal", "set quote currency to AUD", "make quotes valid for 21 days", or "update quote payment terms to 50% deposit before booking". These are safe presentation/content settings. Kyro should not invent prices, legal terms, tax treatment, or payment rules without a clear user instruction.

Users can ask Kyro in Assistant or Voice to create a quote draft from an existing reusable template, for example "create an invoice document for Mikel Bright" or "start a bathroom renovation quote". Kyro matches the request against saved template names, descriptions, and keys. If there is only one template, Kyro can use it for a generic create request; if several templates exist and the request is vague, Kyro asks which template to use. When the prompt clearly names an existing contact by name, company, email, or phone, Kyro links the new draft to that contact and pre-fills the customer fields. The draft is still an internal saved draft; sending it to a customer remains approval-gated.

Users can also ask Kyro in Assistant or Voice what quotes are ready to send, or ask it to prepare a quote email, for example "what quotes are ready to send?", "send the bathroom quote to Mikel", or "draft an email for this quote". Kyro does not directly send the customer email from that instruction. Instead, it finds the matching open quote, checks that the quote is linked to an inquiry and has a customer email, creates a secure customer approval link, generates the current PDF, creates a reviewable email draft action with the PDF attached, and links the user to the inquiry so they can approve or edit before sending. If the quote is a revision, Kyro keeps the active quote version and uses a revised-quote subject. If the request is vague or several quote drafts could match, Kyro asks the user to choose.

Quote drafts now have four customer-output paths. The Print / PDF button opens deterministic customer-facing HTML for browser print/preview. The Download PDF button creates and saves a server-generated PDF from the same structured quote data. The Generate invoice button creates and saves an invoice PDF from the same saved quote/template data without any payment, bookkeeping, or reconciliation side effects. The Send to customer button creates a secure approval link, generates and saves the PDF, creates a reviewable email draft action with the PDF attached and approval URL in the email body, and redirects to the linked inquiry so the user can check the message before sending. The quote page also has a Customer approval card where the user can create a fresh approval link manually. Fresh links revoke older active links for the same quote draft.

The customer approval page lives at `/quote/approve/[token]` and does not require the customer to sign in. The token is a bearer secret in the URL; Kyro stores a hash of it in `quote_approval_links` rather than storing the raw token. Customers can approve the quote or request changes. Approval marks the quote draft `approved` and records a `customer_approved` history event. Change requests mark the quote draft `changes_requested`, record the note, reopen the linked conversation when there is one, and add a portal-origin inbound message so the user sees the requested change in the work queue.

Quote revisions are tracked automatically. A new quote starts as `v1`. If a customer requests changes, the quote remains tied to the same draft but is flagged as needing revision in Inbox and Documents. The user edits the quote normally; once the content changes after the request, Kyro increments the version, for example from `v1` to `v2`, and treats the customer request as resolved for that revision. Sending the revised quote creates a fresh approval link and a new reviewable email draft. Older active approval links for the same quote are revoked when a fresh link is created.

When the user sends a generated quote email, Kyro regenerates the PDF attachment, stores or reuses the generated document record, stores retryable attachment bytes privately for the outbox when needed, queues/sends through the connected Gmail or Outlook account, records the outbound message, and marks the quote draft and generated document sent after provider acceptance.

Quote drafts also show a lightweight document and customer approval history. Kyro records document events in quote metadata when a PDF is downloaded, when an email is prepared with the PDF attached, when the PDF is actually sent, when a customer views the approval page, when they approve, and when they request changes. Each generated document metadata record includes a content hash of the quote data and template settings used to render it, plus the active quote version. The quote page compares that hash with the current quote content and can show whether the quote has changed since the last generated/prepared/sent document. Users can ask Kyro in Assistant or Voice questions such as "has this quote been sent?", "when did we send Sarah the bathroom quote?", "has Sarah approved the quote?", "did Sarah request changes?", "what version is the quote on?", or "has this quote changed since it was sent?"

Generated-document storage is now first-class for quote and invoice PDFs. Kyro records each generated PDF in `generated_documents`, stores the binary in private Supabase Storage through a `files` row, links it back to the quote draft/contact/lead/conversation, and keeps lightweight history snapshots on the quote draft for the timeline. The user can download saved PDFs or file them to Google Drive when a connected Google account has Drive access. Payment collection, bookkeeping, reconciliation, billing-provider integration, and full accounting exports are still future work.

For marketing or creative documents, Kyro should use a different path from quotes and invoices. Marketing images, social graphics, flyers, and campaign-style creative assets can use OpenAI image generation later because those assets benefit from more visual generation and iteration. Transactional quote/invoice documents should stay structured first, with AI helping fill content and adjust templates rather than inventing totals or legal/payment details.

## Log Screen

The Log screen is the workspace activity timeline. It is useful for debugging and visibility.

It can show recent:

- inbound and outbound messages,
- actions,
- events,
- audit logs,
- AI runs,
- model route decisions,
- usage events.

The Log supports filtering and searching so a user or builder can understand what Kyro did and why.

## Developer Screen

Developer is an internal testing and operations area. It is not intended as a normal customer-facing screen.

Developer currently includes:

- mock inbound inquiry tools for testing CRM workflows,
- the System Health screen at `/developer/system-health`,
- the Smoke Test Checklist at `/developer/smoke-tests`,
- the Outbox operations screen at `/developer/outbox`,
- the Assistant tool registry at `/developer/assistant-tools`,
- readiness checks for Supabase tables, private storage, OAuth scopes, provider env, cron/worker secrets, inbound sync, outbox processing, generated documents, and recent failed rows,
- a read-only manual runbook for checking mock inbound, draft replies, generated PDFs, outbound delivery, inbound email, and Log/audit visibility,
- delivery filters for queued, retry-scheduled, failed, sent, and dismissed outbound rows,
- retry and dismiss controls for outbox rows,
- delivery metadata for provider ids, provider request ids, attempts, next retry time, errors, and attachments,
- a registry view of Assistant tools, permission gates, provider readiness, and known UI block types.

Use Developer -> Outbox operations when a sent email appears to have failed, a provider was disconnected during send, or a retry needs manual inspection.
Use Developer -> System Health when checking whether the local or deployed environment has the right tables, buckets, providers, OAuth scopes, and worker secrets. It reports whether values are present or missing, but it should not display secret values.
Use Developer -> Smoke Test Checklist as the builder runbook after larger changes or deployment. It links to the relevant app surfaces but does not create test data on its own.

## Settings Overview

Settings is split into these sections:

- General: business profile, public contact details, service area, branding, default signature, timezone, display currency, and phone-region defaults.
- Integrations: connected email accounts, outbound reply/channel rules, signatures, inbound email sync, quiet hours, and sync limits.
- Voice: assistant voice, outbound pronunciation policy, and pronunciation vocabulary.
- Usage: customer-facing usage charge visibility, task/model breakdowns, and metered usage ledger.

Settings sections are URL-addressable so a link or assistant card can open the correct section directly.

## General Settings

General settings hold the workspace's business profile and workspace-wide defaults.

The business profile includes the business name, industry, public email, displayed public phone number, business address, service area, suburbs/postcodes served, travel radius, staff count, working/contact hours, emergency job availability, emergency-rate notes, logo, brand colours, and brand style notes.

The public phone number is deliberately separate from the operational Twilio/Vapi number. If a workspace has an assigned SMS/voice number, General shows it as an available connected number, but the user can still type or choose a different public number for documents and business-facing material.

Business logo and branding live in General. Reports and future business-facing documents can use the business logo when it exists, falling back to the business name when no logo is saved. The logo upload is intentionally small for now.

The default email signature is also surfaced in General so the business profile has one obvious place for everyday business identity. Advanced outbound writing controls and optional separate AI signatures still live under Connected accounts.

Timezone lives in General because it affects multiple features. Kyro uses timezone for local-time behaviour such as quiet-hours email polling.

Users should enter an IANA timezone such as:

- `Australia/Brisbane`
- `America/Denver`
- `UTC`

Kyro can change the timezone when the user asks clearly, for example: "Set the timezone to Australia/Brisbane."

Display currency also lives in General. Kyro stores usage and provider ledger values in their original currency, currently USD for OpenAI-backed usage, but the app can display user-facing money values in the workspace's preferred currency. This currently applies to usage/billing summaries, usage ledger rows and CSV exports, small usage totals in Inbox/Contact/Log screens, and internal provider/margin pills. Quote and invoice documents keep their own document-template currency because those are customer-facing business documents, not Kyro usage charges.

The current display conversion layer uses placeholder static rates and clearly marks the rate provider internally. It is designed to be swapped for a live billing-provider rate source later, such as Stripe FX Quotes, without rewriting the UI.

Kyro can change the display currency when the user asks clearly, for example: "Set the display currency to AUD."

Default phone region also lives in General. It is only used when a customer gives
Kyro a bare local phone number without an international country code. Explicit
international numbers such as `+61`, `+1`, or `+44` keep their own country. The
default region helps Kyro normalize local numbers correctly for duplicate
detection and contact matching in Australia, the USA, the UK, or another
supported region.

## Communication Settings

Communication settings define outbound communication behaviour. They now live inside Settings -> Connected accounts because outbound rules, email signatures, and provider connections belong together.

Current communication settings include:

- outbound writing style for AI-generated replies, including tone, wording style, message length, sign-off guidance, trade phrasing, and reusable reply instructions,
- whether approval is required before outbound actions,
- allowed channels such as email, SMS, phone, and manual notes,
- user email signature,
- optional separate assistant-generated signature.

The saved writing style is applied to AI-generated email/SMS drafts from the inbox
reply generator and inbound triage. It is not just display text in Settings.

High-risk communication choices remain user-controlled in Settings. Kyro can explain them, but it should not silently change outbound approval policy, signatures, or provider secrets through chat.

## Voice Settings

Voice settings control Kyro's spoken assistant experience.

Current voice settings include:

- OpenAI assistant voice,
- ElevenLabs/Vapi voice selection for the Vapi browser/mobile runtime and
  Kyro-initiated outbound calls; the default is Female - Australian,
- outbound voice pronunciation policy,
- Vapi phone assistant enablement,
- Vapi internal assistant id for the `/voice-vapi` browser/mobile voice runtime,
- Vapi assistant ids for inbound calls, voicemail overflow, and outbound calls,
- the Vapi phone-number id used for customer-facing calls,
- user/team phone numbers that should be treated as internal callers,
- broad call style settings such as directness, detail level, warmth, and escalation behaviour,
- pronunciation vocabulary list,
- pronunciation preview controls.

OpenAI remains available for the original realtime voice screen. Vapi voice
sessions use the saved ElevenLabs/Vapi voice option when Kyro starts the
browser/mobile Vapi runtime or places an outbound Vapi call. That voice choice is
passed as a runtime override so web and mobile can share the same setting.
Inbound and voicemail-overflow assistants should be configured in Vapi with the
same voice until Kyro adds dynamic server-side assistant selection for incoming
calls.

Vapi settings now cover two related paths. The internal Vapi assistant powers the
developer `/voice-vapi` screen and writes back into the user's main Assistant
thread. Customer-facing Vapi phone assistants are separate phone-number-facing
agents that run when a customer calls the Kyro number, a voicemail overflow
forwards to Kyro, or Kyro places an outbound customer call. They use the same CRM
backend and audit model, but each customer call is a separate internal call record
so customer conversations do not pollute the user's main Assistant chat thread.

## Pronunciation Vocabulary

Pronunciation vocabulary lets Kyro learn words that should be spoken carefully. This is useful for:

- suburbs and place names,
- customer names,
- staff names,
- business names,
- supplier names,
- product names,
- acronyms,
- internal nicknames.

Each entry can include:

- phrase: the word or phrase Kyro may see,
- say it like: a pronunciation hint,
- category: person, place, business, product, acronym, or other,
- aliases: related spellings, nicknames, abbreviations, or speech-to-text mishearings,
- usage count and last-seen information,
- source/status metadata.

Aliases help Kyro recognise related terms and track usage. They do not automatically replace what Kyro says aloud. For example, if `Woolloongabba` has an alias `the Gabba`, Kyro can understand they may be related, but it should still say the words in the user's message unless the context calls for the full place name.

Kyro can auto-add likely difficult terms with a best-effort default pronunciation. Users do not need to approve every entry. The list is meant to maintain itself in the background, while still allowing the user to correct it.

Voice settings show the first 10 pronunciation entries by default. If the list grows beyond 10 entries, the rest sit behind a show-more control so the settings screen stays tidy.

Users can also ask Kyro directly, for example:

- "Pronounce Woolloongabba as wuh-lun-gabba."
- "Say Coorparoo like Coo-pa-roo."
- "Change the pronunciation of our supplier name to ..."

Pronunciation previews use Kyro's saved OpenAI voice where possible. The phonetic hint is sent as private guidance, not as text to read aloud.

## Outbound Voice Pronunciation Policy

The outbound voice pronunciation policy prepares Kyro for future customer-facing voice actions.

Current options are:

- Strict: ask before customer-facing voice if there are risky unconfirmed terms.
- Balanced: use high-confidence inferred pronunciations, but ask before risky customer-facing voice.
- Flexible: proceed more freely with best-effort pronunciations.
- Off: do not apply pronunciation preflight restrictions.

Customer-facing voice should still respect this policy before Kyro calls a
customer or answers on the user's behalf. The policy is especially important for
names, suburbs, supplier names, and technical trade terms that could sound
unprofessional if spoken incorrectly.

## Integrations Settings

Integrations manages Google Workspace and Microsoft Outlook connections.

Google and Outlook can be used for:

- outbound email sending,
- inbound email reading,
- provider account labelling,
- future document/calendar extensions.

Users can disconnect a connected account. Disconnecting clears Kyro's stored usable token, marks the connection disconnected, and stops Kyro using that mailbox. To reconnect or switch accounts, use the normal Connect flow again.

Existing accounts may need reconnecting if they were connected before inbound read scopes were added.

## Inbound Email Sync

Inbound email sync lets Kyro read connected Gmail or Outlook inboxes, classify new messages, and promote business-actionable mail into CRM conversations.

Sync modes:

- Automatic polling: scheduled checks run according to the workspace policy.
- Manual only: scheduled checks stop, but the user or assistant can still manually check inboxes.
- Paused: inbound email sync is off.

The default product direction is automatic polling because an AI agent is most useful when it can notice relevant messages without the user doing manual admin. Manual-only exists as a conservative option.

Kyro can also trigger a manual email check during a conversation. This is useful if the user says something like "check whether the customer emailed back" or a phone conversation suggests there may be a new email update.

## Poll Frequency

Poll frequency controls how often scheduled inbound email sync can run during active hours.

The current default is five minutes. This is close enough to live for most businesses without adding the complexity of Gmail/Outlook push notification infrastructure.

Longer intervals reduce background provider/API/model work. Emergency businesses may prefer shorter or more continuous coverage.

## Email Sync Status

The Integrations settings page shows a sync health panel for inbound email.

It can show:

- whether automatic polling is ready,
- whether sync is paused or manual-only,
- whether an account needs reconnecting,
- whether a required inbox-read scope is missing,
- whether the last sync failed,
- the last successful sync time,
- the last check attempt time,
- when the next scheduled sync is expected,
- whether a manual check is currently running.

`Last successful sync` means the last time Kyro completed a provider sync without a connection-level failure. `Last check attempt` means the last time Kyro tried to check that inbox, even if the attempt found a missing scope or failed.

`Reconnect needed` usually means the account was connected before Kyro requested inbox-read permission, the provider token now needs a fresh OAuth grant, or Kyro cannot decrypt the old stored token with the current integration encryption key. Disconnecting and reconnecting the provider grants the current scopes and stores a fresh encrypted token.

## Quiet Hours

Quiet hours reduce background activity and cost when the business is usually closed.

The default quiet-hours behaviour is:

- pause scheduled polling between the quiet-hours start and end times,
- resume on the first scheduled poll after quiet hours end,
- still allow manual checks,
- still allow assistant-triggered checks.

Quiet hours do not need a special "once during quiet hours" run. The intended behaviour is simply to stop scheduled polling during the quiet period and resume afterwards.

If a business wants normal polling overnight, turn quiet hours off rather than changing a separate quiet-hours behaviour setting.

## Lookback And Fetch Cap

Missed-mail lookback is how many days back Kyro asks Gmail or Outlook to search each time it syncs. It helps Kyro catch messages after downtime, reconnecting, or a missed scheduled run. Duplicate provider messages are skipped by idempotency keys.

Fetch cap per sync is the maximum number of messages Kyro asks a connected provider for in one sync run. It limits provider/API work and AI classification cost.

Lookback controls how far back Kyro searches. Fetch cap controls how many messages Kyro will fetch/process in that run.

## Skipped-Mail Summaries

Skipped-mail summaries are optional lightweight summaries for emails Kyro decided not to promote into CRM work.

Kyro always records enough provider event information to avoid reprocessing duplicates. The summary setting controls whether Kyro also records a human-readable summary/reason that can appear in the filtered-out email popup and help the assistant understand what was skipped.

Turning summaries off can reduce AI/classifier work, but makes filtered-out email review less useful.

Sender learning rules can be created from the filtered-out email three-dot menu or managed later in Settings -> Integrations -> Sender rules, which opens a pop-up manager so long sender lists do not crowd the settings page. They are structured policy rules, not keyword rules the user has to write. "Treat sender as relevant" tells future syncs to promote matching sender email addresses or domains before normal classifier uncertainty. "Always ignore sender" tells future syncs to skip matching sender email addresses or domains before model classification. Settings can add rules manually, switch a rule between relevant/ignored, or remove a rule if Kyro learned the wrong thing.

## Usage Settings

Usage settings show customer-facing usage charge and metering information.

Usage can show:

- total usage charge for the selected period,
- ledger event count,
- usage by task, such as live voice, inbound email processing, document generation, image generation, web search, reply drafting, or pronunciation vocabulary,
- SMS delivery and inbound SMS processing once Twilio is configured,
- provider/model/service breakdown with small info bubbles explaining what each model/service is used for,
- detailed usage ledger events in a modal opened from the Usage screen, with CSV export for the selected range.

Provider/API cost and gross-margin snapshots are still recorded in `usage_events` and available for internal/dev visibility, but they are not the main customer-facing billing numbers. The main user-facing figure is `Usage charge`.

Usage charges are stored in the ledger's original currency for billing auditability, currently USD for OpenAI usage. The Settings usage screen displays those values through the workspace display currency preference. The usage ledger CSV export includes both the display amount and the stored amount so it remains useful for customer review and later billing reconciliation.

For OpenAI model calls, Kyro uses the token usage returned by OpenAI where available.
It tracks uncached input tokens, cached input tokens, visible output tokens, and reasoning
tokens separately. Web-search tool calls are also counted separately from the normal token
rows, because they can have their own provider charge.
For live voice, Kyro also reads OpenAI Realtime usage from completed voice responses and
tracks text input, audio input, cached input, text output, audio output, and reasoning
tokens separately.
OpenAI text-to-speech rows use a pricing-derived estimate when the provider does not return
audio-token usage directly; the row metadata marks those estimates and records the pricing source.
OpenAI image generation rows prefer provider-returned image token usage when available. That
means render/edit costs can include prompt text tokens, reference-image input tokens, and
generated-image output tokens. If the provider does not return usage, Kyro falls back to a
per-image price snapshot and marks the row as estimated.
Twilio SMS rows store provider `twilio`, service `sms`, and `inbound_sms` or
`outbound_sms` usage types. Provider cost uses Twilio-returned price when available
or configured SMS unit-cost fallbacks; customer charge is snapshotted with the
current markup so later billing can audit the exact amount.

The read-only billing export endpoint is `/api/billing/usage`. It returns stored
customer-charge snapshots for a monthly, weekly, or custom range so a future Stripe,
bookkeeping, or invoice workflow can consume the same append-only ledger.

Usage is read-only. It does not collect payment, create invoices, or connect to Stripe or Apple billing yet.

## Web Search

Kyro can use public web search when enabled. In the text Assistant, web search is
an explicit Kyro tool: the model plans the search, app code runs the OpenAI web
search request, Kyro records usage/audit data, and the UI shows source cards.
Web search is for public/current internet information such as:

- sports results,
- news,
- supplier details,
- product information,
- public regulations,
- current facts.

Web search should not be used for private workspace data. CRM records, customer
details, connected email, quotes, files, and messages must come from Kyro's own
workspace tools.

## Email And Google/Outlook Reconnection

If Settings says an account needs reconnecting, it usually means Kyro does not have the required read scope for inbound sync.

Gmail inbound sync needs read access such as `gmail.readonly`. Outlook inbound sync needs `Mail.Read`.

Reconnect by disconnecting the account if needed, then using the relevant Connect flow in Settings. The new OAuth flow should request the current scopes.

## Safe Settings Kyro Can Change

Kyro can directly change a constrained set of low-risk settings when the user asks clearly:

- workspace timezone,
- workspace display currency,
- workspace default phone region,
- inbound email sync mode,
- daytime email poll frequency,
- quiet-hours enabled/disabled state,
- quiet-hours start and end times,
- missed-mail lookback,
- fetch cap per sync,
- skipped-mail summaries,
- inbound email action rules,
- explicit sender relevance rules when the user gives Kyro an email address or domain,
- assistant voice,
- outbound pronunciation policy,
- pronunciation vocabulary entries.

Kyro should say exactly what changed after making a setting update.

## Settings Kyro Should Not Change Directly

Kyro should not directly change high-risk or sensitive settings through chat/voice, including:

- OAuth provider connections,
- account disconnect/reconnect actions,
- provider secrets or API keys,
- email signatures,
- outbound approval policy,
- billing/payment details,
- destructive data deletion,
- broad permission changes.

For these settings, Kyro should guide the user to the correct Settings section instead.

## Memories

Kyro can save explicit long-term memories when the user asks clearly, for example:

- "Remember that we prefer short replies."
- "For future reference, our service area is Brisbane inner east."
- "Note that John is our main supplier contact."

Kyro should not treat every casual statement as a permanent memory. Memories are for deliberate user instructions or durable context.

Kyro can also suggest a memory when a message sounds like a durable preference, policy, or future instruction but the user did not explicitly say "remember". Suggested memories are shown for approval in the Assistant. They do not affect future context unless the user presses Remember. If the user dismisses a suggestion, it remains rejected rather than being silently used later.

Kyro also keeps compacted Assistant context snapshots behind the scenes. The user
does not need to manage threads or start a new chat. Raw Assistant turns remain
stored, while older chat context is summarized into daily snapshots and
weekly/monthly rollups. Normal turns receive only recent messages, approved
memories, the rolling thread summary, and a few relevant snapshots. If the user
asks what was discussed earlier, Kyro can search those snapshots and the saved raw
message log instead of stuffing months of chat into every model prompt.

## Data And Audit Trail

Kyro records meaningful actions so users and builders can understand what happened. Assistant turns, AI runs, model route decisions, usage events, settings changes, email sync events, and important mutations are recorded in the database and/or audit log.

This audit-first posture is important because Kyro is meant to become an agentic operations system without becoming a black box.

## Performance And Loading

The web app avoids loading everything at once:

- main navigation routes are warmed in the background after idle,
- CRM and Inbox rows warm their detail panes only when the user shows intent
  by hovering, focusing, or touching a row,
- lower-frequency repeated lists avoid prefetching every detail page,
- Settings loads only the selected section's data,
- Usage/task/ledger data loads only when Usage is selected,
- filtered-out email details load only when the popup opens,
- reply composers inside filtered-out email cards mount only when opened,
- list/review queries are bounded to avoid slow UI as mock data grows,
- route-level loading skeletons cover the main logged-in screens, including
  Files, Log, Assistant, OpenAI Voice, Vapi Voice, CRM, Inbox, and Settings.

This should keep the web UI feeling responsive while preserving a clean future path to native iOS screens.

## iOS Direction

Kyro's current web UI is a proving ground. Product decisions should keep the future iOS app in mind:

- keep screens focused,
- avoid giant all-in-one pages where possible,
- prefer clear task panels and dedicated flows,
- treat Assistant, Voice, Inbox, and Settings as the most important mobile tab surfaces,
- make Inbox threads and Settings sections feel like focused drill-in screens on small viewports,
- keep data fetching behind clean server/API boundaries,
- make Assistant and Voice share the same context and permissions,
- make settings concepts understandable enough for a phone UI.

## Troubleshooting

If Kyro cannot answer a workspace question:

- check that the user is signed in,
- check that workspace bootstrap completed,
- check whether the relevant records exist,
- ask Kyro to search by customer name, email, phone, job type, or quote title,
- use Inbox, CRM, Documents, or Log to inspect source records.

If inbound email does not work:

- check that Google or Outlook is connected,
- check whether the account needs reconnecting for read scopes,
- check inbound email sync mode,
- check quiet-hours settings,
- use the manual Check inbox button,
- ask Kyro to check recent email,
- check sync errors in Settings when surfaced.
- use Developer -> System Health to check provider scopes, worker secrets, recent sync failures, and Supabase/storage readiness.

If outbound email does not send:

- check that Gmail or Outlook is connected,
- check that the recipient contact has an email address,
- check whether the provider account needs reconnecting,
- open the conversation and look for a failed delivery or retry state,
- use Developer -> Outbox operations for deeper retry or dismiss controls,
- use Developer -> System Health for recent failed outbox rows and provider/worker readiness,
- check that `/api/outbox/process` is configured with the expected cron secret in production.

If SMS does not send or receive:

- check Settings -> Integrations for the Twilio readiness card,
- check `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`,
- set either an active workspace phone number or a testing sender such as `TWILIO_VOICE_NUMBER`,
- configure Twilio inbound SMS webhook to `${NEXT_PUBLIC_APP_URL}/api/integrations/twilio/sms`,
- configure Twilio delivery status callback to `${NEXT_PUBLIC_APP_URL}/api/integrations/twilio/status`,
- confirm the contact has a phone number for outbound SMS,
- use Developer -> Outbox operations if an SMS send failed after being queued.

If image generation does not work:

- check `OPENAI_API_KEY`,
- check that the private Supabase Storage bucket exists or can be created by the service-role server path,
- check that the uploaded reference files are supported images such as PNG, JPEG, or WebP,
- ask from the text Assistant for complex visual work so Kyro can use attachments and show the generated image card.

If voice does not work:

- check browser microphone permission,
- check `OPENAI_API_KEY`,
- check realtime model configuration,
- for Vapi Voice, check `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, the internal Vapi
  assistant id, and Vapi microphone permission,
- try the text Assistant to confirm the Assistant thread works,
- check Voice settings for the selected OpenAI voice,
- review pronunciation entries if speech sounds wrong.

If generated replies feel off:

- add a clearer instruction to the Generate with AI box,
- review and edit before sending,
- update communication tone/signature settings,
- add durable instructions as explicit memories if the preference should stick.

If a revised quote does not look right:

- open the linked quote from Inbox or Documents,
- check the current version pill and customer-request note,
- edit at least one quote field, line item, or note so Kyro can create the next version,
- use Send revised quote or ask Kyro to prepare the revised quote email,
- review the email draft before sending.

## Builder And Deployment Questions

This manual is primarily for end-user help. If the user asks as a builder about architecture, tests, environment setup, deployment, or why a system behaves a certain way internally, Kyro can also use the architecture summary and deployment checklist.

Relevant builder references include:

- `docs/current-architecture.md` for app structure, data flow, integration behaviour, known gaps, and verification commands.
- `docs/deployment-checklist.md` for production environment variables, OAuth setup, Supabase checks, cron sync, outbox processing, OpenAI/realtime voice, and deployment smoke tests.
- OpenAI image generation needs server-side `OPENAI_API_KEY`; optional `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE`, and `OPENAI_IMAGE_QUALITY` values control the image provider defaults. Current app defaults use `gpt-image-2`, high quality, and `auto` size unless the prompt explicitly asks for landscape, portrait, or square. Costing prefers provider-returned image token usage; `OPENAI_IMAGE_COST_PER_IMAGE` is only a fallback, and `OPENAI_IMAGE_*_COST_PER_1M` token-price overrides can update the pricing snapshot without code changes.
- Google address lookup needs server-side `GOOGLE_MAPS_API_KEY`; `GOOGLE_ADDRESS_VALIDATION_API_KEY` can override validation if a separate key is used. Optional `GOOGLE_MAPS_LOCATION_BIAS_LAT`, `GOOGLE_MAPS_LOCATION_BIAS_LNG`, and `GOOGLE_MAPS_LOCATION_BIAS_RADIUS_METERS` values bias autocomplete toward the service area.
- Twilio SMS needs server-side `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`.
  `TWILIO_MESSAGING_SERVICE_SID` is optional when sending through a messaging
  service, and `TWILIO_VOICE_NUMBER` can be used as a temporary testing sender.
  Production inbound SMS requires a `workspace_phone_numbers` row for the number
  Twilio sends to Kyro.
- `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run env:check` for local verification.

## How Kyro Should Answer Help Questions

When answering help questions, Kyro should:

- answer from this manual first,
- keep the answer concise unless the user asks for detail,
- explain settings in plain language,
- say what the current app can and cannot do,
- point to the relevant screen or Settings section when useful,
- avoid exposing implementation details unless the user is asking as a builder,
- never pretend a future feature is already complete.
