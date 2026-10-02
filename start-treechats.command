#!/bin/bash
# Double-click to start Treechats on a Mac. Close this window (or press Ctrl+C) to stop it.
cd "$(dirname "$0")" || exit 1
# A Terminal window opened from Finder may not have the PATH your shell sets up, so look in the usual places too.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.volta/bin"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Treechats needs Node.js. Install the LTS version from https://nodejs.org (or: brew install node), then try again."
  echo
  read -r -n 1 -s -p "  Press any key to close."
  exit 1
fi
npm install --no-audit --no-fund --loglevel=error || { read -r -n 1 -s -p "Press any key to close."; exit 1; }
npm start
