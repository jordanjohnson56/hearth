#!/bin/sh
# Run before every push. This repository is public; the data it handles is a
# family's calendar and two children's names and photos. Git history is
# permanent, so a leak here has no remediation.
#
#     ./scripts/privacy-check.sh
#
# NOTE: there is a fourth check that is deliberately NOT in this script.
# Grep the full history for each real family member's first name:
#
#     git log -p --all | grep -in '<real-first-name>'
#
# Run that ad hoc from your shell only. Never commit it and never paste the real
# names into any file in this repo: a committed check that names the family
# defeats its own purpose.

set -e

command -v gitleaks >/dev/null 2>&1 || {
  echo "gitleaks is not installed." >&2
  echo "  sudo pacman -S gitleaks" >&2
  echo "  (or extract the linux_x64 release binary into ~/.local/bin)" >&2
  exit 1
}

fail=0

echo "[1/3] Tracked files that should never be tracked"
# .env.example is the one intentional exception: it is the committed template
# and contains no real values. Excluding it by exact name keeps this check
# quiet, which is the only way it stays worth reading.
tracked=$(
  git ls-files -z \
    | grep -zEi '(^|/)\.env($|\.)|\.(db|db-wal|db-shm|sqlite3?)$|\.ics$|(^|/)(avatars?|photos?|uploads)/' \
    | tr '\0' '\n' \
    | grep -vxF '.env.example' \
    || true
)
if [ -n "$tracked" ]; then
  echo "  FAIL, these are tracked and must not be:"
  echo "$tracked" | sed 's/^/    /'
  fail=1
else
  echo "  ok"
fi

echo "[2/3] Working tree secret scan"
gitleaks dir --config .gitleaks.toml --redact --exit-code 1 . >/dev/null 2>&1 \
  && echo "  ok" || { echo "  FAIL, run: gitleaks dir --config .gitleaks.toml ."; fail=1; }

echo "[3/3] Full history secret scan"
gitleaks git --config .gitleaks.toml --redact --exit-code 1 . >/dev/null 2>&1 \
  && echo "  ok" || { echo "  FAIL, run: gitleaks git --config .gitleaks.toml ."; fail=1; }

if [ "$fail" -ne 0 ]; then
  echo
  echo "Privacy check FAILED. Do not push."
  exit 1
fi

echo
echo "Privacy check passed. Remember the family-name history grep described at the top of this file."
