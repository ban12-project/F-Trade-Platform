# Private document read recovery — #348

The receipt claim reads private Blob bytes at most twice. A fresh read after 150 ms is
allowed only for ETIMEDOUT, ECONNRESET, EAI_AGAIN, UND_ERR_CONNECT_TIMEOUT,
UND_ERR_HEADERS_TIMEOUT, UND_ERR_BODY_TIMEOUT, or UND_ERR_SOCKET (including wrapped
causes). Both attempts disable the Blob cache. A failed stream is cancelled and its
partial bytes are discarded before another attempt.

Project access and receipt expiry are checked again before the second read. Missing
objects, invalid MIME/bytes/size, expired receipts, revoked access, unknown errors,
ENOTFOUND, and ECONNREFUSED do not trigger this retry. Evidence attachment and task
creation are outside the retry boundary. Existing transactional authorization and
receipt locking still protect the final attachment.

Validation on 2026-10-02: TypeScript and the existing PostgreSQL document-upload suite
passed. Added synthetic faults cover initial and partial-stream recovery, persistent
failure bounded to two attempts, missing object, MIME/byte mismatch, invalid host,
expiry between attempts, and revocation between attempts. Existing concurrent claim,
digest, size, provenance and mid-read revocation checks also pass.

These tests prove bounded recovery behavior, not the root cause of the historical
CSV failure. No real factory file was available. #348 remains open until a real
authorized intake is observed with the existing sanitized failure diagnostics.
