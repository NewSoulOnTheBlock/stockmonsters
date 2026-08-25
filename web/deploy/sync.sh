#!/usr/bin/env bash
#
# Ships local changes straight to the box over SSH and redeploys.
#
#   web/deploy/sync.sh root@<host>          # just web/ — the fast path
#   web/deploy/sync.sh root@<host> --all    # the whole tree, game assets too
#
# The normal path is web/deploy/bootstrap.sh, which pulls from GitHub. This one
# exists for iterating without a push, or when the box cannot reach the repo.
#
# By default it sends ONLY web/, because the repo carries ~330 MB of game
# assets and pushing those up a home connection on every config tweak is
# unbearable. Use --all when the game itself changed. Either way it sends what
# is committed, so uncommitted work is deliberately not deployed.

set -euo pipefail

TARGET="${1:?usage: web/deploy/sync.sh root@host [--all]}"
SCOPE="${2:-web}"
DIR="${DIR:-/opt/stockmonsters}"

cd "$(git rev-parse --show-toplevel)"

dirty="$(git status --porcelain | wc -l | tr -d ' ')"
[ "$dirty" != "0" ] && echo "note: $dirty uncommitted change(s) will NOT be deployed" >&2

if [ "$SCOPE" = "--all" ]; then
  echo "==> shipping ALL of $(git rev-parse --short HEAD) to $TARGET:$DIR"
  paths=""
else
  echo "==> shipping web/ at $(git rev-parse --short HEAD) to $TARGET:$DIR"
  # The game must already be on the box; bootstrap.sh put it there.
  ssh "$TARGET" "test -d '$DIR/Stockmonsters'" || {
    echo "no game at $DIR/Stockmonsters — run bootstrap.sh first, or use --all" >&2
    exit 1
  }
  paths="web"
fi

# shellcheck disable=SC2086
git archive --format=tar HEAD $paths | ssh "$TARGET" "mkdir -p '$DIR' && tar -x -C '$DIR'"

echo "==> building"
# --force-recreate because compose does not always notice that the contents of
# an env_file changed: it compares its own config hash, so a container can keep
# running with the values it started with while web/.env says something else.
ssh "$TARGET" "cd '$DIR' && docker compose -f web/docker-compose.yml up -d --build --force-recreate"

echo "==> status"
ssh "$TARGET" "cd '$DIR' && docker compose -f web/docker-compose.yml ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'"
