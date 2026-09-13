# Upload provenance regression (#336)

A second user uploading the same product document previously reused the first
uploader's evidence ID. Project linking then correctly rejected the second user.
The conflict was reproduced with actual persistence and authorization functions,
real PostgreSQL, and synthetic storage/conversion adapters.

Each upload now gets an independent evidence ID and private blob. SHA-256 remains
a checksum and searchable metadata, not an authorization or provenance identity.
This applies to product documents, direct video assets, internet-media provenance
manifests, and verified video upload receipts. Project authorization is unchanged.
Separate uploads can store duplicate bytes; this is intentional to preserve their
independent provenance. Content-addressed storage would require a separate blob
layer and explicit provenance references, rather than sharing evidence records.

Migration 0038 replaces only the global unique digest index with a non-unique
index. Existing IDs, blobs, classifications and project links are retained. Apply
it before deploying the new upload code. Do not roll back the unique index once
duplicate digests exist. As with preceding hand-authored migrations, no generated
snapshot is included: generation from the old snapshot otherwise repeats already
applied Facebook migrations.

Video receipt confirmation locks the receipt and reuses its claimed evidence ID,
so concurrent/repeated confirmation creates one record for that upload. Different
receipts preserve separate records and already-uploaded blobs, even for identical
bytes. Product conversion runs before persistence so conversion errors do not
create stored uploads. A database constraint rejection deletes the newly stored,
unreferenced blob. Uncertain transport failures retain it: a separate read cannot
prove that the original insert will never commit. Storage deletion failure or a
lost storage acknowledgement still requires reconciliation; this change does not
claim a durable orphan-blob cleanup queue.

Run with a dedicated local synthetic database:

```sh
EVIDENCE_UPLOAD_TEST_DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:5432/evidence_upload_test \
  node --conditions=react-server --import tsx scripts/test-evidence-upload-postgres.ts
```

The test migrates the database and checks independent/concurrent uploads, stored
byte readback through a synthetic private store, cross-project linking denial,
receipt confirmation concurrency and retries, conversion failure, rejected insert
cleanup, and lost database acknowledgements. It is also part of the PostgreSQL CI
job. Cloud Blob integration, live conversion and authenticated HTTP readback remain
separate #307 acceptance work; no real account, customer files or Sandbox is used.
