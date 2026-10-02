# MVP1 production session and publication checkpoint — 2026-09-24

Issue #383. This report records production observations after the session-first rollout and the later private text receipt acceptance. Video publication and real inbound DM acceptance remain open.

## Production session result

The original managed Sandbox and application were deployed with the native Firefox profile, reviewed text-only browser image, and session-first Agent. A stopped provider session had left the application's browser node marked `running`; PR #431 added fenced reconciliation against the exact recorded provider session. After deployment, the dispatcher settled that stale state and accepted a new read-only browser task. PR #433 then corrected the Agent's observe-only path to wait through Messenger's intermediate `messenger` state until the reviewed `ready` state, without requesting password, TOTP or PIN recovery.

The first production read-only task finished with the account shown as `登录已就绪`. The Agent and browser exited, the Sandbox stopped, and a new snapshot was created. The second read-only task resumed from that stopped state in a new provider session and again finished with the account shown as `登录已就绪`. The same persistent account profile was used across task, browser-container replacement, and Sandbox stop/resume. A diagnostic fork using the same profile and proxy independently observed the expected proxy egress and the Messenger transition from `messenger` to `ready`; it was stopped and removed after diagnosis. Neither production task required a new interactive login or factor submission.

This proves the application's read-only session path and provider wake/stop cycle for the reviewed account. It does not prove that the credential broker made zero *claims* internally or that a real inbound DM can be read. The browser review expires and must be renewed before another task if it is no longer current; that should fail closed rather than trigger a repeated login.

## Publication and inbound gates

| Gate | Production observation | Remaining acceptance action |
| --- | --- | --- |
| Existing text publication | One historical post is shown as `已发布（人工核对）`; its original node receipt remains `unknown` and its channel is paused. | Preserve both records. Do not relabel the old runtime receipt as automatic success. |
| New text publication | The fifth distinct synthetic `Only me` text item was approved and submitted once. It reached `published` with a canonical permalink and a node receipt whose authorization, external reference and payload digest match the durable job. The first four attempts remain failed/paused without receipts. | Keep the earlier jobs paused; retain their separate audit records. See the [publication attempt report](mvp1-production-publication-attempt-20260924.md). |
| Publication wake | The fifth private text job woke the stopped managed Sandbox and ran the reviewed Agent image, then completed its receipt. | Preserve this production evidence as a regression checkpoint for future image or provider changes. |
| Video | Production content/video creation has earlier controlled evidence; this rollout's browser profile is text-only. | Obtain a separately reviewed video profile and current authorized asset, preview and approve the final video, then run a private publication and receipt test. Do not infer video acceptance from text. |
| DM | Inbox polling remains disabled and there is no real inbound-message acceptance. The preserved Messenger profile can reach `ready`; an empty chat view is not evidence of message capture. | Review and enable the exact inbox scope, receive a consented test DM, and verify single capture, deduplication, durable mapping, and wake from a stopped Sandbox. Test recovery only after an observed expired session; CAPTCHA must never create a login loop. |

## Next execution order

1. Keep the same account volume and reviewed proxy settings. Before every task, inspect the existing session; use encrypted password/TOTP/PIN only after a positively observed expiry. Leave CAPTCHA for human completion without spawning another clean-profile login.
2. Retain the fifth text item's exact approved body, `Only me` audience, confirmation reference, authorization, receipt and permalink. Do not replay the four earlier failed/paused jobs.
3. Conduct video and DM runs under their own reviewed scopes. Record production observations separately from synthetic test results, and treat any ambiguous external effect as `unknown` without retrying.

The current checkpoint is **session persistence, private text receipt and publication-demand wake passed; video and real inbound DM pending**.
