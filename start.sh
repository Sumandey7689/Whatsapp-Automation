#!/bin/sh

set -e

PROFILE_DIR="/app/tokens/whatsapp-bot"

if [ -d "$PROFILE_DIR" ]; then
    echo "Cleaning up Chromium profile lock files in $PROFILE_DIR"

    rm -f \
        "$PROFILE_DIR/SingletonLock" \
        "$PROFILE_DIR/SingletonSocket" \
        "$PROFILE_DIR/SingletonCookie" \
        "$PROFILE_DIR/lockfile" \
        2>/dev/null || true
fi

echo "Node version:"
node -v

echo "Chromium path:"
which chromium

echo "Starting application..."

exec xvfb-run -a node web.js