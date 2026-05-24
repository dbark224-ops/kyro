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
- Documents: create, edit, and print/save customer quote documents from quote drafts.
- Log: inspect recent workspace activity.
- Settings: configure communication rules, voice, integrations, usage visibility, and general workspace defaults.
- Developer: internal testing tools, not an end-user screen.

## What Kyro Can Do

Kyro can currently help with:

- answering questions about the workspace and current CRM records,
- summarising contacts, leads, conversations, and quote drafts,
- finding work that needs attention,
- creating saved internal quote drafts from existing reusable document templates,
- drafting and sending user-approved manual replies through connected email,
- checking connected Gmail or Outlook inboxes on request,
- classifying inbound email and promoting business-actionable messages into the CRM,
- showing filtered-out emails separately so personal/newsletter/noise stays out of the work queue,
- generating a draft reply from a short user instruction,
- remembering explicit instructions when the user says to remember or note something,
- updating pronunciation vocabulary when the user asks,
- updating a small allowlist of safe workspace settings,
- updating basic quote document template settings when the user asks,
- creating and revising reusable document templates when the user asks,
- preparing quote-send emails that include a generated PDF and customer approval link,
- answering whether a customer has viewed, approved, or requested changes to a quote,
- using web search for public/current internet information when enabled,
- answering help questions from this manual and architecture notes.

Kyro should not claim to have done work it has not done. It should not invent customers, prices, dates, provider responses, CRM records, messages, or completed business actions.

## What Kyro Cannot Do Yet

Some product areas are intentionally not complete yet:

- Kyro does not place real outbound phone calls yet.
- SMS and phone channels are internal/manual records until providers are connected.
- Quote drafts can now render as print-ready customer quote documents, generate server-side PDFs, and collect customer approval or change requests through secure quote links. Drive file storage, invoice/accounting exports, and payment collection are future work.
- Payments, invoicing, reconciliation, taxes, and billing collection are not implemented.
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
- ask Kyro to check email,
- ask how Kyro or a setting works,
- ask Kyro to remember explicit instructions,
- ask Kyro to update pronunciation vocabulary,
- ask Kyro to update safe basic settings,
- ask Kyro to update quote document template direction, currency, validity, payment terms, or footer text,
- ask general questions.

Assistant results can include cards. Cards are deterministic UI links generated by the app, not links invented by the model. For example, if Kyro finds a conversation or quote draft, the UI renders a card to open it.

The Assistant persists conversation history in the workspace thread. Voice mode uses the same thread so the user can move between typing and talking without losing context.

## Voice Screen

The Voice screen is Kyro's live voice mode. It uses OpenAI Realtime over WebRTC so the user can talk naturally and hear Kyro respond in the selected assistant voice.

Voice mode is intended to be the same assistant as the text Assistant:

- same workspace,
- same Assistant thread,
- same memory context,
- same CRM command router,
- same help/manual access,
- same safe settings permissions,
- same connected email sync tool,
- same public web search tool when enabled.

Use Voice when the user wants a more natural back-and-forth conversation. Use text Assistant when the user wants to review cards, links, details, or typed instructions.

Voice can call Kyro tools while speaking. For example, if the user asks "check my email" or "what does lookback mean", voice should call the context tool rather than guessing.

## Inbox Screen

Inbox is the main operational work queue. It shows business conversations that need review, replies, quote work, missing information, approval, or follow-up.

Inbox is for work that has become CRM work. Emails or messages that Kyro decides are not business-actionable are kept separate in the filtered-out email popup.

Inbox buckets can include:

- Needs reply: conversations where the customer likely needs a response.
- Missing info: Kyro needs details before a quote or next step is practical.
- Ready to quote: Kyro has enough information to prepare or send a quote.
- Site visit needed: the job likely needs an appointment or inspection.
- Awaiting customer: Kyro is waiting for the customer to reply.
- Resolved: conversation appears handled.
- Needs review: Kyro needs the user to check information or classification.
- Needs approval: an action is waiting for user approval.

Opening a conversation shows the customer profile, lead status, inquiry facts, thread messages, draft replies, proposed actions, quote draft links, AI triage details, usage events, audit history, and status controls.

## Replying From Inbox

Users can reply to a conversation from the inquiry review page, Inbox preview, or Assistant preview.

Email replies send through the connected Gmail or Outlook account when:

- an email provider is connected,
- the contact has an email address,
- the user writes or approves the reply,
- the channel is email.

Manual user-written replies are treated as approved because the user wrote the body and pressed send. AI-generated/action-queue replies still go through the relevant approval/execution flow.

The reply composer can also generate a draft from a short instruction. The user should review the generated draft before sending.

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
- can send a user-approved reply through connected email,
- hides decision details such as confidence, reason, classifier, and sender-learning actions inside the three-dot menu,
- can teach Kyro that future emails from a sender should be treated as relevant or ignored, with the menu showing whether each sender rule is currently set,
- links conceptually to Settings, where sender rules can be reviewed, edited, added, or removed later,
- shows a Kyro `Replied` pill when Kyro has replied through this popup.

The `Replied` indicator is Kyro's internal log only. It does not try to detect replies sent directly in Gmail or Outlook.

Promoting a filtered-out email creates or reuses the normal CRM contact, lead, conversation, inbound message, and AI triage path. Kyro tries to refetch the original email from Gmail or Outlook when possible; if that is unavailable, it can still create a minimal work item from the stored sender, subject, summary, and classification metadata.

## CRM Screen

The CRM screen combines contacts and leads in one place.

Use it to:

- browse all contacts,
- filter to leads, clients, suppliers, contractors, builders, property managers, or other contacts,
- search by name, company, job, email, phone, or address,
- sort by last interacted, alphabetical order, most messages, or most leads,
- edit contact details,
- inspect linked conversations, leads, messages, AI runs, actions, audit history, and quote drafts.

The old `/leads` route redirects to CRM because leads are now a CRM filter rather than a separate primary screen.

## Documents Screen

Documents currently focuses on quote drafts and print-ready customer quote output.

Use it to:

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

Users can also ask Kyro in Assistant or Voice what quotes are ready to send, or ask it to prepare a quote email, for example "what quotes are ready to send?", "send the bathroom quote to Mikel", or "draft an email for this quote". Kyro does not directly send the customer email from that instruction. Instead, it finds the matching open quote, checks that the quote is linked to an inquiry and has a customer email, creates a secure customer approval link, generates the current PDF, creates a reviewable email draft action with the PDF attached, and links the user to the inquiry so they can approve or edit before sending. If the request is vague or several quote drafts could match, Kyro asks the user to choose.

Quote drafts now have three customer-output paths. The Print / PDF button opens deterministic customer-facing HTML for browser print/preview. The Download PDF button creates a server-generated PDF from the same structured quote data. The Send to customer button creates a secure approval link, generates the PDF, records the generated-document metadata on the quote draft, creates a reviewable email draft action with the PDF attached and approval URL in the email body, and redirects to the linked inquiry so the user can check the message before sending. The quote page also has a Customer approval card where the user can create a fresh approval link manually. Fresh links revoke older active links for the same quote draft.

The customer approval page lives at `/quote/approve/[token]` and does not require the customer to sign in. The token is a bearer secret in the URL; Kyro stores a hash of it in `quote_approval_links` rather than storing the raw token. Customers can approve the quote or request changes. Approval marks the quote draft `approved` and records a `customer_approved` history event. Change requests mark the quote draft `changes_requested`, record the note, reopen the linked conversation when there is one, and add a portal-origin inbound message so the user sees the requested change in the work queue.

When the user sends a generated quote email, Kyro regenerates the PDF attachment, sends through the connected Gmail or Outlook account, records the outbound message, and marks the quote draft sent.

Quote drafts also show a lightweight document and customer approval history. Kyro records document events in quote metadata when a PDF is downloaded, when an email is prepared with the PDF attached, when the PDF is actually sent, when a customer views the approval page, when they approve, and when they request changes. Each generated document metadata record includes a content hash of the quote data and template settings used to render it. The quote page compares that hash with the current quote content and can show whether the quote has changed since the last generated/prepared/sent document. Users can ask Kyro in Assistant or Voice questions such as "has this quote been sent?", "when did we send Sarah the bathroom quote?", "has Sarah approved the quote?", or "has this quote changed since it was sent?"

The current generated-document storage is metadata-first. Kyro records filename, content type, size, renderer, generation time, content hash, version-history events, and send/audit details on the quote draft and message metadata. The PDF bytes are generated on demand for download and send rather than stored in Supabase Storage yet. Drive storage, accounting exports, invoice issuing, payment collection, and durable generated-document file records are still future work.

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

## Settings Overview

Settings is split into these sections:

- General: workspace-wide defaults such as timezone.
- Communication: outbound reply/channel rules and signatures.
- Voice: assistant voice, outbound pronunciation policy, and pronunciation vocabulary.
- Integrations: Google Workspace, Microsoft Outlook, inbound email sync, quiet hours, and sync limits.
- Usage: provider/API cost visibility and metered usage ledger.

Settings sections are URL-addressable so a link or assistant card can open the correct section directly.

## General Settings

General settings currently hold workspace-wide defaults.

Timezone lives in General because it affects multiple features. Kyro uses timezone for local-time behaviour such as quiet-hours email polling.

Users should enter an IANA timezone such as:

- `Australia/Brisbane`
- `America/Denver`
- `UTC`

Kyro can change the timezone when the user asks clearly, for example: "Set the timezone to Australia/Brisbane."

## Communication Settings

Communication settings define outbound communication behaviour.

Current communication settings include:

- default reply tone,
- whether approval is required before outbound actions,
- allowed channels such as email, SMS, phone, and manual notes,
- user email signature,
- optional separate assistant-generated signature.

High-risk communication choices remain user-controlled in Settings. Kyro can explain them, but it should not silently change outbound approval policy, signatures, or provider secrets through chat.

## Voice Settings

Voice settings control Kyro's spoken assistant experience.

Current voice settings include:

- OpenAI assistant voice,
- outbound voice pronunciation policy,
- pronunciation vocabulary list,
- pronunciation preview controls.

OpenAI is the product-owned speech provider in the current app. Users choose the OpenAI assistant voice, not the underlying provider.

The saved voice is used for realtime voice and generated voice playback so Kyro sounds consistent across the app.

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

Emergency or after-hours businesses can change quiet-hours behaviour so polling stays the same overnight.

## Lookback And Fetch Cap

Missed-mail lookback is how many days back Kyro asks Gmail or Outlook to search each time it syncs. It helps Kyro catch messages after downtime, reconnecting, or a missed scheduled run. Duplicate provider messages are skipped by idempotency keys.

Fetch cap per sync is the maximum number of messages Kyro asks a connected provider for in one sync run. It limits provider/API work and AI classification cost.

Lookback controls how far back Kyro searches. Fetch cap controls how many messages Kyro will fetch/process in that run.

## Skipped-Mail Summaries

Skipped-mail summaries are optional lightweight summaries for emails Kyro decided not to promote into CRM work.

Kyro always records enough provider event information to avoid reprocessing duplicates. The summary setting controls whether Kyro also records a human-readable summary/reason that can appear in the filtered-out email popup and help the assistant understand what was skipped.

Turning summaries off can reduce AI/classifier work, but makes filtered-out email review less useful.

Sender learning rules can be created from the filtered-out email three-dot menu or managed later in Settings -> Integrations -> Sender rules. They are structured policy rules, not keyword rules the user has to write. "Treat sender as relevant" tells future syncs to promote matching sender email addresses or domains before normal classifier uncertainty. "Always ignore sender" tells future syncs to skip matching sender email addresses or domains before model classification. Settings can add rules manually, switch a rule between relevant/ignored, or remove a rule if Kyro learned the wrong thing.

## Usage Settings

Usage settings show provider/API cost and metering information.

Usage can show:

- provider cost,
- customer charge snapshot,
- gross margin snapshot,
- ledger event count,
- metered units,
- provider/model/service breakdown,
- recent usage events.

Usage is read-only. It does not collect payment, create invoices, or connect to Stripe or Apple billing yet.

## Web Search

Kyro can use public web search when enabled. Web search is for public/current internet information such as:

- sports results,
- news,
- supplier details,
- product information,
- public regulations,
- current facts.

Web search should not be used for private workspace data. CRM records, customer details, connected email, quotes, and messages must come from Kyro's own workspace tools.

## Email And Google/Outlook Reconnection

If Settings says an account needs reconnecting, it usually means Kyro does not have the required read scope for inbound sync.

Gmail inbound sync needs read access such as `gmail.readonly`. Outlook inbound sync needs `Mail.Read`.

Reconnect by disconnecting the account if needed, then using the relevant Connect flow in Settings. The new OAuth flow should request the current scopes.

## Safe Settings Kyro Can Change

Kyro can directly change a constrained set of low-risk settings when the user asks clearly:

- workspace timezone,
- inbound email sync mode,
- daytime email poll frequency,
- quiet-hours enabled/disabled state,
- quiet-hours start and end times,
- quiet-hours behaviour,
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

## Data And Audit Trail

Kyro records meaningful actions so users and builders can understand what happened. Assistant turns, AI runs, model route decisions, usage events, settings changes, email sync events, and important mutations are recorded in the database and/or audit log.

This audit-first posture is important because Kyro is meant to become an agentic operations system without becoming a black box.

## Performance And Loading

The web app avoids loading everything at once:

- main navigation routes are warmed in the background after idle,
- repeated list rows avoid prefetching every detail page,
- Settings loads only the selected section's data,
- the usage ledger loads only when Usage is selected,
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

If voice does not work:

- check browser microphone permission,
- check `OPENAI_API_KEY`,
- check realtime model configuration,
- try the text Assistant to confirm the Assistant thread works,
- check Voice settings for the selected OpenAI voice,
- review pronunciation entries if speech sounds wrong.

If generated replies feel off:

- add a clearer instruction to the Generate with AI box,
- review and edit before sending,
- update communication tone/signature settings,
- add durable instructions as explicit memories if the preference should stick.

## Builder And Deployment Questions

This manual is primarily for end-user help. If the user asks as a builder about architecture, tests, environment setup, deployment, or why a system behaves a certain way internally, Kyro can also use the architecture summary and deployment checklist.

Relevant builder references include:

- `docs/current-architecture.md` for app structure, data flow, integration behaviour, known gaps, and verification commands.
- `docs/deployment-checklist.md` for production environment variables, OAuth setup, Supabase checks, cron sync, OpenAI/realtime voice, and deployment smoke tests.
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
