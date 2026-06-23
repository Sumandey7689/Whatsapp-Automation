#!/bin/sh

set -e

# Clean up Chromium profile lock files for all sessions
PROFILES_DIR="/app/profiles"

echo "Cleaning up Chromium profile lock files..."

# Clean profiles directory
if [ -d "$PROFILES_DIR" ]; then
    for SESSION_DIR in "$PROFILES_DIR"/*/; do
        if [ -d "$SESSION_DIR" ]; then
            rm -f \
                "$SESSION_DIR/SingletonLock" \
                "$SESSION_DIR/SingletonSocket" \
                "$SESSION_DIR/SingletonCookie" \
                "$SESSION_DIR/lockfile" \
                2>/dev/null || true
            # Also clean Default/Cache and other locks if present
            if [ -d "$SESSION_DIR/Default" ]; then
                rm -f \
                    "$SESSION_DIR/Default/SingletonLock" \
                    "$SESSION_DIR/Default/SingletonSocket" \
                    "$SESSION_DIR/Default/SingletonCookie" \
                    "$SESSION_DIR/Default/lockfile" \
                    2>/dev/null || true
            fi
        fi
    done
fi

echo "Node version:"
node -v

echo "Chromium path:"
which chromium

echo "Starting application..."

exec xvfb-run -a node src/app.js