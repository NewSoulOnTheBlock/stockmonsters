#!/usr/bin/env bash
#
# Ship the current commit to a box that bootstrap.sh has already prepared.
#
#   ./deploy/sync.sh root@66.179.31.212
#   ./deploy/sync.sh root@66.179.31.212 --no-build   # config-only change
#
# Run it from anywhere in the repo.
#
# ## Why git archive and not rsync
#
# It ships exactly what is COMMITTED. A deploy that quietly carries whatever
# happened to be in your working tree is a deploy you cannot reproduce or roll
# back — and this repo's working tree routinely holds half-finished agent work
# and a .env full of private keys.
#
# ## What it deliberately does not touch
#
# .env and data/ are never sent. The box's configuration belongs to the box.
set -euo pipefail

TARGET="${1:-}"
[ -n "$TARGET" ] || { echo "usage: $0 user@host [--no-build]" >&2; exit 1; }
shift || true
BUILD=1
for arg in "$@"; do [ "$arg" = "--no-build" ] && BUILD=0; done

DIR="${DIR:-/opt/stockmonsters-mmo}"
APP="$DIR/stockmonsters-mmo"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

dirty="$(git status --porcelain -- stockmonsters-mmo | wc -l | tr -d ' ')"
if [ "$dirty" != 0 ]; then
  echo "  note: $dirty uncommitted change(s) under stockmonsters-mmo will NOT be shipped."
  git status --short -- stockmonsters-mmo | head -10
fi

say "shipping $(git log --oneline -1)"
# --delete is not possible with tar, so files removed from the repo linger on
# the box. Harmless for source (nothing imports them) but it does mean a
# renamed asset leaves its old copy behind; bootstrap.sh's hard reset is the
# way to get a genuinely clean tree.
git archive --format=tar HEAD stockmonsters-mmo \
  | ssh "$TARGET" "mkdir -p '$DIR' && tar -x -C '$DIR' && chown -R stockmonsters:stockmonsters '$DIR'"

say "installing and building on the box"
ssh "$TARGET" "set -e
  cd '$APP'
  # npm ci only when the lockfile actually moved: it is the slowest step by far
  # and sharp has to compile.
  if ! sudo -u stockmonsters npm ls --silent >/dev/null 2>&1; then
    echo '    dependencies changed — npm ci'
    sudo -u stockmonsters npm ci --silent
  else
    echo '    dependencies unchanged'
  fi
  sudo -u stockmonsters npm run --silent db:migrate
  if [ '$BUILD' = 1 ]; then
    sudo -u stockmonsters npm run --silent build:mmo
    test -f dist/client/index.html || { echo 'the build produced no dist/client'; exit 1; }
  fi
"

say "restarting"
# A restart, not a reload: server.mjs flushes its batched writes on SIGTERM and
# the unit gives it 20s to do so.
ssh "$TARGET" "systemctl restart stockmonsters-mmo"

say "checking it came back"
for i in $(seq 1 20); do
  health="$(ssh "$TARGET" "curl -fsS http://localhost:3000/health 2>/dev/null" || true)"
  [ -n "$health" ] && break
  sleep 2
done
[ -n "$health" ] || die "the server never answered /health — journalctl -u stockmonsters-mmo -n 50"
echo "$health" | head -c 300; echo

# A server that boots without its database looks fine and loses every player's
# progress, so this is checked rather than assumed.
node -e '
  const h = JSON.parse(process.argv[1]);
  const p = h.profiles ?? {};
  if (!p.enabled || !p.healthy) {
    console.error("\n!! Postgres is not healthy — players will not persist");
    process.exit(1);
  }
' "$health"

printf '\n\033[32mdeployed\033[0m  %s\n\n' "$(git log --oneline -1)"
