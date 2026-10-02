# Offline installation of launch diagnostics — 2026-10-02

Refs #494, #491 and #490. Source: reviewed main commit
`86d49db38c73c7f6e68cf87145aa84e40d2937f7`. Its Browser images (GHCR) workflow completed
successfully, including release validation and publication for both architectures.

The active persistent Sandbox was stopped and its database lifecycle was stopped, with no
operation in progress, live run or unexpired lease. Its current snapshot was available. A new
persistent maintenance copy was forked from that exact current snapshot with deny-all networking,
two vCPUs, a 20-minute session limit and 30-day snapshot retention. Original node/account scope
was checked against the native profile owner file. Cookie data was present.

The published immutable Agent tag was pulled locally and exported as a Docker archive. Its
86.8 MB compressed archive was transferred in eleven bounded chunks into the deny-all copy;
no registry network exception was added. The loaded image's complete root filesystem layer
list and Env, Entrypoint, Cmd, WorkingDir, User and Labels matched the local registry image.
Its revision label was the reviewed commit above. The prior browser image was retained because
#491 changed the Agent's diagnostic path, not the browser implementation.

A one-shot container with `--network none` loaded the actual packaged diagnostic module. It
verified structured browser-health/open-tab/ssl_error/502 output and the unknown-value fallback.
Unreviewed request names, stages, error codes and a secret canary were excluded. No Agent loop,
Camofox session, social site, login-fill grant, post or DM was started. After verification no
container remained running. Native owner-file and cookie-database hashes equalled their
pre-install values. Uploaded image chunks and the temporary scope file were removed from the
maintenance snapshot; previous images, profile volume and rollback resources were retained.

The first immediate assertion after requesting stop observed a nonterminal provider state.
It was not treated as a completed snapshot. A subsequent read with `resume: false` confirmed
the same session stopped, a created snapshot, and more than 29 days of remaining retention.

Before selecting the new snapshot, the original node document, lifecycle row, provider session,
network policy and old snapshot were compared again with the captured baseline. All matched.
At 15:00:32 UTC the verified snapshot was selected on the original stopped Sandbox. A fresh
provider read confirmed the selected snapshot, unchanged session and network policy, and
continued stopped status. The former snapshot was still available; evicted snapshots are not
deleted by the selected retention settings. No lifecycle or business database repair was needed.

The production Agent-image environment variable was updated to the exact verified Docker
image ID. The browser-image variable was left unchanged. The documentation PR's normal main
production deployment will load this environment selection; final READY verification is recorded
on the delivery issue. A subsequent social execution has deliberately not been attempted while
#490's externally rejected proxy authorization remains unresolved. Offline diagnostics succeeding
does not establish proxy recovery or complete #480.
