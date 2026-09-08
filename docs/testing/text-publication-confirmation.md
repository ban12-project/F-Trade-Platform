# Text publication confirmation — #325

The server confirmation transaction now persists `social_publication.text_confirmation` with the approved aggregate version, current Gate 01 approval ID and digest of the scoped text payload. Both job claim and final Facebook authorization compare all three values. A later pending/rejected Gate 01 decision cannot be bypassed by an older approved row.

Migration `0030_text_publication_confirmation.sql` adds a nullable JSON column. Historical rows intentionally remain null: their next claim pauses, requiring a new human confirmation. Paused text attempts are eligible for explicit re-confirmation with a new confirmation reference. Submitted, published and unknown attempts still exclude the content from the candidate list. This does not authorize automatic retries or actual Facebook access.

The binding captures server state at confirmation. It does not yet prove that a stale client preview displayed that same version; carrying a preview version through the form is additional work before the complete user-facing confirmation guarantee can be claimed. Browser node/lease ownership, actual execution and receipt binding remain #322 work.

## Verification

Run only against a dedicated loopback PostgreSQL database named `facebook_publication_test`:

```sh
FACEBOOK_PUBLICATION_TEST_DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:5432/facebook_publication_test \
  node --conditions=react-server --import tsx scripts/test-facebook-publication-postgres.ts
```

The test applies the full migration history and creates unique synthetic fixtures. It uses the production confirmation function for text, then the production claim and authorization functions. Covered cases include unchanged text, signed payload tampering, edits after claim, version-only and body-only edits before claim, missing historical bindings, reapproval, subsequent rejection, explicit reconfirmation, image manifest freshness/rights, account isolation, concurrent claiming and timeout-to-unknown behavior. No browser or external publication is performed. TypeScript 7 and Biome checks also pass (existing publication-store lint warnings remain).
