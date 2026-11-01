# Native-profile live startup checkpoint — 2026-11-01

Related to #718 and #674. After the verified runtime rollout, the existing newly
added enabled account was started through the normal production Channels UI.
The request moved from starting to running; connecting through the normal
viewer control displayed both the application and viewer connected states and
an actual rendered Facebook page. No credentials were entered, no publication
or message was sent, and no account authorization or proxy setting was changed.

Read-only host inspection found one active browser, using the exact accepted
worker image `sha256:d8e51086a29a42fa3c280cbc6c48410a7952dc96fbf4025fc6868cce9e40f657`.
Its container was created at 04:03:59 UTC. Its owner manifest and Firefox
directory existed; source was `empty` and imported was true. Crucially, the
manifest modification time was 2026-10-30 23:37:08 UTC, predating this run.
Therefore this live result proves startup with the retained account profile,
not initialization of a previously empty production volume during this test.
Empty-volume initialization remains covered by the actual VPS synthetic image
chain and the focused regressions recorded with #719/#748.

The UI disabled saved-credential entry because the account had no currently
valid login-page rule. That restriction was preserved. A rendered signed-in
page is not an independent expected-account identity check, and no login-ready
acknowledgment was submitted. Login-rule/identity verification and all real
publishing/DM acceptance remain separate from the startup fix.

The session was ended with the normal release control. The viewer disappeared;
subsequent host inspection found zero active browser-run containers. Private
profile contents, identifiers, credentials and screenshots are not included in
GitHub. The local screenshot is retained only in ignored operational evidence.

Together with the candidate's complete first-use/persistence/isolation tests
and exact-image deployment proof, this completes #718's remaining normal-UI
startup check. It does not resolve every historical #674 startup incident or
establish MVP1 business acceptance.
