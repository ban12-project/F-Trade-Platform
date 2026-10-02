# Synthetic private video and UI acceptance — 2026-10-02

Refs #492, #246 and #391. Upload follow-up: #307 and #348.
The production application was observed on `86d49db` before the run and its custom-domain
alias was verified READY at `2314e5f88062d06651d56d12d64a955fa1a55846` after #493 merged.
Only explicitly labelled synthetic fixtures and a pre-existing TEST ONLY MOCK product were
used. This does not establish factory accuracy, real-channel acceptance or physical-device coverage.

## Private video

The newly imported incomplete product was correctly blocked from starting video work.
A separate run used the pre-existing approved TEST ONLY MOCK product without changing its
facts or approval. The sole selected claim was its explicit test product name. Two original
1080 × 1920 geometric PNGs carried TEST ONLY SYNTHETIC, FRAME A/B and NO PRODUCT FACTS.
Their rights reference was backed by a local creation/provenance record. No third-party imagery
or engineering, price, delivery or fitment claim was introduced.

The authenticated UI completed source upload and one AI draft job. The draft's creative
caption and final CTA were edited to `TEST ONLY SYNTHETIC` and `Internal preview only`,
saved, then submitted once for private composition. The draft and render jobs each succeeded
on their first attempt. The render ran from 14:43:18 to 14:45:30 UTC. Read-only inspection found
aggregate version 6 in `VIDEO_REVIEW_REQUIRED` and an export receipt in `review_required`.
No approval, publication, social browser run or DM was performed.

The private Blob was read independently without cache: HTTP 200, exactly 1,159,359 bytes,
matching the durable asset size. SHA-256:
`68d95bf0284cffdb02fe16061d3d8a602fd3eabd0b46be316205abe21549b655`.
Independent ffprobe of those downloaded bytes agreed with the stored measurements:

| Property | Observed |
| --- | --- |
| Container and codecs | MP4, H.264 video, AAC audio |
| Dimensions / rate | 1080 × 1920, 30 fps |
| Duration | 7.061333 seconds for a 7-second timeline |
| Pixel format / color space | yuv420p / bt709 |
| Audio | 48 kHz, two channels (export receipt) |
| Subtitle streams | 0 (captions rendered into the image) |

The authenticated production browser loaded the 1080 × 1920 video with readyState 4 and
played through to `ended = true`, currentTime = duration, without a media error. The final
frame showed FRAME B and the internal-preview CTA. The review form remained unsubmitted.
An unauthenticated GET to the custom-domain preview endpoint returned HTTP 403, text/plain,
with no redirect. Private storage paths and identifiers are excluded from this report.

## Production source-error follow-up

After a hard reload on verified production `2314e5f`, the original synthetic CSV with
unrecognized underscore headers was uploaded again through the UI. It was rejected with
the new missing-label guidance, including Product name, Product type, Internal SKU and the
manual-entry alternative. The import button became available again and no draft was shown.
This is an observed post-deployment repair of the confusing error, not a recovery of the
historical #348 attempt or the missing original objects in #463.

## Interface checks

All 11 existing workspace-modern-ux Chromium tests passed locally with no retries in 10.2 s.
They cover keyboard skip navigation, loading semantics, hydration gates, dialog focus,
required-field association, narrow layouts, touch target sizes, reduced motion and forced colors.
The separate 15 product-workflow tests recorded in the upload report also passed.

In the authenticated production UI, Enter opened Start New Work, an empty new-project submit
focused the invalid name field, and aria-describedby resolved to the visible required-field
message. Escape closed the dialog and restored focus to its trigger; no project was created
by this negative form check. Read-only computed styles were used for a bounded light-theme
contrast sample (CSS Lab D50 adapted to D65, sRGB alpha compositing, WCAG luminance): source
error text on its actual nested background approximately 4.71:1, form error on white 4.91:1,
secondary text on white 6.00:1. These samples do not constitute a whole-site contrast audit.

## Preserved limitations

The rights-evidence field rejected a plain-language provenance sentence until the existing
private-reference format was used; its current label does not explain that format. This is
an input-contract usability observation, not authorization to fabricate rights evidence.
A native player shadow-control selector was unavailable through the browser bridge; its
visible play control worked and the video reached its end. A direct private read succeeded,
but the first container-side anonymous request to the custom domain timed out. A subsequent
request to the deployment URL hit Vercel's 302 deployment protection; neither was counted as
application authorization evidence. The separate custom-domain Windows HTTP request produced
the application-consistent 403 described above.

Real factory media, full visual quality against product facts, official platform-rule updates,
physical iOS/Android and screen-reader acceptance remain separate open work. Synthetic
completion does not close #246 or #391.
