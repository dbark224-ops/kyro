# Mobile test queue

A running list of what is in the build you have, and what is waiting for the
next one. Append to the bottom of "Waiting for the next build" as changes land;
move them up when a build ships.

---

## In build 27 — testable now

Uploaded 5 September 2026 from `14afdf6`. First successful iOS build since
12 July, and the first with push notification entitlements.

**Contact types match the server again.**
Open a contact and change its type. "Builder" is gone — it was retired on the
backend months ago, so choosing it used to save silently as "Other". "Staff" is
now there, and works as a filter.

**Lifecycle is gone from the CRM.**
The contact detail screen used to show a "Lifecycle" pill and a whole Lifecycle
card with its own stage picker. Both are gone; the Details card now leads with
the contact type. Worth confirming nothing looks empty where the card used to
be.

**A contact's second number now shows.**
On a contact with one saved, Details shows a row labelled with whose number it
is — "Wife (Sarah)" rather than "Other number". Contacts without one show
nothing extra.

**Money no longer defaults to Australian dollars.**
Four places assumed AUD. The one that mattered: creating a payment link. Start
one and check the currency matches the workspace rather than showing A$.

**iPad support is switched off.**
The app no longer declares itself iPad-compatible. Nothing to test on a phone —
it matters at App Store review, where a reviewer would otherwise open a stretched
phone layout on a 13-inch screen.

---

## Waiting for the next build

**Sign-in screen no longer drifts while you type.** — `233993d`
Reported from device: the whole sign-in screen crept up and down as characters
were entered. The form was centred inside a keyboard-avoiding container, so
every change in keyboard height moved it by half that amount — and iOS changes
that height constantly while typing, as the predictive-text and password
autofill bars appear and disappear.

To test: type into email and password and watch whether anything moves. Also
worth checking two things that came with the fix — the Sign in button should
respond on the *first* tap while the keyboard is up (it used to swallow the
first tap dismissing the keyboard), and dragging down should put the keyboard
away.

Known and deliberately left: the form still shifts once when a sign-in fails,
because the error message adds a row. That is one movement at a moment when
something has gone wrong, not a jitter while typing.

---

## Known gaps — not bugs, just not built yet

**Push notifications are entitled but not wired.**
The App ID carries the capability and the profile has `aps-environment`, so the
app is *permitted* to receive pushes. Nothing sends or receives them: the app
never requests a push token, there is no token storage, and the escalation
`app_notification` step returns success without contacting anyone.

Calendar reminders *do* work — those are local notifications the phone fires at
itself, no server involved. So notifications will appear on the device; that is
not evidence push works.

**The `app_notification` escalation step is a silent no-op.**
Worth fixing regardless of whether push gets built, because it reports "sent"
and ends the escalation chain rather than falling through to SMS or a phone
call. Every other undelivered channel throws for exactly this reason.

**The mobile branch is behind main.**
`codex/mobile-app` carries its own copy of the web app, frozen at 25 July. That
copy is not what serves the API — the app calls the deployed backend from
`main` — so it does not affect behaviour, but do not read it as current.
