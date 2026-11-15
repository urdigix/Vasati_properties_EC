#!/bin/sh
set -e

if [ "${NODE_ENV:-production}" = "production" ] && [ -z "${ADMIN_DEFAULT_PASSWORD:-}" ]; then
  echo "ADMIN_DEFAULT_PASSWORD is required in production."
  exit 1
fi

exec node server.js
