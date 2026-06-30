export const ASSISTANT_HELP_MANUAL = `# Kyro User Manual

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

- Vapi/Twilio phone calling has a backend foundation, but live numbers,
  assistant ids, production prompts, and call-provider credentials still need to
  be configured before real calls should be trusted.
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

Image generation works best from the text Assistant because the user can attach photos, plans, inspiration images, or written direction and then review the generated image card. Kyro stores uploaded references privately, calls OpenAI Images when the request is clearly visual, saves the result as a Kyro file, and shows open/download actions in chat and Files. Follow-up edits such as "make it night time" reuse the latest generated image saved in the current Assistant thread, so they can recover even after a browser refresh or dev-server restart. Kyro lets OpenAI choose the image size by default, but pins the closest supported size when the user clearly asks for a format: landscape/wide/16:9-style requests use the landscape size, portrait/vertical/9:16-style requests use the portrait size, and square/1:1/9:9 requests use square. For quote/invoice PDFs, use Files; image generation is for one-off visuals, concepts, and marketing material rather than transactional documents.

The suggestion buttons above the Assistant message box are adaptive. Kyro keeps a
small stored set of reusable, customer-agnostic prompts for each workspace user,
based on the user's recent first-of-day or first-of-session Assistant requests.
The visible four suggestions can rotate from the stored list over time. Kyro must
not turn specific customer names, addresses, emails, phone numbers, or one-off
file ids into suggestion buttons.

The Assistant persists conversation history for the main user chat without making the user manage chat threads. Kyro uses internal threads, summaries, and best-effort context snapshots to keep context efficient over time. If snapshot storage is unavailable, chat turns continue from raw recent messages and saved memories. Separate customer-facing calls or future channel conversations can use their own internal threads while still receiving the right CRM context.

## Voice Screen

The Voice screen is Kyro's live voice mode. It uses OpenAI Realtime over WebRTC so the user can talk naturally and hear Kyro respond in the selected assistant voice.

Voice mode is intended to be the same assistant as the text Assistant:

- same workspace,
- same Assistant thread,
- same memory context,
- same LLM-first tool planner and audited tool executors,
- same help/manual access,
- same safe settings permissions,
- same connected email sync tool,
- same public web search tool when enabled.

Use Voice when the user wants a more natural back-and-forth conversation. Use text Assistant when the user wants to review cards, links, details, or typed instructions.

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

Settings -> Connected accounts includes the beta phone/SMS enablement flow.
Kyro lists available preloaded Twilio numbers for the workspace operating
country, the user chooses one, and Kyro assigns that number only to that
workspace. The action records a one-time US$6 phone-number activation charge in
\`usage_events\` and enables the workspace's inbound/outbound phone assistant
flags. Admins preload numbers as \`workspace_phone_numbers\` rows with no
\`workspace_id\`, \`provider = twilio\`, \`status = available\`, country and
region metadata, SMS and voice capabilities, the Twilio provider phone-number
id, and the Vapi phone-number id in metadata when calls should route through
Vapi.

Inbound SMS to a workspace Kyro/Twilio number follows the same CRM ingestion path
as manual or email inquiries: Kyro matches the sender by normalized phone where
possible, creates or reuses the contact/conversation, records the message, and
runs AI triage. Messages from the business owner, staff, family, or apprentices
will need explicit operator-number rules later; the current first pass treats
unknown inbound numbers as normal external messages.

Phone calls are handled differently from ordinary text messages. Kyro stores the
call itself as a \`voice_calls\` record, then links it to a contact, conversation,
or lead when there is enough context. The Assistant Kyro activity pane can show:

- inbound customer calls,
- voicemail overflow calls,
- calls from known user/team numbers,
- outbound customer calls started through the backend.

Opening a call activity item shows call status, call purpose, the customer or
caller number, linked CRM context, transcript, summary, recording URL when Vapi
provides one, and recent provider events. If a call came from a user/team number,
Kyro should treat it as an instruction source rather than a customer enquiry.

The mobile app should use the same backend routes rather than implementing a
separate phone stack: \`GET /api/assistant/activity\` for the Kyro activity list,
\`GET /api/voice/calls/[callId]\` for call details, and \`POST /api/voice/outbound\`
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
- shows a Kyro \`Replied\` pill when Kyro has replied through this popup.

The \`Replied\` indicator is Kyro's internal log only. It does not try to detect replies sent directly in Gmail or Outlook.

Promoting a filtered-out email creates or reuses the normal CRM contact, lead, conversation, inbound message, and AI triage path. Kyro tries to refetch the original email from Gmail or Outlook when possible; if that is unavailable, it can still create a minimal work item from the stored sender, subject, summary, and classification metadata.

Replying to a filtered-out email does not create a normal conversation unless the user promotes it. Kyro still records the reply through the outbound delivery ledger and shows its own \`Replied\` indicator once the provider send has succeeded.

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

Scheduled retry processing lives behind the protected \`/api/outbox/process\` endpoint. End users should not need to call that route directly; it is for cron or operator tooling.

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

The old \`/leads\` route redirects to CRM because leads are now a CRM filter rather than a separate primary screen.

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

Address entry stores two layers of data. The visible \`address\` is the human-readable
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

Kyro uses a structured-document approach for quotes. The editable quote data stays in \`quote_drafts\`, while the customer-facing output is rendered from an HTML template at view time. This is deliberate: quotes, invoices, and other transactional documents need predictable totals, customer details, terms, and auditability.

Starting a quote from a reusable template opens an unsaved editor first. Kyro does not create a saved \`quote_drafts\` row just because the user clicks Create draft. If the user backs out without pressing Save quote draft, nothing is added to the Documents list. Pressing Save quote draft creates the real saved draft.

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

The customer approval page lives at \`/quote/approve/[token]\` and does not require the customer to sign in. The token is a bearer secret in the URL; Kyro stores a hash of it in \`quote_approval_links\` rather than storing the raw token. Customers can approve the quote or request changes. Approval marks the quote draft \`approved\` and records a \`customer_approved\` history event. Change requests mark the quote draft \`changes_requested\`, record the note, reopen the linked conversation when there is one, and add a portal-origin inbound message so the user sees the requested change in the work queue.

Quote revisions are tracked automatically. A new quote starts as \`v1\`. If a customer requests changes, the quote remains tied to the same draft but is flagged as needing revision in Inbox and Documents. The user edits the quote normally; once the content changes after the request, Kyro increments the version, for example from \`v1\` to \`v2\`, and treats the customer request as resolved for that revision. Sending the revised quote creates a fresh approval link and a new reviewable email draft. Older active approval links for the same quote are revoked when a fresh link is created.

When the user sends a generated quote email, Kyro regenerates the PDF attachment, stores or reuses the generated document record, stores retryable attachment bytes privately for the outbox when needed, queues/sends through the connected Gmail or Outlook account, records the outbound message, and marks the quote draft and generated document sent after provider acceptance.

Quote drafts also show a lightweight document and customer approval history. Kyro records document events in quote metadata when a PDF is downloaded, when an email is prepared with the PDF attached, when the PDF is actually sent, when a customer views the approval page, when they approve, and when they request changes. Each generated document metadata record includes a content hash of the quote data and template settings used to render it, plus the active quote version. The quote page compares that hash with the current quote content and can show whether the quote has changed since the last generated/prepared/sent document. Users can ask Kyro in Assistant or Voice questions such as "has this quote been sent?", "when did we send Sarah the bathroom quote?", "has Sarah approved the quote?", "did Sarah request changes?", "what version is the quote on?", or "has this quote changed since it was sent?"

Generated-document storage is now first-class for quote and invoice PDFs. Kyro records each generated PDF in \`generated_documents\`, stores the binary in private Supabase Storage through a \`files\` row, links it back to the quote draft/contact/lead/conversation, and keeps lightweight history snapshots on the quote draft for the timeline. The user can download saved PDFs or file them to Google Drive when a connected Google account has Drive access. Payment collection, bookkeeping, reconciliation, billing-provider integration, and full accounting exports are still future work.

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
- the System Health screen at \`/developer/system-health\`,
- the Smoke Test Checklist at \`/developer/smoke-tests\`,
- the Outbox operations screen at \`/developer/outbox\`,
- the Assistant tool registry at \`/developer/assistant-tools\`,
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

- General: workspace-wide defaults such as timezone and display currency.
- Integrations: connected email accounts, outbound reply/channel rules, signatures, inbound email sync, quiet hours, and sync limits.
- Voice: assistant voice, outbound pronunciation policy, and pronunciation vocabulary.
- Usage: customer-facing usage charge visibility, task/model breakdowns, and metered usage ledger.

Settings sections are URL-addressable so a link or assistant card can open the correct section directly.

## General Settings

General settings currently hold workspace-wide defaults.

Timezone lives in General because it affects multiple features. Kyro uses timezone for local-time behaviour such as quiet-hours email polling.

Users should enter an IANA timezone such as:

- \`Australia/Brisbane\`
- \`America/Denver\`
- \`UTC\`

Kyro can change the timezone when the user asks clearly, for example: "Set the timezone to Australia/Brisbane."

Display currency also lives in General. Kyro stores usage and provider ledger values in their original currency, currently USD for OpenAI-backed usage, but the app can display user-facing money values in the workspace's preferred currency. This currently applies to usage/billing summaries, usage ledger rows and CSV exports, small usage totals in Inbox/Contact/Log screens, and internal provider/margin pills. Quote and invoice documents keep their own document-template currency because those are customer-facing business documents, not Kyro usage charges.

The current display conversion layer uses placeholder static rates and clearly marks the rate provider internally. It is designed to be swapped for a live billing-provider rate source later, such as Stripe FX Quotes, without rewriting the UI.

Kyro can change the display currency when the user asks clearly, for example: "Set the display currency to AUD."

Default phone region also lives in General. It is only used when a customer gives
Kyro a bare local phone number without an international country code. Explicit
international numbers such as \`+61\`, \`+1\`, or \`+44\` keep their own country. The
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
- outbound voice pronunciation policy,
- Vapi phone assistant enablement,
- Vapi assistant ids for inbound calls, voicemail overflow, and outbound calls,
- the Vapi phone-number id used for customer-facing calls,
- user/team phone numbers that should be treated as internal callers,
- broad call style settings such as directness, detail level, warmth, and escalation behaviour,
- pronunciation vocabulary list,
- pronunciation preview controls.

OpenAI is the product-owned speech provider in the current app. Users choose the OpenAI assistant voice, not the underlying provider.

The saved voice is used for realtime voice and generated voice playback so Kyro sounds consistent across the app.

Vapi phone assistant settings are separate from the browser Voice screen. Browser
Voice is the logged-in user's live assistant. Vapi phone assistants are
customer-facing or phone-number-facing agents that run when a customer calls the
Kyro number, a voicemail overflow forwards to Kyro, or Kyro places an outbound
customer call. They use the same CRM backend and audit model, but each call is a
separate internal call record so customer conversations do not pollute the user's
main Assistant chat thread.

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

Aliases help Kyro recognise related terms and track usage. They do not automatically replace what Kyro says aloud. For example, if \`Woolloongabba\` has an alias \`the Gabba\`, Kyro can understand they may be related, but it should still say the words in the user's message unless the context calls for the full place name.

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

The current app does not yet place real outbound customer calls. The setting is stored now so future customer-facing voice can respect it.

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

\`Last successful sync\` means the last time Kyro completed a provider sync without a connection-level failure. \`Last check attempt\` means the last time Kyro tried to check that inbox, even if the attempt found a missing scope or failed.

\`Reconnect needed\` usually means the account was connected before Kyro requested inbox-read permission, the provider token now needs a fresh OAuth grant, or Kyro cannot decrypt the old stored token with the current integration encryption key. Disconnecting and reconnecting the provider grants the current scopes and stores a fresh encrypted token.

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

Provider/API cost and gross-margin snapshots are still recorded in \`usage_events\` and available for internal/dev visibility, but they are not the main customer-facing billing numbers. The main user-facing figure is \`Usage charge\`.

Usage charges are stored in the ledger's original currency for billing auditability, currently USD for OpenAI usage. The Settings usage screen displays those values through the workspace display currency preference. The usage ledger CSV export includes both the display amount and the stored amount so it remains useful for customer review and later billing reconciliation.

Kyro billing margin is cost-plus. \`KYRO_USAGE_MARKUP_RATE\` is the global default, but each workspace can store \`workspace_general.usageMarkupRate\` as an account-specific decimal margin. The workspace margin wins over provider-specific markup env vars for future usage rows only, so early accounts can be grandfathered while newer signups use a different margin.

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
Twilio SMS rows store provider \`twilio\`, service \`sms\`, and \`inbound_sms\` or
\`outbound_sms\` usage types. Kyro stores internal cost snapshots from Twilio-returned
prices or configured SMS unit-cost fallbacks, then stores the final user-facing
usage charge separately so billing can audit the exact amount without exposing
the internal margin.

The read-only billing export endpoint is \`/api/billing/usage\`. It returns stored
customer-charge snapshots for a monthly, weekly, or custom range so Stripe,
bookkeeping, or invoice workflows can consume the same append-only ledger.

Kyro user billing setup is part of account onboarding. New users add a credit or
debit card through Stripe Checkout setup mode to start the two-week free trial.
Existing users can change or add the saved payment method from Settings -> Usage
and billing -> Payment method. The Stripe webhook marks
\`workspace_policies.kyro_user_billing\` as ready when setup completes. This
stores the billing method state only; the actual post-trial metered
charge/invoice job still needs to be scheduled before automatic production
billing is live.

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

Gmail inbound sync needs read access such as \`gmail.readonly\`. Outlook inbound sync needs \`Mail.Read\`.

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
- repeated list rows avoid prefetching every detail page,
- Settings loads only the selected section's data,
- Usage/task/ledger data loads only when Usage is selected,
- filtered-out email details load only when the popup opens,
- reply composers inside filtered-out email cards mount only when opened,
- list/review queries are bounded to avoid slow UI as mock data grows.

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
- check that \`/api/outbox/process\` is configured with the expected cron secret in production.

If SMS does not send or receive:

- check Settings -> Integrations for the Twilio readiness card,
- check \`TWILIO_ACCOUNT_SID\` and \`TWILIO_AUTH_TOKEN\`,
- set either an active workspace phone number or a testing sender such as \`TWILIO_VOICE_NUMBER\`,
- configure Twilio inbound SMS webhook to \`\${NEXT_PUBLIC_APP_URL}/api/integrations/twilio/sms\`,
- configure Twilio delivery status callback to \`\${NEXT_PUBLIC_APP_URL}/api/integrations/twilio/status\`,
- confirm the contact has a phone number for outbound SMS,
- use Developer -> Outbox operations if an SMS send failed after being queued.

If image generation does not work:

- check \`OPENAI_API_KEY\`,
- check that the private Supabase Storage bucket exists or can be created by the service-role server path,
- check that the uploaded reference files are supported images such as PNG, JPEG, or WebP,
- ask from the text Assistant for complex visual work so Kyro can use attachments and show the generated image card.

If voice does not work:

- check browser microphone permission,
- check \`OPENAI_API_KEY\`,
- check realtime model configuration,
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

- \`docs/current-architecture.md\` for app structure, data flow, integration behaviour, known gaps, and verification commands.
- \`docs/deployment-checklist.md\` for production environment variables, OAuth setup, Supabase checks, cron sync, outbox processing, OpenAI/realtime voice, and deployment smoke tests.
- OpenAI image generation needs server-side \`OPENAI_API_KEY\`; optional \`OPENAI_IMAGE_MODEL\`, \`OPENAI_IMAGE_SIZE\`, and \`OPENAI_IMAGE_QUALITY\` values control the image provider defaults. Current app defaults use \`gpt-image-2\`, high quality, and \`auto\` size unless the prompt explicitly asks for landscape, portrait, or square. Costing prefers provider-returned image token usage; \`OPENAI_IMAGE_COST_PER_IMAGE\` is only a fallback, and \`OPENAI_IMAGE_*_COST_PER_1M\` token-price overrides can update the pricing snapshot without code changes.
- Google address lookup needs server-side \`GOOGLE_MAPS_API_KEY\`; \`GOOGLE_ADDRESS_VALIDATION_API_KEY\` can override validation if a separate key is used. Optional \`GOOGLE_MAPS_LOCATION_BIAS_LAT\`, \`GOOGLE_MAPS_LOCATION_BIAS_LNG\`, and \`GOOGLE_MAPS_LOCATION_BIAS_RADIUS_METERS\` values bias autocomplete toward the service area.
- Twilio SMS needs server-side \`TWILIO_ACCOUNT_SID\` and \`TWILIO_AUTH_TOKEN\`.
  \`TWILIO_MESSAGING_SERVICE_SID\` is optional when sending through a messaging
  service, and \`TWILIO_VOICE_NUMBER\` can be used as a temporary testing sender.
  Production inbound SMS requires a \`workspace_phone_numbers\` row for the number
  Twilio sends to Kyro.
- \`npm run test\`, \`npm run typecheck\`, \`npm run lint\`, \`npm run build\`, and \`npm run env:check\` for local verification.

## How Kyro Should Answer Help Questions

When answering help questions, Kyro should:

- answer from this manual first,
- keep the answer concise unless the user asks for detail,
- explain settings in plain language,
- say what the current app can and cannot do,
- point to the relevant screen or Settings section when useful,
- avoid exposing implementation details unless the user is asking as a builder,
- never pretend a future feature is already complete.
`;

export const CURRENT_ARCHITECTURE_ASSISTANT_SUMMARY = `# Current Architecture

This document is the practical handoff guide for humans and AI agents working on Kyro.
It explains how the current code is structured, where data flows, and which pieces are
real versus intentionally stubbed.

## Project Shape

Kyro is a TypeScript monorepo.

- \`apps/web\`: Next.js App Router web app.
- \`packages/db\`: Drizzle schema and migration source.
- \`packages/api\`: backend domain helpers for actions, events, bootstrap, usage, and policies.
- \`packages/ai\`: model routing helper.
- \`packages/contracts\`: shared TypeScript/Zod contracts.
- \`packages/core\`: product constants.
- \`packages/jobs\`: workflow placeholder package.
- \`supabase/migrations\`: generated SQL migrations applied to Supabase.
- \`docs\`: product, architecture, database, and backlog notes.
- \`docs/assistant-help-manual.md\`: user-facing help source the Assistant can answer from.
- \`docs/deployment-checklist.md\`: production/env verification checklist for the current stack.

## Runtime Stack

- Next.js App Router renders the web app.
- Supabase Auth handles sessions.
- Supabase Postgres is the source of truth.
- Drizzle owns schema/migration generation.
- Server Components read workspace data.
- Server Actions mutate data and then revalidate/redirect.
- Client Components are used only where local UI state improves UX, such as instant contact filters.

## Request Flow

The current web request pattern is:

\`\`\`mermaid
flowchart TD
    Browser["Browser"]
    Page["Next.js route/page"]
    Context["requireWorkspaceContext"]
    Supabase["Supabase SSR client"]
    DB["Supabase Postgres"]

    Browser --> Page
    Page --> Context
    Context --> Supabase
    Supabase --> DB
\`\`\`

Most routes call \`requireWorkspaceContext()\` before loading tenant data. This enforces:

- user must be signed in,
- user must have a bootstrapped workspace,
- all page data is loaded through the authenticated Supabase session.

Key file: \`apps/web/src/lib/workspace/context.ts\`.

## Data Ownership

All business data is workspace-scoped. The important tables are:

- \`contacts\`: CRM profiles.
- \`leads\`: sales/service opportunities attached to contacts.
- \`channels\`: communication source definitions.
- \`workspace_phone_numbers\`: workspace-owned Twilio phone/SMS numbers, capability
  metadata, provider ids, and pass-through rental cost snapshots.
- \`integration_connections\`: connected provider accounts such as Google Workspace,
  with encrypted token payloads and provider account metadata.
- \`integration_oauth_states\`: short-lived OAuth state and PKCE verifier records for
  provider connect flows.
- \`conversations\`: message threads.
- \`messages\`: inbound/outbound communication records.
- \`files\`: private file metadata for uploaded/generated/stored files, including inbound email attachments, assistant uploads, generated images, generated document PDFs, and outbound retry attachments stored in Supabase Storage.
- \`generated_documents\`: first-class quote/invoice PDF records linked to contacts, leads, conversations, quote drafts, storage files, outbound messages, and optional Google Drive file ids.
- \`inquiry_facts\`: current editable inquiry facts for a conversation, separate from raw AI output.
- \`events\`: idempotent ingestion and workflow events.
- \`actions\`: proposed or executable work, including AI-proposed replies.
- \`conversation_tasks\`: durable internal tasks linked to a conversation and optionally a message/action.
- \`conversation_appointments\`: durable appointment/site-visit records linked to a conversation, task, and optional action.
- \`conversation_notes\`: internal-only notes linked to a conversation and optionally a specific message.
- \`outbound_messages\`: durable outbound delivery queue/ledger for user and
  action-triggered sends, including idempotency keys, attempt counts, retry
  scheduling, provider metadata, and last-error state.
- \`quote_drafts\`: internal quote document placeholders created from approved actions.
- \`assistant_threads\`: persistent Assistant conversations per workspace/user.
- \`assistant_messages\`: saved Assistant/user turns, tool-call records, and UI block records.
- \`assistant_memories\`: active long-term Assistant memories plus pending/rejected
  suggested memories for user approval.
- \`assistant_context_snapshots\`: compacted daily/weekly/monthly Assistant context
  snapshots that let the single persistent chat stay responsive without losing
  searchable long-term history. Snapshot reads and compaction are best-effort:
  if the table is unavailable or Supabase has a stale schema cache, the Assistant
  continues from raw messages, memories, and the thread summary rather than
  failing the user's turn.
- \`assistant_prompt_suggestion_sets\`: per-workspace/user suggestion-pill sets
  generated from recent first-of-day/session Assistant prompts. The Assistant
  shows a rotating subset while the full stored set is available through
  \`/api/assistant/suggestions\` for the web and mobile apps.
- \`ai_runs\`: AI workflow records.
- \`model_route_decisions\`: model selection audit trail.
- \`usage_events\`: metered provider/API usage.
- \`audit_logs\`: append-only history of meaningful changes.

Schema source: \`packages/db/src/schema.ts\`.
Applied migrations: \`supabase/migrations\`.

## Auth And Workspace Bootstrap

Auth screens live in:

- \`apps/web/src/app/sign-in/page.tsx\`
- \`apps/web/src/app/auth/actions.ts\`
- \`apps/web/src/app/auth/callback/route.ts\`

Workspace creation lives in:

- \`apps/web/src/app/onboarding/page.tsx\`
- \`apps/web/src/app/onboarding/actions.ts\`
- \`apps/web/src/lib/workspace/bootstrap.ts\`

On account/workspace bootstrap, Kyro creates:

- user profile,
- workspace,
- owner membership,
- business profile,
- default policies,
- entitlements,
- budget,
- pricing rules.

## App Shell And Navigation

The shared logged-in shell is:

- \`apps/web/src/app/components/app-frame.tsx\`

Shared visual helpers:

- \`apps/web/src/app/components/brand-mark.tsx\`
- \`apps/web/src/app/components/page-skeleton.tsx\`
- \`apps/web/src/app/components/route-preloader.tsx\`
- \`apps/web/src/app/components/smart-prefetch-link.tsx\`

The shell also mounts a small client-side route preloader. After the browser is idle,
it staggers prefetches for the main logged-in routes so the high-traffic tabs feel
warmer without preloading every row/detail page. Nav links still leave automatic
Next prefetching off, but \`SmartPrefetchLink\` prefetches on user intent
(\`hover\`, keyboard focus, or mobile touch) so deliberate navigation feels
immediate without loading the whole app up front.

On narrow mobile viewports, the shell hides the desktop sidebar, exposes the full
navigation through a drawer menu, and pins a bottom quick-nav for Assistant, Voice,
Inbox, and Settings. Inbox and Voice metrics become horizontal, touch-friendly
summary strips instead of squeezed desktop cards, so the emergency web UI maps
more naturally to future iOS tabs.

Mobile detail surfaces intentionally do not use the desktop split-view pattern.
Assistant previews, Inbox message previews, selected CRM profiles, and Settings
detail screens become fixed full-screen task panels with their own scroll area
and a close/back action, similar to opening an email thread or Settings detail in
a mobile app. Desktop keeps the side-by-side split views.

The app shell currently exposes:

- Assistant: \`/assistant\`
- Voice: \`/voice\`
- Inbox: \`/inbox\`
- CRM: \`/contacts\`
- Files: \`/files\`
- Log: \`/\`
- Developer: \`/developer\`
- Settings: \`/settings\`

Legacy convenience routes:

- \`/leads\` redirects to \`/contacts\`.
- \`/documents\` and its child quote/template routes re-export the Files/quote
  implementation for compatibility with older links.
- \`/usage\` redirects to \`/settings#usage\`.

## Assistant Prompt Suggestions

Assistant suggestion pills are no longer hard-coded as the only source of truth.
The web page loads the latest active \`assistant_prompt_suggestion_sets\` row for
the current workspace/user, rotates four visible suggestions from the stored
list, and falls back to safe defaults if the table is missing or empty.

Generation lives in \`apps/web/src/lib/assistant/prompt-suggestions.ts\`.
The generator looks at the first few user prompts per Assistant thread/day from
the previous week, removes attachment context, rejects customer-specific details
such as names, emails, phone numbers, addresses, and file ids, then asks OpenAI
for a reusable list when available. If OpenAI is unavailable, deterministic
fallback scoring still produces a useful customer-agnostic list.

APIs:

- \`GET /api/assistant/suggestions\`: returns the current visible/stored
  suggestion set. It accepts normal web cookies or a Supabase bearer token for
  mobile clients.
- \`POST /api/assistant/suggestions\`: manually refreshes the current user's
  suggestion set.
- \`GET|POST /api/assistant/suggestions/refresh\`: scheduled refresh endpoint
  protected by \`ASSISTANT_SUGGESTION_REFRESH_SECRET\` or \`CRON_SECRET\`.

\`vercel.json\` schedules the refresh weekly. The route uses the service role to
walk workspace members, but each generated set remains tied to a specific
workspace and user.

## Current Screens

### Log

File: \`apps/web/src/app/page.tsx\`

Purpose:

- show a chronological workspace activity timeline,
- combine recent inbound/outbound messages, actions, events, audit logs, AI runs, model route decisions, and usage events,
- filter the timeline by all activity, messages, inbound, outbound, actions, events, audit, AI runs, routing, or usage,
- search the timeline by customer/message/action/model text, type/source/channel/model, detail/body text, and date range,
- show compact message/action/usage metrics,
- show a latest-activity summary and event-type breakdown.

The old dashboard concept has been collapsed into \`Log\`. Operational work now happens
primarily in Assistant, Inbox, CRM, Files, and Settings.

### Developer

Files:

- \`apps/web/src/app/developer/page.tsx\`
- \`apps/web/src/app/developer/outbox/page.tsx\`
- \`apps/web/src/app/developer/outbox/actions.ts\`
- \`apps/web/src/app/developer/assistant-tools/page.tsx\`
- \`apps/web/src/app/developer/system-health/page.tsx\`
- \`apps/web/src/app/developer/smoke-tests/page.tsx\`
- \`apps/web/src/lib/assistant/tool-registry.ts\`
- \`apps/web/src/lib/developer/system-health.ts\`

Purpose:

- hold internal test tools away from the main product surfaces,
- expose the mock inbound inquiry form for local testing,
- submit through the same \`createManualInboundAction\` and \`ingestManualInbound\` flow
  used by previous dashboard/manual testing,
- redirect back to \`/developer\` with success/error messages after ingestion,
- expose an internal outbox operations surface at \`/developer/outbox\` for queued,
  retry-scheduled, failed, sent, and dismissed outbound delivery rows,
- let an operator retry queued/scheduled/failed outbox rows or dismiss dead test
  rows without deleting audit history,
- expose an Assistant tool registry at \`/developer/assistant-tools\` so production
  tools, permission gates, provider status, and renderable UI blocks can be
  reviewed in one place,
- expose a read-only System Health screen at \`/developer/system-health\` for
  environment presence, Supabase table API availability, private storage bucket
  readiness, connected-account scope readiness, cron/worker readiness, provider
  configuration, and recent failed operational rows,
- expose a Smoke Test Checklist at \`/developer/smoke-tests\` that turns those
  readiness checks into a manual runbook for mock inbound, reply sending,
  generated documents, outbox inspection, inbound sync, and log/audit visibility.

The Developer page is not intended as an end-user surface. It is a convenient place
to keep test controls while Gmail, Drive, SMS, and other integrations are being wired.
Developer health checks deliberately report whether required configuration exists
without printing secret values, and the smoke-test checklist does not create test
records by itself.

### Inbox

Files:

- \`apps/web/src/app/inbox/page.tsx\`
- \`apps/web/src/app/inbox/[conversationId]/page.tsx\`
- \`apps/web/src/app/inbox/actions.ts\`
- \`apps/web/src/app/inbox/message-workflow-controls.tsx\`
- \`apps/web/src/app/inbox/conversation-workflow-panel.tsx\`

Purpose:

- list conversations,
- show profile-review warnings,
- open an inquiry review page,
- act as the main work queue for what needs attention next.

The inbox work queue derives buckets from conversation status, saved inquiry facts,
action status, and quote draft presence. Current buckets include needs reply,
missing info, ready to quote, site visit needed, awaiting customer, resolved,
needs review, and needs approval. The page also supports server-side search and
sorting without adding a separate search service.

Performance notes:

- the app shell uses \`RoutePreloader\` to idle-prefetch the main tabs with a short stagger,
- list pages disable prefetch on long repeated rows so the app does not pre-render
  dozens of detail pages at once,
- list/review queries are bounded so mock data growth does not silently make every
  tab click heavier,
- inbox split-view loads the conversation list, selected preview, and communication
  settings in parallel once workspace context is resolved,
- Settings renders its menu without fetching every detail panel; each selected
  section loads only its own server data, and the full usage ledger is loaded only
  for \`?section=usage\`,
- route loading skeletons exist for the log, inbox, inquiry review, CRM, contact
  profile, leads redirect, documents, quote draft profile, assistant, voice, usage
  redirect, and settings pages,
- the development LLM status pill caches its local Ollama health check briefly and is
  rendered behind a Suspense boundary so page content is not blocked by a local model probe.

The inquiry review page shows:

- compact contact profile summary,
- compact lead status,
- AI-extracted inquiry facts such as job type, address, preferred time, urgency, budget, lead suitability, and missing fields,
- editable current inquiry facts that can be corrected by the user,
- a regenerate control that uses the saved corrected facts as the authoritative source for a fresh AI plan,
- a collapsed AI transparency trace showing model, fallback, token usage, proposed action types, and raw debug JSON,
- message thread,
- text channel labels on message rows,
- per-message controls to assign a task, mark the message resolved, and add an internal note,
- durable task and appointment panels for internal follow-up/site-visit work,
- outbound composer for email, SMS, phone, or manual notes,
- reusable AI reply prompt for manual outbound composers; generated drafts also use the saved workspace writing style for tone, wording, length, sign-off, trade phrasing, and reusable instructions,
- outbound metadata including channel type, dry-run/external-send state, provider message id, provider request id, local attachment summaries, quote draft attachment references, and the linked outbox delivery id,
- outbound delivery state showing queued/sending/sent/failed/retry-scheduled attempts with retry controls for failures,
- automatic internal customer follow-up reminders after outbound replies, driven by workspace communication settings,
- mock follow-up inbound message form,
- draft reply work surface,
- action-specific proposal cards for missing info, site visits, quote drafts, and not-fit decisions,
- saved quote draft placeholders when a quote draft action has been executed,
- latest AI triage summary,
- workflow timeline,
- editable draft replies before approval,
- proposed actions and approval/execution controls,
- conversation status controls,
- usage events collapsed by default,
- audit history collapsed by default.

Outbound email can send through the connected Gmail or Outlook account. The shared
mail abstraction selects the latest connected Google or Microsoft provider, and the
outbound layer writes a durable \`outbound_messages\` row before any provider call.
That row stores the recipient, subject/body, private file references for retryable
attachments, idempotency key, attempt count, retry schedule, provider
message/request ids, and last error. User-written manual replies are treated as already approved because the
user typed the body and pressed send; email sends immediately through the connected
email provider when a contact email exists, but the send is still traceable and
retryable through the outbox ledger. AI-generated/action-queue replies still go
through the action engine and approval/execution controls. SMS can send through
Twilio when the workspace has an active SMS-capable number or testing sender
configured; phone and manual channels remain internal records. Email sends can
include local file uploads from the composer and a server-generated PDF
attachment for a selected quote draft. Generated quote PDFs are created on demand
from structured quote data; before delivery, attachment bytes are uploaded into
the private Supabase Storage bucket (\`KYRO_FILE_STORAGE_BUCKET\`, default
\`kyro-files\`) and the outbox keeps \`files\` metadata references rather than binary
payloads in Postgres. This same outbox path is also used for replies to
filtered-out/skipped email events, which record an \`outbound.filtered_email.reply_sent\`
event after provider acceptance instead of bypassing the delivery ledger.
Scheduled outbox retry processing lives at \`/api/outbox/process\`, protected by
\`OUTBOUND_DELIVERY_SECRET\`, \`INBOUND_EMAIL_SYNC_SECRET\`, or \`CRON_SECRET\`.
\`vercel.json\` schedules it every five minutes. Failed provider sends move to
\`retry_scheduled\` until attempts are exhausted; the Inbox preview also exposes
manual retry for failed or scheduled delivery rows. Developer -> Outbox operations
is the cross-conversation operational view for the same ledger: it shows
active/sent/dismissed delivery rows, provider ids, attachment summaries, last
errors, reconnect guidance, manual retry, and an operations-only \`dismissed\`
state for clearing stale test failures without deleting records.
Email signatures are Kyro-managed per workspace: one default signature for manual or
user-edited sends, plus an optional assistant signature for untouched AI-generated
replies. Signature settings live inside the \`communication_outbound\` policy, support
text plus a small inline logo, and are applied during outbound execution rather than
relying on the user's native email signature.
Outbound writing style is also Kyro-managed per workspace in the
\`communication_outbound\` policy. The Settings -> Connected accounts -> Outbound
communication panel has a prompt editor for tone, wording style, message length,
sign-off instructions, trade-specific phrasing, and reusable reply instructions.
The on-demand inbox reply generator and inbound triage draft path both inject
these saved settings into the LLM prompt before creating customer-facing email/SMS
drafts.
Real Gmail/Outlook sends also write zero-cost \`usage_events\` rows so the billing endpoint can
count outbound email volume before paid pricing is decided. Real Twilio SMS sends
write \`outbound_sms\` usage rows with internal cost and final user-facing charge
snapshots based on Twilio-returned price when available or the configured local
SMS unit-cost fallback.

Inbound SMS has a first Twilio webhook foundation. \`POST /api/integrations/twilio/sms\`
validates the Twilio signature, matches the destination number against
\`workspace_phone_numbers\`, records or reuses a Twilio SMS channel, ingests the SMS
through the same workspace-scoped contact/lead/conversation/message/AI-triage path
as manual inbound, and records inbound SMS usage. The status callback route at
\`/api/integrations/twilio/status\` updates matching outbox rows with Twilio delivery
state. Number search/purchase, staff/operator SMS-command routing, and voice calls
are still future work.

### CRM

Files:

- \`apps/web/src/app/contacts/page.tsx\`
- \`apps/web/src/app/contacts/[contactId]/page.tsx\`
- \`apps/web/src/app/contacts/actions.ts\`
- \`apps/web/src/lib/crm/profile-resolution.ts\`
- \`apps/web/src/app/leads/page.tsx\`

Purpose:

- list contact profiles and leads in one CRM surface,
- keep the CRM list on the left and the selected profile on the right,
- filter by all, leads, profile review, clients, suppliers, contractors, builders, property managers, or other,
- search by name/company/job/contact details,
- expand advanced search fields for email, phone, and address,
- sort by last interacted, alphabetical, most messages, or most leads,
- keep active filters, search, sort, and selected profile in the URL so navigation and saves do not lose context,
- edit contact fields,
- edit a contact's lead/client lifecycle stage separately from their contact category,
- show normalized email/phone duplicate warnings when another profile shares the same identity value,
- show a dedicated profile-resolution panel when an inquiry creates an email/phone conflict or normalized identity duplicates are detected,
- merge duplicate profiles in either direction while moving linked messages, leads, conversations, inquiry facts, quote drafts, and contact-targeted actions to the kept profile,
- keep merged source profiles archived with \`merged_into_contact_id\` so audit history is not discarded,
- show other people attached to the same normalized company name,
- show lifecycle review suggestions that can be applied or ignored from the CRM profile,
- show all linked conversations, leads, messages, AI runs, actions, audit history, and quote drafts linked to the contact.

\`/leads\` now redirects to \`/contacts\`; leads are a CRM filter rather than a separate primary tab.

Contact types currently supported:

- \`client\`
- \`supplier\`
- \`contractor\`
- \`builder\`
- \`property_manager\`
- \`other\`

Shared helpers:

- \`apps/web/src/app/components/address-autocomplete-field.tsx\`
- \`apps/web/src/app/api/addresses/autocomplete/route.ts\`
- \`apps/web/src/app/api/addresses/place/route.ts\`
- \`apps/web/src/lib/addresses/google.ts\`
- \`apps/web/src/lib/addresses/form.ts\`
- \`apps/web/src/lib/crm/contact-types.ts\`
- \`apps/web/src/lib/crm/identity.ts\`
- \`apps/web/src/lib/crm/lifecycle.ts\`
- \`apps/web/src/lib/crm/lifecycle-review.ts\`
- \`apps/web/src/lib/crm/profile-resolution.ts\`

Contact identity fields are stored directly on \`contacts\`: \`normalized_email\`,
\`normalized_phone\`, and \`normalized_company\`. The database migration
\`20260526020904_contact_identity_normalization.sql\` backfills those fields and
adds a trigger so edits keep the normalized values current. The follow-up
\`20260526022516_international_phone_identity_normalization.sql\` migration updates
the phone normalizer to store canonical international-style phone values. App-side
normalization uses \`libphonenumber-js\`, trying the workspace default phone region,
the main launch markets, and then the wider supported country list; explicit
international formats such as \`+61\`, \`+1\`, \`+44\`, \`0086\`, \`01181\`, and \`001149\`
normalize without being tied to Australia. Exact matching and duplicate warnings
use those normalized fields instead of repeatedly scanning raw email/phone
strings. \`20260526071536_contact_profile_resolution.sql\` adds the profile
resolution columns and adjusts the contact identity trigger so app-supplied
default-region phone normalization is preserved on writes.

Profile resolution fields are also stored directly on \`contacts\`:
\`profile_resolution_status\`, \`profile_resolution_reason\`,
\`profile_conflict_contact_ids\`, \`merged_into_contact_id\`,
\`profile_resolved_at\`, and \`profile_resolved_by_user_id\`. Manual and inbound
contact creation marks email/phone conflicts as \`needs_review\`; the CRM profile
panel lists the candidate profiles and provides merge buttons. A merge marks the
source profile \`merged\`, points it at the kept profile, moves attached CRM work
to the kept profile, records a completed \`merge_contact_profiles\` action, and
writes audit entries for both source and target. Normal CRM list/search views
hide archived merged sources, while the kept profile shows its merged sources
and includes their source-contact audit ids in the profile audit query.

Address fields are stored as both human-readable text and structured data.
\`contacts\` and \`inquiry_facts\` keep the display address in \`address\`, while
Google/manual metadata lives in \`address_line1\`, \`address_line2\`,
\`address_locality\`, \`address_administrative_area\`, \`address_postal_code\`,
\`address_country_code\`, \`address_latitude\`, \`address_longitude\`,
\`address_place_id\`, \`address_source\`, \`address_validation_status\`,
\`address_validated_at\`, and \`address_structured\`. The reusable
\`AddressAutocompleteField\` calls protected server routes for Google Places
Autocomplete and Place Details so the browser never needs a public Maps key.
Autocomplete requests are restricted to the workspace default phone country
(\`defaultPhoneRegion\`) and can also use an optional server-side operating-area
bias from \`GOOGLE_MAPS_LOCATION_BIAS_LAT\`, \`GOOGLE_MAPS_LOCATION_BIAS_LNG\`, and
\`GOOGLE_MAPS_LOCATION_BIAS_RADIUS_METERS\`. The country restriction prevents
irrelevant overseas matches, while the location bias nudges results toward the
business service area without blocking valid interstate work inside that country.
Selecting a Google result stores structured components and validation metadata;
typing an address manually still works and stores the address as manual/unverified.
The same component is currently wired into CRM profile editing, Inbox inquiry-fact
editing, and Developer mock inbound.

Contact lifecycle fields are also stored directly on \`contacts\`:
\`lifecycle_stage\`, \`lifecycle_source\`, \`lifecycle_reason\`, and
\`lifecycle_reviewed_at\`. \`lifecycle_stage\` currently supports \`lead\` and
\`client\`. This is separate from \`contact_type\`: a profile can be a client,
supplier, contractor, builder, property manager, or other contact type while
still being in a lead/client lifecycle stage. Manual user changes set
\`lifecycle_source\` to \`manual\` and are treated as authoritative by automated
review until the user clears the manual override from the CRM profile panel.

The lifecycle review engine can run from CRM profile/list buttons or from the
protected \`/api/crm/lifecycle/review\` route. \`vercel.json\` schedules that route
every six hours in production, using \`CRM_LIFECYCLE_REVIEW_SECRET\` or
\`CRON_SECRET\`. The review looks at linked leads, messages, quote drafts, quote
approval links, contact-targeted business actions, and future commercial record
inputs such as paid invoices, booked jobs, work orders, and billing records.
When a non-manual profile appears stale, it creates a \`review_lifecycle_stage\`
action against the contact with the recommended stage, confidence, evidence,
and reason. Automated review is intentionally suggestion-only for now, including
high-confidence evidence. Applying the suggestion updates the contact lifecycle
and writes audit history; ignoring it completes the suggestion without changing
the contact.

### Files

Files:

- \`apps/web/src/app/files/page.tsx\`
- \`apps/web/src/app/documents/page.tsx\` compatibility re-export
- \`apps/web/src/lib/files/library.ts\`
- \`apps/web/src/app/files/new/page.tsx\`
- \`apps/web/src/app/documents/new/page.tsx\` compatibility re-export
- \`apps/web/src/app/documents/[quoteDraftId]/page.tsx\`
- \`apps/web/src/app/documents/[quoteDraftId]/pdf/route.ts\`
- \`apps/web/src/app/documents/[quoteDraftId]/print/route.ts\`
- \`apps/web/src/app/documents/templates/new/page.tsx\`
- \`apps/web/src/app/documents/templates/new/template-builder-form.tsx\`
- \`apps/web/src/app/documents/templates/[templateKey]/page.tsx\`
- \`apps/web/src/app/api/documents/templates/revise/route.ts\`
- \`apps/web/src/app/documents/actions.ts\`
- \`apps/web/src/lib/documents/pdf.ts\`
- \`apps/web/src/lib/documents/generated-documents.ts\`
- \`apps/web/src/lib/documents/render.ts\`
- \`apps/web/src/lib/documents/revisions.ts\`
- \`apps/web/src/lib/documents/settings.ts\`
- \`apps/web/src/lib/documents/template-revision.ts\`
- \`apps/web/src/lib/documents/templates.ts\`

Purpose:

- show a saved file library for generated images, uploaded files, inbound/outbound email attachments, and generated PDFs,
- let users open previewable images/PDFs inline or download any stored file through \`/api/files/[fileId]\`,
- list saved quote drafts,
- filter quote drafts by all, draft, ready, approved, changes requested, sent, archived, linked, or unlinked,
- open an unsaved quote-draft editor from saved reusable templates,
- create custom reusable quote templates in the template builder,
- review and edit saved templates from the Templates pane,
- create and revise saved reusable templates through Assistant or Voice,
- open and edit a quote draft,
- search existing CRM contacts through \`/api/contacts/search\` and select one to populate editable quote customer fields
  and link the saved draft to that contact,
- save customer/job details into \`quote_drafts.metadata\`,
- save editable line items into \`quote_drafts.line_items\`,
- edit line items through repeatable row fields rather than pipe-delimited text,
- save workspace-level document template settings and custom templates in \`workspace_policies\` under policy type \`document_templates\`,
- render customer-facing quote output as print-ready HTML from structured quote data,
- let users open the print view and save through the browser's Print / PDF flow,
- let users download a server-generated PDF from the quote draft,
- save generated quote and invoice PDFs as \`generated_documents\` rows backed by private Supabase Storage and \`files\` metadata,
- generate an invoice PDF from a saved quote draft using the same user-defined document template/design settings, without payment processing, bookkeeping, or reconciliation,
- file saved generated PDFs to Google Drive when the user explicitly approves the filing action,
- prepare a customer email with the generated quote PDF attached and route that email through the normal approval/send action flow,
- create secure customer approval links for quote drafts,
- let customers approve a quote or request changes from a public no-login review page,
- surface quote change requests in the linked inbox conversation and document editor,
- track quote revision metadata so revised quotes can be resent as \`v2\`, \`v3\`, and so on,
- hand a linked quote draft back to the inquiry outbound composer with that draft preselected,
- show linked CRM context, recent thread messages, and audit history when the draft came from an inquiry.

The navigation label and canonical top-level route are now \`Files\` at \`/files\`.
Older \`/documents\` quote/editor routes remain as compatibility re-exports for
existing links. The top-level page loads the file library from private \`files\` metadata through the service role after
\`requireWorkspaceContext()\` has scoped the user to a workspace. File downloads still go through the authenticated
\`/api/files/[fileId]\` route, which checks the current workspace before streaming private Supabase Storage bytes.

Quote drafts remain the structured source of truth. The customer document is generated from that saved data at view
time rather than stored as the canonical record. Customer fields can be populated from an existing CRM contact via an
async typeahead search, but the quote still stores editable metadata for the sent document state. Line item rows save
structured descriptions, quantities, units, unit prices, calculated totals, and optional per-line notes. This keeps totals, customer details,
line items, terms, and audit history predictable while still allowing the visual template to evolve. The current output
is deterministic HTML for browser preview/printing plus deterministic server-side PDF generation through
\`apps/web/src/lib/documents/pdf.ts\`, not a GPT-generated image. Download, prepare-send, and outbound attachment flows
record a first-class \`generated_documents\` row with lifecycle status, content hash, storage location, linked contact,
lead, conversation, quote draft, and backing \`files\` row. Quote metadata still keeps lightweight \`lastGeneratedDocument\`
and \`documentHistory\` snapshots for the timeline and revision checks, but the durable PDF record now lives in
\`generated_documents\`. User-approved Google Drive filing uploads the stored PDF through the connected Google account and
stores the Drive file id/link on the generated document record.
Customer approval links live in
\`quote_approval_links\`, which stores a hashed bearer token, lifecycle status, customer email, expiry, view/approval
timestamps, and the latest change-request note. The content hash is calculated from the quote draft, customer/job
details, line items, and document design settings with volatile send/history/approval metadata excluded, so the app can
flag when a quote has changed since the latest generated/prepared/sent PDF. Invoice PDF generation exists as a document
recording step only; payment collection, bookkeeping, reconciliation, and billing-provider integration are still out of scope.

Quote revisions are metadata-backed for now rather than a separate migration. \`quote_drafts.metadata.quoteRevision\`
stores the active version, pending or resolved customer change request, latest prepared/sent version, approval version,
and timestamps. \`apps/web/src/lib/documents/revisions.ts\` owns that state. A new draft starts at \`v1\`. When a customer
requests changes, Kyro marks the draft \`changes_requested\`, records the request against the current version, reopens the
linked inquiry, and shows a revision banner in both Inbox and Files. When the user edits the quote after that
request, Kyro increments the version, resolves the pending request, and returns the draft to the normal send path. The
next customer email is labelled as a revised quote, gets a fresh approval link, and records the new \`quoteVersion\` on
generated, prepared, sent, viewed, approved, and change-request history events. This gives the product a usable revision
loop now without committing to the later \`generated_documents\`/template-version tables.

The Documents template card opens \`/documents/new?templateKey=...\`, which pre-fills an unsaved editor from the selected
template. No \`quote_drafts\` row, audit log, or document-list entry is created until the user presses \`Save quote draft\`.
The save action then inserts the row, stores the selected template key and design snapshot in metadata, writes the audit
log, and redirects to the saved quote-draft profile.

The quote-draft editor is intentionally a single-column form on both the unsaved \`/documents/new\` route and saved
\`/documents/[quoteDraftId]\` route. Earlier right-side context cards for template summaries, preview totals, and output
metadata were removed so the editable customer fields and structured line items have enough horizontal space. Template
review remains in the reusable template builder, while customer-facing document review remains in the print/PDF route.

The \`Send to customer\` action on a linked quote draft creates a pending \`draft_reply\` action on the linked conversation.
It validates the linked customer email, creates a fresh quote approval link, generates the current PDF once to prove the
artifact can be built, stores \`lastGeneratedDocument\` metadata and an \`email_prepared\` history event on the quote draft,
moves a draft quote to \`ready\`, and redirects to the inquiry review screen. The email body includes the customer
approval URL so the customer can open \`/quote/approve/[token]\`, review the rendered quote, approve it, or request
changes. Downloading a PDF records a \`pdf_generated\` history event. The user can edit the email body before sending.
When the generated reply is sent, the action executor regenerates the quote PDF, attaches it to the Gmail/Outlook send,
records the outbound \`messages\` row, appends an \`email_sent\` history event with the active quote version, marks the
quote draft \`sent\`, and writes quote/message audit logs. Customer approval appends \`customer_viewed\`,
\`customer_approved\`, or \`customer_changes_requested\` events. Approval changes the quote status to \`approved\`; change
requests change it to \`changes_requested\`, reopen the linked conversation, insert a portal-origin inbound message so the
request appears in the work queue, and keep the requested version visible until the user edits/sends a revision. This
keeps the customer-facing side effect behind secure token lookup and the existing approval/execution machinery.

The \`document_templates\` policy stores product-safe presentation preferences plus custom reusable templates. Custom
templates include a stable key, label, description, line item structure, notes, reference-file metadata,
revision request, and a design settings snapshot: natural-language template direction, accent theme, currency,
validity days, payment terms, footer text, and whether to show the prepared-by footer. The natural-language direction
is an internal style instruction and must not be rendered as customer-facing copy. Saved templates can be opened at
\`/documents/templates/[templateKey]\` to review a live customer-quote preview, manually edit structured fields, or send a
bounded template-revision request through \`/api/documents/templates/revise\`. The revision API returns a proposed
structured template update only; it does not persist changes until the user saves the template form. The template
review preview is a scaled iframe of the same \`buildQuoteDocumentHtml\` renderer used by the print route, with print
chrome hidden, rather than a separate React mock of the document. The same iframe source can be opened in a larger
modal preview for closer inspection without changing template state. When a quote draft is created from a template, the
relevant design settings are copied into \`quote_drafts.metadata.documentTemplateSettings\`
so print output can remain consistent for that draft even if workspace defaults or future templates change. Quote draft
titles are generated from the selected template name plus a minute-level timestamp when a draft is created or a template
structure is applied. The template builder starts with blank line items and blank overall notes; users define the reusable
structure themselves rather than starting from product-supplied trade defaults. Inline information bubbles explain the
template builder sections without adding permanent helper copy to the screen.

The shared \`apps/web/src/lib/documents/template-revision.ts\` service owns the structured OpenAI template-revision
contract. The template builder API route uses it to propose unsaved preview changes, while the Assistant command router
uses it to create or revise saved reusable templates when the user explicitly asks through text or voice. Assistant
template updates preserve template keys on edit, write audit logs, and return cards to review the template or create a
draft from it.

Marketing and creative assets should use a separate generation path later. OpenAI image generation is a good fit for
marketing images, flyers, social graphics, or campaign visuals where creative variation is useful. Quotes, invoices,
and transactional documents should stay structured-first; AI can help fill content or propose template edits, but it
should not invent prices, totals, payment terms, or compliance-critical document facts.

### Assistant

Files:

- \`apps/web/src/app/assistant/page.tsx\`
- \`apps/web/src/app/assistant/assistant-console.tsx\`
- \`apps/web/src/app/assistant/actions.ts\`
- \`apps/web/src/app/api/assistant/transcribe/route.ts\`
- \`apps/web/src/lib/assistant/attachments.ts\`
- \`apps/web/src/lib/assistant/commands.ts\`
- \`apps/web/src/lib/assistant/conversation-links.ts\`
- \`apps/web/src/lib/assistant/context-compaction.ts\`
- \`apps/web/src/lib/assistant/providers.ts\`
- \`apps/web/src/lib/assistant/engine.ts\`
- \`apps/web/src/lib/assistant/tool-planner.ts\`
- \`apps/web/src/lib/assistant/transcription.ts\`
- \`apps/web/src/lib/assistant/ui-blocks.ts\`
- \`apps/web/src/lib/assistant/tool-registry.ts\`
- \`apps/web/src/lib/images/generation.ts\`

Purpose:

- provide a chat-style command layer over existing CRM data,
- persist the main user Assistant thread and messages across page refreshes,
- show a right-hand Kyro activity pane for inbound/outbound communication events
  that happen outside the chat while no preview is open,
- store known UI blocks such as link cards instead of letting the LLM invent UI,
- store planned and executed tool results as tool-call records,
- retrieve recent messages, a compact rolling thread summary, relevant approved memories, and ranked long-term context snapshots before each turn,
- ask the OpenAI Assistant tool planner to choose the right Kyro tool before deterministic keyword routing,
- execute the selected tool in audited deterministic code, then let the Assistant model narrate the result,
- fall back to the older deterministic router only when the planner is unavailable, fails, or local Ollama development mode is active,
- accept assistant file/image uploads, store them privately, and pass stored file context into the turn,
- generate one-off images/renderings through OpenAI Images and save the result as a private Kyro file,
- accept browser-recorded voice notes, transcribe them server-side, and submit the transcript through the normal Assistant turn flow,
- record assistant turns as \`ai_runs\`, \`model_route_decisions\`, \`usage_events\`, and \`audit_logs\`,
- keep provider handling swappable for later cloud model APIs.

The Assistant chat is now LLM-first for OpenAI routes. \`tool-planner.ts\` sends the
current prompt, compact recent message context, recent generated-image metadata,
thread summary, and input source to OpenAI Responses with a fixed list of Kyro
function tools. The model can select one tool such as work queue, inquiry lookup,
quote send, image generation, image recall, email sync, assistant history search, settings update, memory
save, or app help. If the model successfully decides no tool is needed, Kyro treats
the turn as normal conversation instead of letting the keyword router overrule it.
If the planner is not available, returns an error, or the route is Ollama/local,
Kyro falls back to \`commands.ts\` deterministic intent detection so development
and degraded provider states still work. The LLM never executes the tool itself:
\`commands.ts\` validates the selection, runs workspace-scoped Supabase/provider
code, creates known UI blocks, and records audit/usage/tool-call metadata before
\`providers.ts\` writes the final response.

Current safe command families:

- work queue and leads needing reply,
- inbound email sync and awareness, including recent promoted/filtered email, skipped mail, and attachment-bearing messages,
- inquiry lookup by customer/job text, including exact and partial name matches,
- quote/document lookup and ready quote drafts,
- quote-send preparation that creates a reviewable email with the generated quote PDF and customer approval link attached,
- one-off image generation, image-reference editing, renovation concept renders, and simple marketing/social graphics,
- contact/customer summaries,
- standalone quote draft creation from saved reusable templates,
- reusable document template creation and revision,
- explicit memory capture when the user says things like "remember..." or "for future...",
- pending memory suggestions when a durable preference is implied but the user
  did not explicitly say to remember it,
- usage summaries, richer contact timelines, queue summaries, and approval queue
  UI blocks,
- general conversational turns that do not render CRM cards unless the user asks for CRM data.

Assistant writes are intentionally narrow. It can create internal quote drafts from templates, because that is a
document-only action and the user has explicitly instructed it in the prompt. Assistant document creation uses the same
saved reusable templates as the Documents screen, matches the prompt against template labels, descriptions, and keys,
asks the user to choose when multiple templates match a vague request, and links a contact when the prompt clearly names
an existing contact by name, company, email, or phone. The created row stores the template key, the template design
settings snapshot, reference-file metadata, and editable customer/job metadata in \`quote_drafts.metadata\`. Assistant
template control can also create a new reusable template or revise an existing one using the same structured revision
contract as the template builder; if multiple templates could match, it asks the user to choose rather than mutating an
arbitrary template. Assistant quote-send preparation can list ready-to-send quote drafts, match a send request to a
single open quote by customer/title/email, validate that the quote is linked to an inquiry and customer email, generate
the current PDF, create a fresh customer approval link, and create a pending \`draft_reply\` action with that quote
attached. For revised quotes it uses the active \`quoteRevision\` version and revised subject line. This is deliberately
preparation only: the user still reviews or edits the message in the inquiry before sending. Customers approve or request
changes from the public tokenized approval page, and Assistant can answer quote history/version questions using the
resulting customer view/approval/change-request events. From an Assistant inquiry preview, the user can also write a
manual reply; email replies send through connected Gmail or Outlook, SMS replies can send through Twilio when the workspace has an active SMS number or testing sender configured, phone calls use separate Vapi voice-call records, and manual channels remain internal records. The LLM does not
autonomously send email/SMS, execute approval-gated actions, alter payments, or perform bookkeeping.

Assistant image generation is deliberately a tool call, not arbitrary model output. Browser-selected files are first
stored in the private Supabase Storage bucket configured by \`KYRO_FILE_STORAGE_BUCKET\` and recorded as \`files\` rows with
\`source = assistant_upload\`. If the user asks for an image, render, concept, social graphic, or similar visual output,
\`apps/web/src/lib/images/generation.ts\` calls the OpenAI Image API with the saved prompt and up to eight supported
reference images from those stored files. The generated PNG/JPEG/WebP is uploaded back into the same private storage
bucket, recorded as a \`files\` row with \`source = generated_image\`, linked to an \`ai_runs\` row, metered as a
\`usage_events.image_generation\` row, and rendered in chat through a deterministic \`generated_image\` UI block with open
and download links. The helper defaults to \`gpt-image-2\` at high quality and \`auto\` size so OpenAI can choose the best
layout from the prompt. Kyro only pins the closest supported image size when the user explicitly asks for a shape:
square \`1024x1024\`, landscape \`1536x1024\`, or portrait \`1024x1536\`. When OpenAI returns image token usage, Kyro prices that image event from the provider usage split
between text input tokens, image input tokens, and output image tokens; if the provider does not return image usage, the
ledger falls back to the configured per-image snapshot. Voice can reach the same command path through the shared tool
endpoint; for complex visual context, the assistant should guide the user to the text Assistant where file attachments
and image previews are practical.

Assistant memory layers currently implemented:

- active thread: \`assistant_threads\`,
- full saved turns: \`assistant_messages\`; raw transcripts are preserved and are
  not deleted by compaction,
- rolling deterministic thread summary on the thread row,
- active explicit or approved suggested long-term memories in \`assistant_memories\`,
- pending/rejected memory suggestions in \`assistant_memories.status\` so suggestions
  can be approved or dismissed without entering active model context first,
- compacted context snapshots in \`assistant_context_snapshots\`, written
  opportunistically after Assistant turns once the thread is long enough. These
  hold daily summaries and roll up into weekly/monthly summaries so Kyro can
  carry old context without sending months of raw messages to the model,
- assistant history search, exposed as a known tool, searches compacted snapshots
  and raw saved turns when the user asks about something discussed earlier,
- structured workspace truth loaded from CRM/document/usage tables as needed.

The intended long-running context policy is: current turn plus a small recent
message window for conversational continuity, rolling thread summary for immediate
state, approved memories for durable user/workspace preferences, compacted
snapshots for older narrative context, and targeted database/tool lookups for
facts. This keeps the Assistant feeling like one persistent assistant while
preventing the prompt from growing every day the product is used.

The LLM does not invent UI. It plans a known tool when app data, side effects, or
current public web information are needed, receives validated tool results plus
optional thread/memory context, then writes short narration.
The frontend renders known \`ui_blocks\`, currently link cards, memory notices,
memory suggestions, summary cards, timelines, approval queues, and generated-image cards. External
web-search results are rendered as source link cards and metered as both model
tokens and \`web_search_calls\`. External SMS now has a Twilio send/receive
foundation, Vapi phone-call records/routes exist for configured workspaces, and
calendar tools are still provider-needed, approval-gated future tools.

Assistant voice input uses the browser \`MediaRecorder\` API only for capture. Audio is posted to
\`/api/assistant/transcribe\`, where the server calls OpenAI's audio transcription endpoint with the configured
speech-to-text model and a Kyro-specific transcription prompt for product vocabulary and assistant-name variants.
The server also applies a small deterministic Kyro-name normalization pass after transcription so common address
forms such as "hey Cairo", "hi Kara", or "okay Kyra" become "Kyro" without changing unrelated uses of Cairo.
The OpenAI API key never goes to the browser. Successful transcriptions are metered into \`usage_events\` as
\`speech_to_text_minutes\` and audited as \`assistant.voice_transcribed\`; the resulting text is then submitted through
the normal Assistant turn flow with \`inputSource=voice\` so the model can treat terms like Cara/Kara/Cairo as likely
voice variants of Kyro when appropriate. In the composer, pressing the mic/stop control transcribes the audio back
into the draft box for editing, while pressing Send during recording transcribes and submits the voice note directly.

### Voice

Files:

- \`apps/web/src/app/voice/page.tsx\`
- \`apps/web/src/app/voice/realtime-voice-console.tsx\`
- \`apps/web/src/app/voice/voice-console.tsx\`
- \`apps/web/src/app/api/assistant/realtime/call/route.ts\`
- \`apps/web/src/app/api/assistant/realtime/tool/route.ts\`
- \`apps/web/src/app/api/assistant/realtime/persist/route.ts\`
- \`apps/web/src/app/api/assistant/transcribe/route.ts\`
- \`apps/web/src/app/api/assistant/speech/route.ts\`
- \`apps/web/src/lib/assistant/transcription.ts\`
- \`apps/web/src/lib/assistant/speech.ts\`

Purpose:

- provide a separate realtime voice-first test surface without crowding the main Assistant chat UI,
- reuse the same Assistant thread, command router, model provider, memory context, and CRM tools,
- stream microphone audio through OpenAI Realtime over WebRTC,
- let the realtime session call the same Kyro tool boundary used by Assistant where possible,
- persist user/assistant transcripts back into the same Assistant thread,
- support web-search source cards when assistant web search is enabled,
- let realtime voice call \`kyro_check_recent_email\` to run the same inbound email sync worker as Settings/manual checks,
- meter OpenAI Realtime text/audio/cached token usage from \`response.done\` in \`usage_events\`.

Voice mode now uses OpenAI Realtime as the primary local development path. The server creates an ephemeral realtime
session with the same workspace/user context, the browser connects over WebRTC, and the voice client persists the final
transcript back into the Assistant thread so a user can move between chat and voice without losing context. The older
turn-based \`voice-console.tsx\`, transcription route, and speech route remain useful as fallback/test surfaces for
non-realtime experiments.

OpenAI is the product-owned speech provider for Kyro. Users do not choose between OpenAI and third-party TTS providers
in Settings; they choose the OpenAI assistant voice and pronunciation behavior. The saved \`assistant_voice\` policy's
\`openAiVoice\` value is used for both realtime sessions and fallback text-to-speech playback so the voice does not drift
between live voice and replayed/generated speech. The current local setup defaults to the \`ballad\` OpenAI voice with
assistant-suitable tone guidance. Future iOS work should treat this realtime flow as the contract to preserve: native UI
and audio handling can change, but the session should still share Assistant memory, tools, permissions, and persisted
transcript state.

Provider configuration:

\`\`\`bash
AI_PROVIDER=openai
ASSISTANT_PROVIDER=openai
ASSISTANT_MODEL=gpt-4.1-mini
OPENAI_MODEL=gpt-4.1-mini
OPENAI_LOW_COST_MODEL=gpt-4.1-mini
OPENAI_BALANCED_MODEL=gpt-4.1-mini
OPENAI_STRONG_MODEL=gpt-4.1
OPENAI_TRIAGE_MODEL=gpt-4.1-mini
OPENAI_REPLY_DRAFT_MODEL=gpt-4.1-mini
OPENAI_REPLY_DRAFT_MAX_OUTPUT_TOKENS=520
OPENAI_PRONUNCIATION_ALIAS_MODEL=gpt-4.1-mini
OPENAI_PRONUNCIATION_ALIAS_TIMEOUT_MS=4000
OPENAI_ASSISTANT_MAX_OUTPUT_TOKENS=360
OPENAI_TRIAGE_MAX_OUTPUT_TOKENS=700
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_VOICE=ballad
OPENAI_REALTIME_STYLE_INSTRUCTIONS=
OPENAI_REALTIME_VAD_THRESHOLD=0.74
OPENAI_REALTIME_VAD_SILENCE_DURATION_MS=1200
OPENAI_REALTIME_VAD_PREFIX_PADDING_MS=300
OUTBOUND_VOICE_PRONUNCIATION_POLICY=balanced
ASSISTANT_OLLAMA_TIMEOUT_MS=60000
ASSISTANT_OLLAMA_NUM_PREDICT=180
ASSISTANT_OLLAMA_THINK=false
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_TIMEOUT_MS=60000
OLLAMA_NUM_PREDICT=320
OLLAMA_THINK=false
OPENAI_API_KEY=
KYRO_USAGE_MARKUP_RATE=0.25
OPENAI_STT_MODEL=gpt-4o-mini-transcribe
OPENAI_STT_PROMPT=
OPENAI_STT_UNIT_COST_PER_MINUTE_USD=0.003
OPENAI_STT_MARKUP_RATE=
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_FORMAT=wav
OPENAI_TTS_SPEED=1
OPENAI_TTS_INSTRUCTIONS=
OPENAI_TTS_UNIT_COST_PER_SECOND_USD=
OPENAI_TTS_MARKUP_RATE=
\`\`\`

OpenAI voice settings expose only voices supported by the realtime voice path, currently \`alloy\`, \`ash\`, \`ballad\`,
\`coral\`, \`echo\`, \`sage\`, \`shimmer\`, \`verse\`, \`marin\`, and \`cedar\`. The fallback \`/audio/speech\` path uses
\`gpt-4o-mini-tts\` by default because it supports the shared voice list and promptable speech instructions. The legacy
ElevenLabs helper code is retained for possible future experimentation, but it is not exposed in Settings and
\`normalizeVoiceSettings()\` forces the saved provider to OpenAI.

The provider abstraction lives in \`apps/web/src/lib/assistant/providers.ts\`. Future cloud providers should plug into
\`runAssistantModel()\` and the planner boundary without changing the Assistant UI or audited tool executors.

### Voice Vocabulary And Pronunciation

Files:

- \`apps/web/src/lib/assistant/pronunciation.ts\`
- \`apps/web/src/app/api/assistant/pronunciation/preview/route.ts\`
- \`apps/web/src/app/api/assistant/pronunciation/preview/realtime/route.ts\`
- \`apps/web/src/app/settings/pronunciation-preview-player.tsx\`
- \`apps/web/src/app/settings/page.tsx\`
- \`apps/web/src/app/settings/actions.ts\`
- \`supabase/migrations/20260518175710_pronunciation_vocabulary.sql\`
- \`packages/db/src/schema.ts\`

Purpose:

- store workspace-specific words, names, places, business names, products, and acronyms that Kyro should recognize or pronounce carefully,
- treat user entries, assistant edits, and background-learned terms as one visible editable pronunciation list,
- let Kyro use best-effort pronunciation internally while applying a stricter policy to future customer-facing voice,
- allow users to add, edit, remove, and preview pronunciation entries from Voice settings,
- allow the assistant command router to update pronunciation entries directly from text or voice requests such as "pronounce Woolloongabba as wuh-lun-gabba",
- give auto-learned entries a best-effort default pronunciation hint so the list does not depend on user maintenance before it becomes useful,
- run a quick optional OpenAI alias/category enrichment pass for new auto-learned entries, using the surrounding message context plus general model knowledge,
- present saved entries as compact one-line rows with phrase, hint, category, aliases, usage, preview, save, and remove controls, showing the first 10 rows by default and placing the rest behind a lightweight details expander,
- show the add-pronunciation control as a compact accented row so it is clearly the interactive new-entry surface,
- make pronunciation previews use a mini OpenAI Realtime/WebRTC session with the saved Kyro voice, speaking only the target phrase,
- tell the preview model that phonetic hints are private pronunciation guidance and separators such as hyphens are syllable cues, not text to read aloud,
- keep a fallback speech-endpoint preview for browsers that cannot start a realtime preview,
- feed all non-ignored entries into realtime voice instructions, OpenAI speech-to-text prompts, and OpenAI text-to-speech instructions where supported,
- track lightweight usage counts in entry metadata so Settings can surface the most-used terms first without a heavier per-word analytics table.

Pronunciation entries live in \`assistant_pronunciations\`. Core fields are \`phrase\`, \`normalized_phrase\`,
\`pronunciation_hint\`, \`category\`, \`status\`, \`confidence\`, \`last_seen_at\`, \`source\`, \`aliases\`, \`metadata\`, and review metadata.
The UI no longer presents a user approval workflow. Status remains an internal lifecycle field:

- \`suggested\`: reserved for future raw vocabulary candidates without a generated hint,
- \`inferred\`: Kyro auto-added the term with a best-effort generated hint,
- \`approved\`: a user or assistant save confirmed the entry or added a custom hint,
- \`ignored\`: the user removed the entry from the active list.

All non-ignored entries are active. Auto-learned entries get a cheap best-effort \`pronunciation_hint\` by default. The
default hint spells acronyms letter-by-letter and otherwise normalizes the phrase without trying to invent a complex
phonetic spelling. Users or the assistant can replace that hint when Kyro gets a term wrong. \`aliases\` are related
spellings, nicknames, abbreviations, or speech-to-text mishearings used for recognition/context and usage tracking; they
do not substitute the text Kyro speaks aloud.

The outbound customer-voice strictness setting lives inside the \`assistant_voice\` workspace policy as
\`outboundVoicePronunciationPolicy\`. Supported values are \`strict\`, \`balanced\`, \`flexible\`, and \`off\`; \`balanced\` is the
default. The current app does not yet place outbound customer phone calls, so this policy is stored and injected into
voice context now, then becomes an action preflight gate when customer-facing voice actions exist.

Kyro also performs a lightweight background pronunciation pass when user assistant messages are saved. It first scans
the message against existing pronunciation phrases and aliases, incrementing only matched entries and updating
\`last_seen_at\`. It then looks for acronyms and unusual proper nouns. New candidates get a best-effort pronunciation hint
from deterministic code, then, when \`OPENAI_API_KEY\` is available, one bounded OpenAI call can suggest aliases and a
category from the surrounding text. The alias enrichment is intentionally conservative, times out quickly, and falls back
to empty aliases if OpenAI is unavailable. Inserted rows use status \`inferred\` with \`metadata.usageCount = 1\` and optional
\`metadata.aliasEnrichment\` details. The app does not log every transcript word or maintain a per-word analytics table;
this is intentionally conservative until there is a broader background agent loop for richer vocabulary discovery.
Current automatic candidate discovery is heuristic; alias maintenance has a lightweight LLM assist for new entries.
The suggestion heuristic is deliberately conservative: ordinary title-cased words from a sentence, such as sports
terms or common nouns, should not become pronunciation suggestions merely because the transcription capitalized them.
Possessive suffixes are stripped before scoring, so ordinary known words like \`Arsenal's\` do not become suggestions
just because they contain an apostrophe; apostrophes inside names like \`O'Connor\` can still count as unusual.

### Settings And Usage

Files:

- \`docs/assistant-help-manual.md\`
- \`apps/web/src/app/usage/page.tsx\`
- \`apps/web/src/app/settings/page.tsx\`
- \`apps/web/src/app/settings/actions.ts\`
- \`apps/web/src/app/api/billing/usage/route.ts\`
- \`apps/web/src/lib/assistant/knowledge-corpus.ts\`
- \`apps/web/src/lib/assistant/knowledge.ts\`
- \`apps/web/src/lib/assistant/settings-tools.ts\`
- \`apps/web/src/lib/billing/usage-summary.ts\`
- \`apps/web/src/lib/communication/settings.ts\`
- \`apps/web/src/lib/usage/openai.ts\`
- \`apps/web/src/lib/usage/queries.ts\`

Purpose:

- configure outbound approval mode,
- choose allowed channels for email, SMS, phone, or manual notes,
- save a default email signature and optional assistant signature,
- choose the Voice Assistant OpenAI voice,
- choose the outbound voice pronunciation policy and manage pronunciation vocabulary,
- manage general workspace defaults such as timezone, preferred display currency, and default phone region in a dedicated General settings section,
- configure inbound email sync cadence, quiet-hours polling, and action-filtering rules,
- show inbound email sync health in Settings, including reconnect-needed state,
  missing inbox-read scopes, last successful sync, last check attempt, next
  scheduled sync, sync failures, and pending manual checks,
- keep dense settings controls scannable with reusable hover/click info bubbles for helper copy,
- give the Assistant a user-facing help/manual source plus architecture snippets for product-aware support answers,
- allow the Assistant to edit a constrained allowlist of low-risk settings: timezone, display currency, inbound email sync mode, poll frequency, quiet hours, missed-mail lookback, fetch cap, skipped-mail summaries, inbound action rules, explicit sender relevance rules, and pronunciation vocabulary,
- show Google Workspace and Microsoft Outlook readiness in one Integrations area,
- show Twilio SMS/phone readiness, webhook URLs, active workspace numbers, and
  test-sender status in the same Integrations area,
- launch Google or Microsoft OAuth connect flows from that combined area,
- disconnect a Google or Microsoft account from Settings by marking the provider
  connection disconnected, clearing its stored token payload, and deactivating its
  email channel; reconnecting uses the normal OAuth connect flow again,
- audit communication-setting changes,
- show customer-facing usage charge from the \`usage_events\` ledger; provider/API cost and gross margin stay internal and should not be disclosed in customer-facing assistant responses,
- display user-facing money through the workspace display currency preference while keeping stored usage and provider-cost snapshots in their original ledger currency,
- normalize OpenAI token usage from provider responses into production ledger rows for
  uncached input, cached input, visible output, and reasoning tokens,
- normalize OpenAI Realtime voice usage from \`response.done\` into production ledger rows for
  text input, audio input, cached input, text output, audio output, and reasoning tokens,
- record OpenAI web-search tool calls separately from token usage so tool fees do not
  disappear inside the token meter,
- estimate OpenAI text-to-speech cost from the current text-input/audio-output rate card when direct usage is not returned,
- filter usage by today, 7 days, 30 days, or all time,
- break usage down first by business task and then by provider/model/service,
- explain provider/model rows with info bubbles so users understand why a model appears in their usage,
- break usage down by user,
- open the detailed usage ledger in a modal instead of leaving it expanded on the main Usage screen, with a customer-safe CSV export of the visible ledger rows,
- link ledger rows back to the most useful source where possible, such as an AI run's conversation, an action target, a contact, or a quote draft,
- expose read-only billable usage totals by monthly, weekly, or custom period through \`/api/billing/usage\`,
- show the current pricing posture without connecting payment collection.

Usage visibility is now incorporated into Settings. \`/usage\` redirects to
\`/settings?section=usage\`. The usage area is read-only and customer-facing: the main
summary shows \`Usage charge\`, task-level usage appears first, provider/model detail
appears second with explanatory info bubbles, and the full ledger opens in a modal.
The UI formats user-facing money through the workspace \`workspace_general\`
display-currency setting. Stored \`usage_events\` remain in their original currency
for auditability, and the ledger CSV includes both display and stored charge
columns plus the display exchange-rate provider. V1 uses placeholder static
USD-based display rates behind \`apps/web/src/lib/billing/display-currency.ts\`;
the provider seam is ready for a later billing integration such as Stripe FX
Quotes.
The billing endpoint is also read-only: it sums stored \`usage_events.customer_charge_snapshot\`
values by period and user so a future payment system can consume the same ledger totals.
It does not invoice, collect payment, alter pricing rules, or push data to Stripe/Apple.
It is a visibility layer over the metering data that triage, Assistant, inbound email sync,
reply drafting, document-template editing, pronunciation alias enrichment, realtime web-search tools,
realtime voice turns, speech-to-text, text-to-speech, image generation, and future API integrations record.
OpenAI LLM usage is priced from a model catalog with environment overrides for production pricing updates;
OpenAI web-search calls use separate reasoning and non-reasoning tool-call rates; OpenAI
Realtime voice usage is priced separately so audio tokens do not get blended into text token
costs; OpenAI text-to-speech uses a pricing-derived estimate when direct audio token usage
is unavailable. Unknown text models fall back to the configured/default low-cost model
price and mark the row as price-estimated in metadata.
Each new usage row snapshots the provider cost, markup, and customer charge. The active workspace-specific \`usageMarkupRate\` wins over provider-specific markup env vars; global/provider env changes and Developer settings margin changes affect future rows only.

The default phone region is used only when a user or inbound/manual capture gives
Kyro a bare local number without a country code. Explicit international numbers
still win. This prevents an Australian workspace from incorrectly treating every
country-less number as Australian when the workspace should default to the USA,
UK, or another supported region.

Settings sections are URL-addressable (\`?section=general\`, \`?section=voice\`,
\`?section=integrations\`, \`?section=usage\`) and fetch data on demand for the selected
section. Legacy \`?section=communication\` links normalize to \`?section=integrations\` because outbound approval/channel/signature settings now live inside Connected accounts beside Google, Microsoft, and inbound email controls. This keeps the default Settings route light and makes each section a cleaner future API/native-screen boundary.

Assistant-facing help uses \`docs/assistant-help-manual.md\` as the user-facing
source. The manual now covers the current product surfaces end-to-end: Assistant,
Voice, Inbox, filtered-out email review, CRM, Documents, Log, Settings, safe
assistant-editable settings, limitations, troubleshooting, performance/loading
behaviour, and the iOS direction. A bundled assistant corpus in
\`apps/web/src/lib/assistant/knowledge-corpus.ts\` mirrors the manual so runtime
assistant routes do not need filesystem reads. Architecture support snippets are
mirrored there as internal context. The assistant command router selects relevant
snippets for app-help questions instead of stuffing every document into every
prompt, and both text Assistant and realtime Voice can reach the same help/manual
path through the shared command/tool boundary.

Assistant settings edits go through \`apps/web/src/lib/assistant/settings-tools.ts\`.
The allowlist is limited to low-risk operational settings: workspace timezone,
workspace display currency, inbound email sync behavior, inbound email action
rules, explicit sender relevance rules when the user gives an email address or
domain, assistant voice, outbound pronunciation policy, pronunciation vocabulary,
and basic quote document template settings such as template direction, accent,
currency, validity, payment terms, footer text, and prepared-by footer
visibility. Outbound approval policy, signatures, OAuth connections,
billing/metering, provider secrets, destructive data changes, final pricing,
tax/accounting treatment, and payment collection remain explicit UI or future
workflow flows.

Settings expose outbound policy inside the combined Connected accounts area for
Google Workspace, Microsoft Outlook, and Twilio. Gmail and Outlook are the first
real email send/read providers. Twilio is the first SMS send/receive provider.
Vapi is the first phone-call assistant provider, while calendar remains a future
integration.

Inbound email settings live in \`workspace_policies\` with policy type \`inbound_email\`.
The default posture is automatic five-minute polling during active hours, paused
scheduled polling during the 10pm-4am quiet window, minimal idempotency events
for skipped mail with optional human-readable summaries, and automatic promotion
only for emails classified as business-actionable.

## Manual Inquiry Ingestion

Files:

- \`apps/web/src/app/inbound/actions.ts\`
- \`apps/web/src/lib/inbound/manual.ts\`

Flow:

\`\`\`mermaid
flowchart TD
    Form["Manual inquiry form"]
    Action["createManualInboundAction"]
    Event["events row with idempotency key"]
    Contact["match or create contact"]
    Lead["create lead"]
    Conversation["create conversation"]
    Message["create inbound message"]
    Triage["run AI triage"]
    ProposedAction["create proposed actions"]

    Form --> Action
    Action --> Event
    Event --> Contact
    Contact --> Lead
    Lead --> Conversation
    Conversation --> Message
    Message --> Triage
    Triage --> ProposedAction
\`\`\`

Important behavior:

- Manual/mock inquiry forms that call this action must include a one-time \`submissionKey\`.
- \`manual.ts\` writes the ingestion event first.
- Duplicate submissions with the same idempotency key are ignored.
- Contact matching is workspace-scoped.
- Normalized email or phone matches attach to existing contacts, so common casing,
  spacing, punctuation, explicit international phone prefixes, and common
  local/national phone formats resolve to the same profile where they can be
  safely parsed. Bare local numbers use the workspace default phone region before
  falling back through the wider parser.
- Email/phone conflicts create a new contact marked \`needs_review\` and mark the lead as high priority/profile check.
- Missing contact details can be filled on an existing matched profile.
- AI triage currently extracts simple inquiry facts, normalizes generic model labels like "new inquiry from John" back to trade-specific job types where possible, saves the current fact row, proposes one or more actions, and marks the conversation as \`reply_drafted\` once proposals exist.
- If the user edits the saved inquiry facts and regenerates the plan, Kyro cancels stale pending/approved proposal actions for that conversation plus any stale lead-level \`mark_not_fit\` proposal, audits the cancellation, and reruns triage with the corrected facts locked as authoritative input.

## Inbound Email Sync

Files:

- \`apps/web/src/lib/integrations/inbound-email-settings.ts\`
- \`apps/web/src/lib/integrations/inbound-email-sync.ts\`
- \`apps/web/src/app/api/integrations/email/sync/route.ts\`
- \`apps/web/src/app/settings/actions.ts\`
- \`apps/web/src/app/settings/page.tsx\`
- \`apps/web/src/app/api/assistant/realtime/tool/route.ts\`
- \`apps/web/src/lib/assistant/commands.ts\`

Flow:

\`\`\`mermaid
flowchart TD
    Trigger["Protected scheduled route or manual/assistant trigger"]
    Settings["workspace_policies inbound_email"]
    Provider["Gmail or Outlook inbox"]
    Event["events row with provider message idempotency key"]
    Classifier["Heuristic + optional OpenAI classifier"]
    Awareness["processed awareness event only"]
    CRM["contact/lead/conversation/message"]
    Triage["run AI triage"]
    Actions["draft reply / quote / site visit proposals"]

    Trigger --> Settings
    Settings --> Provider
    Provider --> Event
    Event --> Classifier
    Classifier -->|not actionable| Awareness
    Classifier -->|business actionable| CRM
    CRM --> Triage
    Triage --> Actions
\`\`\`

Important behavior:

- Gmail now requests \`gmail.readonly\`; Outlook now requests \`Mail.Read\`.
- Existing connected accounts that only granted send scopes need to reconnect before inbound sync can read mail.
- If a stored OAuth token cannot be decrypted with the current
  \`INTEGRATION_TOKEN_ENCRYPTION_KEY\`, the sync worker reports the account as
  reconnect-needed instead of a generic provider failure. Reconnecting stores a
  fresh token encrypted with the active key.
- Settings derives email sync UX state from existing connection fields:
  \`scopes\`, \`last_sync_at\`, \`last_error\`, and \`metadata.inboundEmail.lastCheckedAt\`.
  This avoids a new table while still showing missing scopes, reconnect-needed
  warnings, last successful sync, last check attempt, sync failures, and next
  scheduled sync.
- Settings shows a compact inbound trace launcher backed by existing \`audit_logs\`
  and \`events\`. Opening it displays a scrollable pop-up with recent sync runs,
  fetched/promoted/observed/duplicate counts, and recent provider email
  decisions. This is deliberately read-only operational visibility, not a second
  queue, and it stays out of the main settings controls because the list can grow.
- Scheduled polling is exposed through \`/api/integrations/email/sync\`, protected by \`INBOUND_EMAIL_SYNC_SECRET\` or Vercel's \`CRON_SECRET\`, and backed by a server-only Supabase service role client. Vercel Cron calls it with \`GET\`; manual scheduler/testing calls can still use \`POST\`.
- \`vercel.json\` registers this route to run every five minutes in production. The sync worker still respects each workspace's policy, including quiet-hours rules.
- Quiet-hours behavior is intentionally singular: scheduled polling pauses between the configured start and end times, then resumes on the first scheduled poll after quiet hours end. Businesses that need overnight polling should disable quiet hours rather than choose a second behavior mode.
- Manual Settings checks and assistant-triggered checks bypass the schedule gate so the user or agent can fetch fresh email when context demands it.
- Every provider message gets an idempotent \`events\` row before processing; duplicate provider messages are skipped.
- Non-actionable mail is not promoted into the CRM. It is recorded as a lightweight awareness event with classification/summary metadata, not as a full conversation.
- Inbox exposes a separate filtered-out email pop-up for those observed/skipped events. Its header button shows only the count from the last 24 hours on the normal Inbox load; the full bounded recent list and reply-log state are fetched only when the pop-up opens. The pop-up has its own sender/subject/reason search so operators can inspect noise without mixing it into the main work queue. It is intentionally not a normal work-queue filter so personal/newsletter/noise stays outside the actionable CRM queue while still being quick to review.
- The filtered-out email pop-up scrolls inside the modal and can send a user-approved reply through the same outbox delivery layer as normal conversation replies, using the stored subject, sender, summary, and classification metadata. Hidden reply composers are mounted only after a user opens \`Reply\`, so the modal can render many skipped emails without shipping every AI reply form up front. Those replies create an \`outbound_messages\` row first, then record an internal \`outbound.filtered_email.reply_sent\` event after provider acceptance; the pop-up displays Kyro's own replied indicator from that log and does not try to infer replies sent directly in Gmail or Outlook.
- Filtered-out email now has a primary Promote action that calls \`promoteSkippedEmailEvent\`. That helper tries to refetch the original provider message by provider message id, falls back to stored event metadata when needed, then creates or reuses the same contact, lead, conversation, inbound message, and triage path as normal promoted inbound mail.
- Sender-specific learning rules live inside the existing \`inbound_email\` workspace policy JSON as \`senderRules\`, so no schema migration is needed for v1. The filtered-out email three-dot menu can add \`always_promote\` or \`always_ignore\` rules for a sender email address and displays the current set/not-set state for each option. Settings -> Integrations includes a compact Sender rules launcher that opens a pop-up manager for adding email/domain rules, switching rules between relevant/ignored, or removing rules. Sync checks those structured rules before classifier work; matched promote rules produce \`sender_rule\` classifications and matched ignore rules skip promotion.
- Actionable business mail creates or reuses a contact, lead, conversation, and inbound message, then runs the same AI triage/action-proposal path as manual inbound.
- Inbound email attachment metadata is stored on the event/message. If Gmail or Outlook provides attachment bytes, Kyro stores current-size attachments in a private Supabase Storage bucket (\`KYRO_FILE_STORAGE_BUCKET\`, falling back to \`kyro-files\`), inserts a \`files\` row, and renders attachment chips in Inbox and Assistant previews. Oversized attachments and storage failures fall back to metadata-only/failed chips so the user still sees that an attachment existed.
- Follow-up emails match existing conversations by provider thread id first, then RFC message references (\`References\` / \`In-Reply-To\`), then a conservative same-contact same-subject fallback. Matched follow-ups reopen the conversation, cancel stale pending/approved proposal actions, and rerun triage with the thread summary.
- The classifier uses heuristics first and, when \`OPENAI_API_KEY\` is available, a low-cost OpenAI structured-output classifier for non-automated mail. The heuristic layer covers common trade-language signals such as quote, job, booking, blocked/backed-up drains, sewerage, bathroom renovation, repairs, and "come out/check/quote" phrases so obvious customer work is not missed if the LLM path is unavailable. Classification usage is recorded in \`usage_events\`.
- No new tables were added for the first version; \`workspace_policies\`, \`integration_connections\`, \`channels\`, \`events\`, \`messages\`, and existing CRM tables are enough.

Known inbound gaps to tackle after the poller is stable:

- Gmail/Outlook push mailbox watches and incremental history cursors are deferred;
  production currently relies on bounded polling plus provider-message
  idempotency.
- Inbound provider attachments now have first-pass Supabase Storage persistence,
  but they are not yet promoted into editable CRM document records or Drive.
- Thread matching now uses provider thread ids, RFC references, and same-contact
  same-subject fallback. Future work is provider history/watch cursors and deeper
  forwarded-message parsing.

## Mock Follow-Up Ingestion

Files:

- \`apps/web/src/app/inbox/actions.ts\`
- \`apps/web/src/lib/inbound/follow-up.ts\`

The inquiry review page can add a mock inbound follow-up to an existing thread.
This is the current way to test a multi-message conversation before Gmail inbound
sync and SMS inbound channels exist.

Flow:

\`\`\`mermaid
flowchart TD
    Form["Mock follow-up form"]
    Event["events row with idempotency key"]
    Message["create inbound message"]
    Reopen["set conversation open"]
    Cancel["cancel stale draft replies"]
    Thread["load full message thread"]
    Triage["run AI triage with thread summary"]
    Draft["create fresh proposed actions"]

    Form --> Event
    Event --> Message
    Message --> Reopen
    Reopen --> Cancel
    Cancel --> Thread
    Thread --> Triage
    Triage --> Draft
\`\`\`

Important behavior:

- resolved conversations reopen when a new inbound follow-up is recorded,
- stale \`pending_approval\` or \`approved\` thread actions are cancelled,
- completed dry-run outbound messages are preserved,
- the next AI triage run receives a short full-thread summary,
- no external communication is sent.

## CRM Query Layer

File: \`apps/web/src/lib/crm/queries.ts\`

This file centralizes read models used by the UI:

- \`getContactList\`
- \`getContactProfile\`
- \`getLeadList\`
- \`getConversationList\`
- \`getConversationReview\`
- \`getQuoteDraftList\`
- \`getQuoteDraftProfile\`

If adding a screen that needs CRM data, prefer adding or extending a read helper here instead of scattering Supabase queries across many pages.

## Event, Action, Audit Engine

Files:

- \`apps/web/src/lib/engine/event-action-audit.ts\`
- \`apps/web/src/app/engine/actions.ts\`
- \`packages/api/src/services/action.service.ts\`
- \`packages/api/src/services/event.service.ts\`

Pattern:

- events represent something that happened or needs processing,
- actions represent proposed or executable side effects,
- audit logs record meaningful changes and transitions.

Current action behavior:

- \`draft_reply\` is the primary reply-planning action for every inbound inquiry,
- missing information is stored in \`inquiry_facts.missing_info\` and folded into the \`draft_reply\` body rather than proposed as a separate \`ask_missing_info\` action,
- \`draft_reply\` actions can be edited and sent from the inquiry review page, Inbox split preview, or Assistant preview,
- pressing \`Send generated reply\` is the approval for generated replies; it saves any visible draft edits and then executes the send/record action,
- Assistant inquiry previews include a manual reply composer so the user can respond even when no AI draft action exists,
- user-written manual reply composers send or record immediately because the button press is the explicit approval,
- manual reply composers can open a compact \`Generate with AI\` prompt that calls \`/api/inbox/reply-draft\`, uses the conversation or skipped-email context plus the user's quick direction, and inserts a draft into the subject/body fields for review,
- pending draft replies can be edited from the inquiry review page before approval,
- executing a \`draft_reply\` queues an \`outbound_messages\` delivery and then sends through Gmail/Outlook when the channel is email and the contact has an email address,
- executing non-email channels records an internal outbound \`messages\` row until SMS/phone providers exist,
- outbound message metadata records \`dryRun\`, \`externalSend\`, \`provider\`, \`sentTo\`, attachments, external provider message/request ids, and the linked outbox delivery id,
- after an outbound reply is recorded, Kyro creates or reschedules one open \`customer_follow_up\` task for the conversation using the workspace follow-up delay, defaulting to two days,
- open \`customer_follow_up\` tasks become a \`follow_up_due\` Inbox/CRM due state only after the due time passes; they are completed automatically when a new inbound customer message arrives,
- future automatic follow-up tasks are hidden from task/workflow panels until due, so they do not clutter a freshly replied conversation,
- \`create_quote_draft\` actions create internal \`quote_drafts\` rows only,
- quote drafts created from inquiry actions prefill customer/job metadata from the linked contact, lead, and saved inquiry facts,
- \`book_site_visit\` is converted into durable \`conversation_appointments\` and \`conversation_tasks\` records before any future calendar integration,
- follow-up reminders are intentionally not shown as immediate approval actions,
- \`mark_not_fit\` updates the attached lead status to \`not_fit\`,
- SMS/phone/calendar are still not connected.

This is intentional. Gmail and Outlook are the first real outbound providers; the same
outbox/action-executor seam should be reused for SMS, phone, and calendar later.
Generated PDF records and user-approved Drive filing already use the same audited,
permission-bound pattern.

Conversation statuses currently used by the review workflow:

- \`open\`: inbound conversation exists and needs work.
- \`reply_drafted\`: AI has proposed a reply.
- \`replied\`: an outbound reply has been sent externally or recorded internally in the thread.
- \`resolved\`: user manually marked the conversation resolved.

The inbox list derives a \`nextActionLabel\` from conversation status, latest
message direction, lead priority, and pending/approved actions. This keeps the
list focused on what the operator should do next, rather than only showing raw
database statuses.

## AI And Usage

Files:

- \`apps/web/src/lib/ai/triage.ts\`
- \`apps/web/src/app/ai/actions.ts\`
- \`packages/ai/src/index.ts\`

Current AI supports two development modes:

- \`AI_PROVIDER=stub\`: deterministic no-network triage.
- \`AI_PROVIDER=ollama\`: local Ollama triage, currently configured for \`qwen3:8b\`.

Both modes preserve the same Kyro workflow shape:

- Kyro still records realistic \`ai_runs\`,
- model route decisions are recorded,
- usage events are recorded,
- deterministic inquiry facts are extracted from the mock inbound text and thread context,
- multiple action proposals can be created from the facts.

When Ollama mode is enabled, \`apps/web/src/lib/ai/triage.ts\` calls the local
Ollama \`/api/chat\` endpoint and asks for compact JSON containing inquiry facts
and a reply draft. If Ollama is unavailable, malformed, or mid-upgrade, Kyro
falls back to the deterministic stub and records the fallback reason in the
AI run output. Local Ollama usage is metered with estimated/token counts and
zero internal cost while testing.

Relevant environment variables:

\`\`\`bash
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_TIMEOUT_MS=60000
OLLAMA_NUM_PREDICT=320
OLLAMA_THINK=false
\`\`\`

This lets the app prove the workflow shape before real model calls are added.

For local qwen-style thinking models, Kyro disables Ollama thinking mode by default
on Assistant narration and inquiry triage. The app needs short operational answers
and compact JSON, not long hidden reasoning traces. This keeps local testing snappy
and avoids timeout fallbacks while preserving the same provider abstraction for
future cloud APIs.

The Assistant uses the same general model-routing idea, but its provider layer is separate from triage so chat/command
behavior can be upgraded independently. This local setup uses OpenAI by default through \`ASSISTANT_PROVIDER\`; Ollama
remains a supported development option on machines that can run it.

## Performance Pattern

Current performance approach:

- routes are server-rendered for fresh authenticated data,
- \`RoutePreloader\` idle-prefetches core logged-in tabs with a stagger so navigation
  is warm without hammering every detail route;
  it dedupes routes already prefetched in the browser session and skips background
  prefetching on data-saver or slow network connections,
- \`SmartPrefetchLink\` warms a route on hover, focus, or touch intent for the
  sidebar, mobile drawer, and mobile bottom-nav links while keeping automatic
  Next.js link prefetch disabled,
- internal dev-only provider/margin pills use a short per-user/workspace server
  cache so moving between routes does not repeatedly scan recent usage rows,
- the dev LLM connectivity pill also uses a short server cache and in-flight
  request dedupe so Ollama/OpenAI status checks do not stall normal navigation,
- long repeated list rows intentionally keep \`prefetch={false}\`,
- list/detail pages have skeleton loading states,
- CRM filter/search/sort state is URL-backed and rendered server-side so the split profile panel can preserve context across clicks and saves,
- inbox split-view fetches the list, selected preview, and communication settings in parallel after workspace resolution,
- Settings fetches only the selected section's data so Usage/task/ledger data is not loaded for general, voice, or integrations changes; the integrations section intentionally fetches communication policy, provider overviews, and inbound email settings together because those now share one Connected accounts surface,
- log data, engine queues, and AI ledger data are fetched in parallel after workspace resolution,
- log counts are workspace-scoped,
- the Assistant landing page uses count queries where possible and reuses the bounded
  conversation list for workflow counts that need bucket logic.

Do not preload everything. The current reasonable preload set is:

- main app routes: Assistant, Voice, Inbox, CRM, Files, Log, Settings,
- already-open split-view records,
- compact list summaries and counts for the active screen.

Heavy data should remain on demand:

- full audit logs,
- full usage history,
- old message threads,
- attachments,
- generated documents,
- AI run history beyond recent summaries.

## Branding

Current logo assets:

- \`apps/web/public/brand/kyro-logo.png\`
- \`apps/web/public/brand/kyro-logo-dark.png\`
- \`apps/web/public/brand/kyro-logo-light.png\`
- \`apps/web/public/brand/kyro-email-logo.png\`
- \`apps/web/public/kyro-icon.png\`
- \`apps/web/src/app/icon.png\`

UI component:

- \`apps/web/src/app/components/brand-mark.tsx\`

When replacing the logo later, update the image assets and \`brand-mark.tsx\` if needed.

## Where To Add Common Features

Use this map before editing:

- New CRM list/read data: \`apps/web/src/lib/crm/queries.ts\`
- New contact type label: \`apps/web/src/lib/crm/contact-types.ts\`
- New contact mutation: \`apps/web/src/app/contacts/actions.ts\`
- New address autocomplete/provider behavior: \`apps/web/src/app/components/address-autocomplete-field.tsx\`,
  \`apps/web/src/app/api/addresses/autocomplete/route.ts\`,
  \`apps/web/src/app/api/addresses/place/route.ts\`,
  \`apps/web/src/lib/addresses/google.ts\`, and \`apps/web/src/lib/addresses/form.ts\`
- New manual inquiry behavior: \`apps/web/src/lib/inbound/manual.ts\`
- New developer/test tool screens: \`apps/web/src/app/developer/page.tsx\`,
  \`apps/web/src/app/developer/outbox/page.tsx\`,
  \`apps/web/src/app/developer/assistant-tools/page.tsx\`,
  \`apps/web/src/app/developer/system-health/page.tsx\`, and
  \`apps/web/src/app/developer/smoke-tests/page.tsx\`
- New developer readiness/smoke-test logic: \`apps/web/src/lib/developer/system-health.ts\`
- New action transition/execution behavior: \`apps/web/src/lib/engine/event-action-audit.ts\`
- New AI triage behavior: \`apps/web/src/lib/ai/triage.ts\`
- New inquiry fact editing behavior: \`apps/web/src/app/inbox/actions.ts\`
- New quote draft read behavior: \`apps/web/src/lib/crm/queries.ts\`
- New quote draft editor/template behavior: \`apps/web/src/app/documents/actions.ts\`, \`apps/web/src/lib/documents/templates.ts\`
- New quote draft action-execution behavior: \`apps/web/src/lib/engine/event-action-audit.ts\`
- New assistant command behavior: \`apps/web/src/lib/assistant/commands.ts\`
- New assistant model provider: \`apps/web/src/lib/assistant/providers.ts\`
- New assistant route metrics behavior: \`apps/web/src/lib/assistant/route-metrics.ts\`
- New assistant persistence/memory behavior: \`apps/web/src/lib/assistant/persistence.ts\`
- New assistant UI block behavior: \`apps/web/src/lib/assistant/ui-blocks.ts\`
- New assistant tool/admin registry behavior: \`apps/web/src/lib/assistant/tool-registry.ts\`
- New assistant attachments and generated image behavior:
  \`apps/web/src/lib/assistant/attachments.ts\`, \`apps/web/src/lib/images/generation.ts\`,
  \`apps/web/src/lib/usage/openai.ts\`, and \`apps/web/src/app/api/files/[fileId]/route.ts\`
- New assistant speech-to-text behavior: \`apps/web/src/app/api/assistant/transcribe/route.ts\`
  and \`apps/web/src/lib/assistant/transcription.ts\`
- New assistant text-to-speech behavior: \`apps/web/src/app/api/assistant/speech/route.ts\`
  and \`apps/web/src/lib/assistant/speech.ts\`
- New Twilio SMS foundation: \`apps/web/src/lib/integrations/twilio.ts\`,
  \`apps/web/src/app/api/integrations/twilio/sms/route.ts\`,
  \`apps/web/src/app/api/integrations/twilio/status/route.ts\`, and
  \`supabase/migrations/20260529021344_twilio_sms_foundation.sql\`
- New Vapi/Twilio phone assistant foundation:
  \`apps/web/src/lib/integrations/vapi.ts\`,
  \`apps/web/src/lib/voice/calls.ts\`,
  \`apps/web/src/lib/workspace/api-context.ts\`,
  \`apps/web/src/app/api/assistant/activity/route.ts\`,
  \`apps/web/src/app/api/integrations/vapi/webhook/route.ts\`,
  \`apps/web/src/app/api/integrations/vapi/tool/route.ts\`,
  \`apps/web/src/app/api/voice/outbound/route.ts\`,
  \`apps/web/src/app/api/voice/calls/[callId]/route.ts\`, and
  \`supabase/migrations/20260529043000_vapi_voice_calls.sql\`
- New assistant voice settings behavior: \`apps/web/src/lib/assistant/voice-settings.ts\`
  and \`apps/web/src/app/settings/page.tsx\`
- New assistant pronunciation behavior: \`apps/web/src/lib/assistant/pronunciation.ts\`,
  \`apps/web/src/app/api/assistant/pronunciation/preview/route.ts\`, and
  \`supabase/migrations/20260518175710_pronunciation_vocabulary.sql\`
- New realtime voice UI behavior: \`apps/web/src/app/voice/page.tsx\`
  and \`apps/web/src/app/voice/realtime-voice-console.tsx\`
- New realtime voice session/tool/persistence behavior:
  \`apps/web/src/app/api/assistant/realtime/call/route.ts\`,
  \`apps/web/src/app/api/assistant/realtime/tool/route.ts\`, and
  \`apps/web/src/app/api/assistant/realtime/persist/route.ts\`
- New Google OAuth connection behavior: \`apps/web/src/app/integrations/google/start/route.ts\`,
  \`apps/web/src/app/integrations/google/callback/route.ts\`, and \`apps/web/src/lib/integrations/google.ts\`
- New Microsoft OAuth connection behavior: \`apps/web/src/app/integrations/microsoft/start/route.ts\`,
  \`apps/web/src/app/integrations/microsoft/callback/route.ts\`, and \`apps/web/src/lib/integrations/microsoft.ts\`
- New Gmail/Outlook send behavior: \`apps/web/src/lib/integrations/gmail.ts\`,
  \`apps/web/src/lib/integrations/outlook.ts\`, \`apps/web/src/lib/integrations/mail.ts\`,
  \`apps/web/src/lib/communication/outbound.ts\`, and \`apps/web/src/lib/communication/signatures.ts\`
- New outbox worker route: \`apps/web/src/app/api/outbox/process/route.ts\`
- New outbox operations actions: \`apps/web/src/app/developer/outbox/actions.ts\`
- New inbound email sync behavior: \`apps/web/src/lib/integrations/inbound-email-settings.ts\`,
  \`apps/web/src/lib/integrations/inbound-email-sync.ts\`, and
  \`apps/web/src/app/api/integrations/email/sync/route.ts\`
- New file download route for stored inbound attachments: \`apps/web/src/app/api/files/[fileId]/route.ts\`
- New deployment/env readiness check: \`scripts/check-env.mjs\` and \`docs/deployment-checklist.md\`
- New service-role Supabase server helper: \`apps/web/src/lib/supabase/service.ts\`
- New provider token encryption behavior: \`apps/web/src/lib/integrations/token-vault.ts\`
- New usage/billing read behavior: \`apps/web/src/lib/usage/queries.ts\`, surfaced from Settings
- New schema field/table: \`packages/db/src/schema.ts\`, then generate a migration.
- New route loading state: add \`loading.tsx\` beside the route.
- Shared layout/nav: \`apps/web/src/app/components/app-frame.tsx\`
- Core route preloading: \`apps/web/src/app/components/route-preloader.tsx\`
- Visual styling: \`apps/web/src/app/globals.css\`

## Current Intentional Gaps

These are not bugs:

- Gmail and Outlook OAuth plus real outbound email are connected for approved/user-triggered sends.
- Gmail and Outlook inbound sync have a first poll-based implementation. Push/webhook mailbox watches are intentionally deferred.
- Gmail/Outlook inbound attachments are stored when provider bytes are available and shown as message attachment chips. Turning those files into first-class job documents is future work.
- Twilio SMS has a first send/receive foundation. Number search/purchase and richer
  sender/operator classification are still future work.
- Vapi/Twilio phone calls have a first backend foundation for inbound calls,
  voicemail overflow, user-to-Kyro calls, outbound calls, transcripts,
  recordings, and activity previews. Live Vapi assistants, phone numbers,
  webhook secrets, and production prompt tuning still need to be configured.
- AI triage and Assistant narration can use OpenAI in this local setup; local Ollama remains a development option on machines that support it.
- Voice mode has a WebRTC/OpenAI Realtime path, but the native mobile shell, deeper barge-in tuning, and user-facing realtime voice controls are still future work.
- Pronunciation vocabulary supports Settings management, previews, prompt injection, lightweight usage counts, and background suggestions; pronunciation preflight gates for customer-facing phone calls are still future work.
- Action execution can send real Gmail/Outlook email and Twilio SMS when configured.
  Phone calls use the Vapi outbound-call API once configured.
- Gmail/Outlook can send uploaded local file attachments and server-generated PDF attachments for selected quote drafts.
- Assistant can generate and store one-off images/renderings through OpenAI Images; richer media galleries, multi-turn
  visual editing, and mobile camera-first flows are still future product work.
- Browser print/save-to-PDF quote output, server-generated quote/invoice PDFs, first-class generated document records, private PDF storage, and user-approved Google Drive filing exist. Payment-provider billing, bookkeeping, reconciliation, and fully parsed user-uploaded template assets are not implemented yet.
- Assistant chat is implemented as a persisted safe command/tool layer, not a free-roaming autonomous agent.
- Assistant long-term memory saves explicit instructions immediately and can suggest implied durable preferences for user approval. Suggested memories are not active until approved.
- Usage visibility exists in Settings, but payments, payment-provider billing, bookkeeping, reconciliation, and tax are intentionally out of scope.
- Google address autocomplete is wired for CRM contacts, inquiry facts, and mock
  inbound once \`GOOGLE_MAPS_API_KEY\` is configured. Manual addresses are still
  allowed when Google lookup is unavailable or the user intentionally types a
  non-standard job-site description.

## Verification Commands

Run these after meaningful changes:

\`\`\`bash
npm run env:check
npm run test
npm run typecheck
npm run lint
npm run db:check
npm run build
\`\`\`

The current web test harness uses Node's built-in test runner with \`tsx\`:

- root \`npm run test\` fans out to workspace test scripts,
- \`apps/web\` runs \`node --import tsx --test "src/**/*.test.ts" "app/**/*.test.ts"\`,
- tests should prefer pure helpers over live Supabase, Gmail, Outlook, OpenAI, or browser calls.

Current high-value unit coverage includes inbound email quiet-hours scheduling, sender learning rules,
reconnect-needed token-decrypt classification, skipped-email summary/reply-state mapping, reply draft
prompt context, pronunciation candidate filtering, Assistant-editable settings parsing, document template
setting normalisation, and printable quote HTML escaping/rendering.

When schema changes are made:

\`\`\`bash
npm run db:generate -- --name descriptive_name
npm run db:migrate
npm run db:check
\`\`\`

Production deployment and environment hardening steps live in
\`docs/deployment-checklist.md\`. Use \`npm run env:check:production\` against the
production environment before deploying.

## Security Notes

- Never expose Supabase service-role keys in browser code.
- Only \`NEXT_PUBLIC_*\` variables are safe for client-side exposure.
- Keep writes in Server Actions or backend service helpers.
- Preserve workspace scoping on every query.
- Add audit logs for meaningful user, AI, or system changes.
- Keep outbound side effects behind the action engine and workspace policies.
`;
