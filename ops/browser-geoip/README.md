# Independent GeoIP updates

The official launcher reads the named volume `ftrade-browser-geoip-v1` at
`/opt/ftrade/geoip`, read-only with copy-up disabled. This volume contains public
GeoIP databases only; no account volume or credential is used by the updater.
The image seed is for isolated tests, not a production refresh mechanism.

Install `ops/browser-geoip/install.sh` on the VPS before the official-runtime
cutover. The hourly timer uses the currently selected immutable browser image,
skipping legacy images. A healthy database checked within 24 hours needs no
download. Updates use the official source and require readable MMDB metadata
with a build date no older than eight days. A frozen source cannot be made fresh
just by changing its file timestamps.

The updater reserves 1 GiB and one CPU under existing host admission, then runs
a separate container with those limits, a read-only root, dropped capabilities,
no published ports and only the GeoIP volume writable. Browser/model assets are
not downloaded. New databases are validated in temporary storage before an
atomic generation switch. The current and previous generation are retained;
older generations are removed only after successful publication.

An update failure (including termination leaving `updating`) denies new browser
launches. Existing browser sessions are not stopped. The hourly timer retries;
rollback can select the previous generation only if it still passes freshness
validation. Failure does not overwrite the prior database or account storage.

For initial preparation of an already validated candidate, use a transient unit
with the same host admission mount, substituting the actual immutable image ID:

```sh
systemd-run --wait --pipe --collect \
  --property=BindPaths=/opt/ftrade-vps/capacity:/run/ftrade-capacity \
  --setenv=FTRADE_HOST_CAPACITY_DIR=/run/ftrade-capacity \
  --setenv=FTRADE_HOST_ADAPTIVE=1 \
  /usr/bin/python3 /opt/ftrade-vps/geoip-update/update.py \
  --image sha256:REVIEWED_IMAGE_ID
```

The same command supports `--mode check` and `--mode rollback`. Normal timer
execution omits `--image`. Inspect `systemctl status ftrade-geoip-update.timer`
and the updater service receipt after installation. A source/package change
requires reviewing and reinstalling the host helper; browser release rollback
does not delete or rewrite this data volume. If rolling back to the legacy
runtime, its image ignores the new mount and the timer skips its refresh.
