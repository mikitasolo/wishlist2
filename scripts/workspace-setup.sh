#!/usr/bin/env bash
# Prepares a fresh agent workspace (a git worktree cut from staging). Run it
# from the worktree root, as the workspace tool's setup script.
#
# - Copy the main checkout's `.env` (only that one: never `.env.prod` /
#   `.env.staging`) without the real Blob store credentials, so local tests
#   can't write to the store (WIS-221).
# - Download mongodb-memory-server's binary into the shared home cache (which
#   it probes before node_modules at runtime) instead of into every worktree.
# - Fetch the Chromium build this Playwright version expects (a no-op when the
#   shared ~/Library/Caches/ms-playwright already has it), so E2E runs.
# - Point NextAuth at this workspace's dev port (scripts/dev-port.mjs), so magic
#   links from `npm run dev` come back here instead of to :3000 (.env.local
#   overrides .env).
set -euo pipefail

ROOT="$(git worktree list --porcelain | head -1 | cut -d' ' -f2-)"
if [ ! -f .env ] && [ -f "$ROOT/.env" ]; then
  grep -v -E '^(VERCEL_OIDC_TOKEN|BLOB_STORE_ID)=' "$ROOT/.env" > .env || true
fi

MONGOMS_DOWNLOAD_DIR="$HOME/.cache/mongodb-binaries" npm ci
npx playwright install chromium

touch .env.local
grep -v '^NEXTAUTH_URL=' .env.local > .env.local.tmp || true
echo "NEXTAUTH_URL=http://localhost:$(node scripts/dev-port.mjs)" >> .env.local.tmp
mv .env.local.tmp .env.local

node scripts/dev-port.mjs --check || true
