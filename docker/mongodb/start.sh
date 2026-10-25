#!/usr/bin/env bash
set -euo pipefail
# Persist one internal authentication key across MongoDB container replacements.
if [ ! -s /data/db/replica.key ]; then
  head -c 756 /dev/urandom | base64 > /data/db/replica.key
fi
chmod 400 /data/db/replica.key
chown mongodb:mongodb /data/db/replica.key
exec /usr/local/bin/docker-entrypoint.sh mongod --replSet rs0 --keyFile /data/db/replica.key --bind_ip_all
