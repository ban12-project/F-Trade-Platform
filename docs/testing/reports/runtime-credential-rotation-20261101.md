# Runtime credential rotation — 2026-11-01

Related to #749. A diagnostic read of private release state included a runtime
credential in tool output. No credential value or private configuration is
included in this report. This was an operator error; the operations guide now
explicitly requires allowlisted state fields and sanitized receipts.

A new random credential was applied to the production application environment,
the running compute broker, saved release configuration and matching private
rollback/configuration copies. Existing compute jobs were checked before the
broker update. The broker became healthy, the previous credential returned 403,
and the replacement credential reached authenticated input validation (400 for
an intentionally invalid, non-mutating action). No compute workspace was created
by these authentication probes.

Production application redeployment `dpl_2CsrZwkUaFFQW1aKPT2pyfPeqWuu` reached
READY. An independent lookup of `ftp.ban12.com` resolved to that same deployment.
The redeploy used the source deployment for main revision `de7d778...`; it loads
the updated environment. This does not constitute new customer workflow or
publication/DM acceptance.

The separate VPS release for `de7d778...` was retried only after unused failed
candidate build layers were removed and free disk rose above the unchanged
12 GiB build threshold. Current images, account volumes and recovery archives
were retained. Its final promotion remains subject to its own receipt and
running-image verification.
