#!/bin/bash
# Double-click to start Treechats on a Mac. It sets up what's missing the first time.
# Close this window (or press Ctrl+C) to stop Treechats.
# Everything is inside main(), which bash reads in full before running, so a git pull that updates this
# file can't disturb the window that's running it.
main() {
cd "$(dirname "$SCRIPT")" || exit 1
# A Terminal window opened from Finder may not have the PATH your shell sets up, so look in the usual places too.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.volta/bin"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

ask() { read -r -p "  $1 [y/N] " a; [[ "$a" =~ ^[Yy] ]]; }
pause_exit() { echo; read -r -n 1 -s -p "  Press any key to close."; exit "${1:-1}"; }

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Treechats needs Node.js, which isn't installed yet."
  if command -v brew >/dev/null 2>&1 && ask "Install Node.js now with Homebrew?"; then
    brew install node
  else
    echo "  Install the LTS version from https://nodejs.org, then double-click start-treechats again."
    open "https://nodejs.org/en/download" 2>/dev/null
    pause_exit 1
  fi
fi
command -v node >/dev/null 2>&1 || { echo "  Node.js still isn't available."; pause_exit 1; }

# Get the latest version from GitHub, if git is installed and nothing here was changed by hand.
if [ -d .git ] && command -v git >/dev/null 2>&1; then
  echo
  echo "  Checking for updates..."
  git pull --ff-only --quiet || echo "  Couldn't update (offline, or files here were changed). Starting the version you have."
fi

echo
echo "  Getting Treechats ready..."
npm install --no-audit --no-fund --loglevel=error || pause_exit 1
[ -f .env ] || cp .env.example .env

# Replies: an API key in .env, or Claude Code signed in with your Claude account
if ! grep -Eq '^ANTHROPIC_API_KEY=.+' .env; then
  if ! command -v claude >/dev/null 2>&1; then
    echo
    echo "  For replies, Treechats needs either an API key in the .env file, or Claude Code"
    echo "  signed in with your Claude account (Pro or Max), which uses your subscription."
    if ask "Install Claude Code now?"; then
      curl -fsSL https://claude.ai/install.sh | bash
    else
      echo "  OK. Add ANTHROPIC_API_KEY to .env any time, then restart Treechats."
    fi
  fi
  if command -v claude >/dev/null 2>&1 && ! claude auth status >/dev/null 2>&1; then
    echo
    echo "  Sign in to Claude Code with your Claude account so Treechats can use your subscription."
    echo "  A browser window will open."
    claude auth login
  fi
fi

npm start
}
SCRIPT="$0"
main "$@"
exit
