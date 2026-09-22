# Firefox155 candidate images

The existing release-image workflow still selects its pinned152 release.
Its green status does not certify a Firefox155 image. For Linux x86_64
acceptance, use the complete `runtime-candidate` artifact produced by the
Camoufox runtime workflow, and supply its independently recorded package
SHA256 and browser source commit:

```sh
CANDIDATE_DIR=/absolute/path/to/runtime-candidate \
CANDIDATE_SHA256=<complete-candidate-archive-sha256> \
CANDIDATE_COMMIT=<40-character-browser-source-commit> \
sh ops/browser-node/build-candidate-browser.sh
```

This builds `ftrade-browser-candidate:local` without publishing. The service
checkout remains pinned by `camofox.ref`; package-lock.json and all service
plugin dependency hooks are retained. The existing browser.Dockerfile adds
its watchdog, GeoIP resources and platform plugins to the verified base.
Only amd64 is supported by this acceptance entry point.

The installer checks the external archive hash, source commit, successful
native build, source checksum agreement, complete file set and each file
hash, executable/libxul ELF architecture, resources, App.Version, BuildID and
wrapper metadata. It refuses links, special files, traversal, duplicate files
and a nonempty destination. It does not fetch a released browser or repair
missing candidate files. The original manifest remains in
`/opt/ftrade/candidate-manifest.json`; image labels record archive hash and
source commit.

Installer unit checks are not image or browser acceptance. The image still
needs to be built on Linux, checked against the sealed candidate identities,
and exercised with the actual browser, REST, watchdog and gateway. Never
substitute a release image if candidate installation or startup fails.
