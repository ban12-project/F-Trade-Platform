# Video resource measurements

Part of #126 / #318. This adds measurement evidence; it does not resolve platform rule versions, select an account/API path, or authorize publication.

The export manifest is now schema 1.3.0 with resource measurement contract 1.0.0. Fresh ffprobe results and persisted export artifacts carry `measured.resources`. Historical artifacts can omit it; their downloaded manifests explicitly show null values and list the four unknown fields. Existing project preset limits and `platformAcceptance.status = not_evaluated` remain unchanged.

| Field | ffprobe source | Unit / interpretation |
| --- | --- | --- |
| fileSizeBytes | FORMAT.size | File size in bytes |
| containerBitrateBps | FORMAT.bit_rate | Reported overall bitrate, bits per second |
| videoBitrateBps | Selected video STREAM.bit_rate | Reported average bitrate, bits per second |
| audioBitrateBps | Selected audio STREAM.bit_rate | Reported average bitrate, bits per second |

Only positive safe integers in decimal form are retained. Missing values, N/A, zero, negative, fractional, exponent-form and unsafe integers remain null. No guessed bitrate is derived from a preset, and overall bitrate is never substituted for video bitrate. Probe metadata is evidence, not a frame-by-frame bitrate analysis: peak bitrate remains explicitly `not_measured`. This does not establish compliance with any platform's peak bitrate, account eligibility or acceptance rules.

The shared probe-entry list is used by local FFmpeg, sandbox FFmpeg and Remotion sandbox probes. The parser, export input schema and persisted artifact schema retain the new fields. This iteration locally tests the shared parser and actual FFmpeg pipeline; it does not claim a new live Vercel Sandbox run.

## Verification

On 2026-09-08 / Node 24:

- A new regression first failed because size/bitrate values were discarded. Parsing, manifest and historical/invalid-value controls passed after implementation.
- Existing video contracts and project export-preset tests passed; TypeScript and Biome passed (existing warnings retained).
- The default local FFmpeg 9.0.1 lacks the required subtitles filter, so its full renderer run failed before export assertions. This remains a recorded environment failure.
- The already-installed `/usr/local/opt/ffmpeg-full/bin/ffmpeg` and matching ffprobe passed the full five-preset synthetic rendering suite. Each output's reported file size equals filesystem stat; container/video/audio bitrates are positive. Existing caption, CTA, source/muted audio, display-shape and manifest checks also pass. No private customer media or external platform calls were used.

## Sources and remaining scope

[FFprobe documentation](https://ffmpeg.org/ffprobe.html#Main-options) describes FORMAT/STREAM metadata selection. [FFmpeg AVCodecParameters](https://ffmpeg.org/doxygen/trunk/structAVCodecParameters.html) defines stream bit_rate as average encoded-data bitrate in bits per second. Sources inspected 2026-09-08; these document probe semantics, not Meta publishing rules.

#318 remains open: target API/account path, current versioned platform sources, the Facebook project-preset/source duration discrepancy, and any peak/other unmeasured constraints still need separate resolution. Unknown fields must not be counted as passing a future platform rule evaluation.
