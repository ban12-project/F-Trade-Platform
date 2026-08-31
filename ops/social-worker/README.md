# Controlled social Worker deployment

This directory is a deployment baseline for the single VPS authorized by #155. It is not a browser profile, a credential bundle, or a command to activate automation.

## Preconditions

- The VPS has one verified, fixed US egress IP. Do not deploy if the egress check differs from the account record.
- The account owner completes Facebook login, 2FA and any security checkpoint locally over an SSH-tunnelled VNC session; the Worker never receives passwords, 2FA codes or CAPTCHA-solving credentials.
- The encrypted local volume is restricted to the Worker account. It may contain the browser runtime state, but that state must not be copied to application storage, logs, GitHub, or support messages.
- Set unique values for `SOCIAL_WORKER_SIGNING_KEY` and `SOCIAL_MESSAGE_ENCRYPTION_KEY` only in the VPS `.env`. Telemetry and tracing remain disabled.

## Operating controls

- Run exactly one replica and one account profile. Do not use proxy rotation, account switching, automatic login recovery, or automatic retries after uncertain external effects.
- The Worker must refuse an unsigned, expired, addressed-to-another-worker, or replayed command.
- Stop the container immediately on a security checkpoint, CAPTCHA, 2FA request, login loss, IP mismatch, unknown page structure, or indeterminate publish/reply result. A human account owner must resolve it before a new command is accepted.
- Publishing stays disabled until the console has a Gate 01 approval and a per-post human confirmation. DM replies stay limited to the approved deterministic RFQ template path.

## Lifecycle

Bring up or restart the Worker only under the approved runbook. Never run database migrations from this directory. Updating the image requires a reviewed PR and an explicit human deployment action.
