#!/usr/bin/env bash
# Prepares a fresh agent workspace (a git worktree cut from staging). Run it
# from the worktree root once the workspace tool has copied in the repo root's
# `.env` / `.env.local` (only those two: never `.env.prod` / `.env.staging`).
#
# - Download mongodb-memory-server's binary into the shared home cache (which
#   it probes before node_modules at runtime) instead of into every worktree.
# - Fetch the Chromium build this Playwright version expects (a no-op when the
#   shared ~/Library/Caches/ms-playwright already has it), so E2E runs.
# - With DEV_PORT set, point NextAuth at this workspace's port, so magic links
#   from `npm run dev` come back here instead of to :3000 (.env.local overrides
#   .env).
set -euo pipefail

MONGOMS_DOWNLOAD_DIR="$HOME/.cache/mongodb-binaries" npm ci
npx playwright install chromium

if [ -n "${DEV_PORT:-}" ]; then
  touch .env.local
  grep -v '^NEXTAUTH_URL=' .env.local > .env.local.tmp || true
  echo "NEXTAUTH_URL=http://localhost:$DEV_PORT" >> .env.local.tmp
  mv .env.local.tmp .env.local
fi
