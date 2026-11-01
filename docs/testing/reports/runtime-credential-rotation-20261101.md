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
were retained. The exact revision reached `ready`; independent inspection verified both
running controller images against saved release state, healthy containers,
fresh healthy capacity telemetry (1.1 seconds old), and public runtime health 200.

Verified image IDs:

- Agent: `sha256:4c3a84bbe930b54abf7607ba940e7f938f39c8083e84bd9e9d259bbe98ab6458`
- Broker: `sha256:e7b365e8142058a959f9d013a3c8004553d9d097137b6f4ed3466255267543a7`
- Browser worker: `sha256:d8e51086a29a42fa3c280cbc6c48410a7952dc96fbf4025fc6868cce9e40f657`

This verifies the production runtime delivery of #719/#748, including the
complete offline acceptance chain on the new candidate. Normal-UI first use
of the existing newly added account remains separate and unverified; #718 was
reopened after automatic merge closure. Real publishing/DM remains deferred.
