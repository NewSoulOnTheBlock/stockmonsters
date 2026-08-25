#!/usr/bin/env bash
# Launches the PSDK game inside neko's virtual X display.
set -euo pipefail

GAME_DIR="${GAME_DIR:-/opt/game}"
GAME_SCALE="${GAME_SCALE:-3}"
GAME_LANG="${GAME_LANG:-en}"
RUBY="/opt/psdk/ruby-dist/bin/ruby"

cd "$GAME_DIR"

# Wait for the X server; supervisord starts us in parallel with it.
for _ in $(seq 1 60); do
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
  sleep 0.5
done

# PSDK persists options into .gameopts and re-reads them on boot. Rewrite it
# every start so a container always comes up with the settings we intend,
# regardless of what a previous session left behind.
printf -- '--scale=%s\n--lang=%s\n' "$GAME_SCALE" "$GAME_LANG" > .gameopts

# A crashed session must not leave a half-written save behind for the next
# player when the container is reused.
if [ "${GAME_WIPE_SAVES:-1}" = "1" ]; then
  rm -f "$GAME_DIR"/Saves/* 2>/dev/null || true
fi

exec "$RUBY" --disable=gems,rubyopt,did_you_mean Game.rb \
  "--scale=${GAME_SCALE}" "--lang=${GAME_LANG}"
