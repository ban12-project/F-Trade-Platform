# Workspace interaction accessibility — 2026-11-01

Related to #391. Extends the earlier [default-state audit](workspace-accessibility-20261101.md)
to open dialogs, validation feedback, navigation, settings and project membership.
This uses synthetic fixtures on an isolated checkout. #760's parallel evidence
selectors and copy were not modified; its later merged changes were retained
when rebasing for final verification.

## Findings and changes

The initial five-state/two-theme production scan passed 10 cases. Expanding it
to the Agent tab and open member sheet/removal confirmation exposed five failing
cases out of 16:

- The Provider select lacked a programmatic name in both themes. Associate its
  existing visible FieldLabel with the SelectTrigger using a stable ID; the label
  text, selected value, state and submission behavior are unchanged.
- The removal confirmation's destructive text/button background measured 4.48:1
  in light mode and 4.24:1 in dark mode. Earlier default-page checks did not cover
  this dialog surface. Adjust light/dark destructive foreground tokens and reduce
  the destructive button's background tint while keeping a stronger hover tint.
- One dark non-modal member-sheet scan flagged Base UI focus guards as hidden
  focusable elements. The settled-overlay scan waits for actual animations to
  finish, without disabling the rule or removing elements. Later settled scans
  did not reproduce it; that is not proof that every focus-guard timing is safe.

A subsequent 18-state development run caught both hover contrast failures,
including 4.14:1 in the light hover state. Merely changing the foreground was
insufficient; the button background adjustment addresses both base and hover.
Final development scans passed all 18 cases, with zero attempted POST requests.

## Coverage and verification

The nine states, each in light and dark themes, are: new-work dialog, invalid
new-project form, mobile navigation drawer, account settings, project overview,
member sheet, removal confirmation, hovered removal action, and Agent settings.
Every scan retains violations and incomplete results as test attachments. All
POST attempts are intercepted and counted; a passing scan requires zero attempts.
No remove/save action is performed. This is settled-state automated coverage,
not a screen-reader or real touch-device certification.

Running Next dev independently exposed Provider as a named combobox; its
configuration/session errors and compilation issues were empty. The dialog
screenshot was inspected. React tree introspection returned only a completion
marker, so no component-tree evidence is claimed.

Initial development access through 127.0.0.1 was blocked by Next's dev-origin
protection for HMR/font resources and left the UI unhydrated. That test attempt
was stopped, and localhost was used without changing allowed origins or security
configuration. The next run also exposed premature mobile-drawer activation;
the scan now waits for the existing new-work hydration gate before opening the
drawer. This is an explicit post-hydration audit, not a test of pre-hydration
interaction. Both intermediate failures remain recorded.

## Limits

Physical iOS/Android keyboard/safe-area behavior, VoiceOver/NVDA announcements,
all application states and controlled production performance remain unverified.
Zoom remains out of scope. Keep #391 open. No account credentials, customer data,
external messages, production settings or #760 evidence-selector work changed.

## Production-build checkpoint

On baseline main `0984238`, the final production build and all 48 targeted tests
passed without retries: 18 interaction scans, the prior 15 default/naming tests,
11 keyboard/preference cases and four existing Agent settings cases. TypeScript
and repository validation pass. Targeted Biome exits zero with 11 pre-existing
CSS override warnings plus the existing settings non-null assertion warning and
string-concatenation suggestion; they were not silently repaired in this change.
General automatic CI remains paused under #711.

The subsequent rebase onto main `559917c` retained #762/#760 unchanged. Its first
48-case run had 47 passes and one test-setup failure: the mobile drawer scan
waited for a desktop new-work trigger that the mobile layout need not mount.
The fixture now confirms hydration at desktop width before switching to the
390-pixel viewport and opening the drawer. It does not claim cold mobile
hydration coverage. No accessibility assertion or rule was removed.

After correcting that preparation step, all 48 tests passed on the same rebased
production build in 59.2 seconds, with no skips or retries. Final typecheck and
repository validation passed. The owned development/production servers and
agent-browser session were closed. Cache Components, both React Compiler flags,
default Turbopack and local TypeScript CLI validation remain enabled.
