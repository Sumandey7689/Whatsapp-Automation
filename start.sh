#!/bin/sh

set -e

# Clean up Chromium profile lock files for all sessions
TOKENS_DIR="/app/tokens"
PROFILES_DIR="/app/profiles"

echo "Cleaning up Chromium profile lock files..."

# Clean tokens directory
if [ -d "$TOKENS_DIR" ]; then
  for SESSION_DIR in "$TOKENS_DIR"/*/; do
    if [ -d "$SESSION_DIR" ]; then
      # Remove all possible lock files
      rm -f "$SESSION_DIR"/SingletonLock \
            "$SESSION_DIR"/SingletonSocket \
            "$SESSION_DIR"/SingletonCookie \
            "$SESSION_DIR"/lockfile \
            "$SESSION_DIR"/.lock \
            "$SESSION_DIR"/CrashpadMetrics.pma \
            "$SESSION_DIR"/BrowserMetrics-spare.pma \
            2>/dev/null || true
      
      # Clean subdirectories too
      for SUB_DIR in "$SESSION_DIR"/*/; do
        if [ -d "$SUB_DIR" ]; then
          rm -f "$SUB_DIR"/SingletonLock \
                "$SUB_DIR"/SingletonSocket \
                "$SUB_DIR"/SingletonCookie \
                "$SUB_DIR"/lockfile \
                "$SUB_DIR"/.lock \
                2>/dev/null || true
        fi
      done
    fi
  done
fi

# Clean profiles directory
if [ -d "$PROFILES_DIR" ]; then
  for SESSION_DIR in "$PROFILES_DIR"/*/; do
    if [ -d "$SESSION_DIR" ]; then
      # Remove all possible lock files
      rm -f "$SESSION_DIR"/SingletonLock \
            "$SESSION_DIR"/SingletonSocket \
            "$SESSION_DIR"/SingletonCookie \
            "$SESSION_DIR"/lockfile \
            "$SESSION_DIR"/.lock \
            "$SESSION_DIR"/CrashpadMetrics.pma \
            "$SESSION_DIR"/BrowserMetrics-spare.pma \
            2>/dev/null || true
      
      # Clean Default directory and other subdirectories
      for SUB_DIR in "$SESSION_DIR"/*/; do
        if [ -d "$SUB_DIR" ]; then
          rm -f "$SUB_DIR"/SingletonLock \
                "$SUB_DIR"/SingletonSocket \
                "$SUB_DIR"/SingletonCookie \
                "$SUB_DIR"/lockfile \
                "$SUB_DIR"/.lock \
                2>/dev/null || true
        fi
      done
    fi
  done
fi

echo "Node version:"
node -v

echo "Chromium path:"
which chromium

echo "Starting application..."

exec xvfb-run -a node src/app.js
