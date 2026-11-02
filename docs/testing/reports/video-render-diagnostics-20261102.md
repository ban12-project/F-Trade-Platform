# Sandbox render diagnostics and command waiting (#807)

## Findings

The previous implementation waited for rendering through a single streaming
`Session.runCommand` response. A private authorized reproduction using the
reported draft and its retained sources failed with `TypeError: terminated`.
The command did not return an exit code. Historical production logs only retain
`stage=render, code=RENDER_FAILED`; they cannot prove the underlying transport
exception for that historical invocation.

A quiet 330-second `sleep` completed through the original API. Therefore a
universal five-minute idle timeout is **not** established. The exact transport
component that terminated the original response remains unknown.

A separate SDK experiment established that `Session.getCommand()` did not expose
a completed exit code for a finished detached command, whereas `Command.wait()`
returned zero. Plain getCommand polling is not the shipped implementation.

## Change

Start each compute command once in the original Session, then call its `wait()`
with a 30-second AbortSignal. Only expiration of that wait signal retries waiting
for the same command. Other errors fail immediately; no command restart,
provider fallback or VM resume occurs. The existing nonpersistent ten-minute VM
lifetime and cleanup remain intact.

Remotion logs bounded stages, elapsed time, command exit code and allowlisted
error categories. No raw renderer output, source identifiers, signed URLs,
product text or credential values are emitted by this diagnostic layer.

## Verification

- Authorized private workload reproduced without business DB writes or publishing.
- Same retained sources and edit draft succeeded after the command-wait change:
  renderer exit 0, probe exit 0; 1080x1920, 30 fps, H.264/AAC, yuv420p,
  stereo 48 kHz. Render command took approximately 342 seconds.
- Worker observations showed free disk capacity and zero cgroup OOM/OOM-kill events.
- Sandbox cleanup completed. Temporary private diagnostics remain ignored locally.
- Provider regression covers a timed-out wait followed by success on the same
  command, with exactly one command submission and no resumable Sandbox API.
- Diagnostic privacy/error-preservation test, Remotion workspace regression,
  TypeScript and production build passed.

This verifies an isolated render, not a production UI retry, saved preview or
publication. Production acceptance should verify the newly deployed revision.
CI remains temporarily paused under `docs/operations/temporary-ci-pause.md`.

## Creative review applicability

ABCD creative review does not apply: this changes compute command waiting and
operational diagnostics only. Composition, captions, prompts, branding, CTA,
source selection and output encoding are unchanged.
