#!/usr/bin/env bash
#
# Brings a fresh Ubuntu box up as the Stockmonsters game server.
#
#   ssh root@<host> 'bash -s' < web/deploy/bootstrap.sh
#
# Idempotent: safe to run again after a change. It never overwrites an existing
# web/.env, and it stops rather than starting with a half-filled one.

set -euo pipefail

REPO="${REPO:-https://github.com/NewSoulOnTheBlock/stockmonsters.git}"
DIR="${DIR:-/opt/stockmonsters}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# ── architecture ────────────────────────────────────────────────────────────
# PSDK ships x86_64 Linux binaries only. On arm64 the image builds fine and
# then the game cannot start, which is a confusing way to find out.
arch="$(uname -m)"
if [ "$arch" != "x86_64" ]; then
  say "this box is $arch, but PSDK only ships x86_64 Linux binaries"
  echo "the game will not run here. use an x86_64 server."
  exit 1
fi

# ── docker ──────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  say "installing docker"
  curl -fsSL https://get.docker.com | sh
else
  say "docker already present"
fi

# ── firewall ────────────────────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1; then
  say "firewall"
  # SSH is allowed before anything is enabled. Enabling ufw without this on a
  # remote box locks you out permanently, over the connection you just cut.
  ufw allow OpenSSH >/dev/null
  ufw allow 80,443/tcp >/dev/null
  # WebRTC media goes straight to the container over UDP — it does NOT pass
  # through Caddy. Close this range and players get a spinner that never
  # connects, with nothing in any log to explain it.
  ufw allow 52000:52100/udp >/dev/null
  ufw --force enable >/dev/null
  ufw status | head -8
fi

# ── code ────────────────────────────────────────────────────────────────────
if [ -d "$DIR/.git" ]; then
  say "updating $DIR"
  git -C "$DIR" fetch --quiet origin
  git -C "$DIR" reset --hard origin/master --quiet
else
  say "cloning into $DIR (the repo carries ~330 MB of game assets)"
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet "$REPO" "$DIR"
fi
cd "$DIR"
echo "at $(git rev-parse --short HEAD)"

# ── config ──────────────────────────────────────────────────────────────────
if [ ! -f web/.env ]; then
  cp web/.env.example web/.env
  chmod 600 web/.env
  # PUBLIC_IP is the one value that is always knowable from here, and getting
  # it wrong is the single most common reason WebRTC never connects.
  ip="$(curl -s --max-time 10 ifconfig.me || true)"
  if [ -n "$ip" ]; then
    sed -i "s#^PUBLIC_IP=.*#PUBLIC_IP=${ip}#" web/.env
    echo "PUBLIC_IP detected as ${ip}"
  fi
  say "web/.env created — set ADMIN_PASSWORD, then run this again"
  cat <<'MSG'

  Required before the stack will start:

    ADMIN_PASSWORD    keep this secret; it can take control and kick players

  Optional:

    PLAYER_PASSWORD   what players type (or get prefilled via the share link)
    GAME_DOMAIN       a domain pointing at this box, for HTTPS via Caddy

    nano /opt/stockmonsters/web/.env

MSG
  exit 0
fi
chmod 600 web/.env

unset_key() {
  value="$(grep -E "^$1=" web/.env | head -1 | cut -d= -f2-)"
  case "$value" in ''|change-me*) return 0 ;; *) return 1 ;; esac
}

missing=""
for key in PUBLIC_IP ADMIN_PASSWORD; do
  unset_key "$key" && missing="$missing $key"
done
if [ -n "$missing" ]; then
  say "web/.env is incomplete:$missing"
  echo "fill those in and run this again."
  exit 1
fi

# Caddy only makes sense once a domain resolves here; without one we serve
# plain http on 8080 and skip TLS entirely rather than fail to get a cert.
profile=""
if ! unset_key GAME_DOMAIN; then
  profile="--profile tls"
  echo "GAME_DOMAIN set — Caddy will terminate TLS"
else
  say "no GAME_DOMAIN: serving plain http on :8080"
  echo "  fine for testing. browsers restrict WebRTC on plain http, so set a"
  echo "  domain before sharing the link publicly."
fi

# ── up ──────────────────────────────────────────────────────────────────────
say "building and starting (first build pulls the PSDK runtime, a few minutes)"
# shellcheck disable=SC2086
docker compose -f web/docker-compose.yml $profile up -d --build

say "status"
docker compose -f web/docker-compose.yml ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'

say "waiting for the game to boot"
for _ in $(seq 1 40); do
  if docker compose -f web/docker-compose.yml exec -T stockmonsters \
       grep -qa "Time to boot game" /var/log/neko/stockmonsters.log 2>/dev/null; then
    docker compose -f web/docker-compose.yml exec -T stockmonsters \
      grep -a "Time to boot game" /var/log/neko/stockmonsters.log | tail -1
    break
  fi
  sleep 3
done

domain="$(grep -E '^GAME_DOMAIN=' web/.env | cut -d= -f2-)"
player="$(grep -E '^PLAYER_PASSWORD=' web/.env | cut -d= -f2-)"
public="$(grep -E '^PUBLIC_IP=' web/.env | cut -d= -f2-)"
base="http://${public}:8080"
[ -n "$domain" ] && base="https://${domain}"

cat <<MSG

  play:
    ${base}/?usr=player&pwd=${player}&embed=1

  logs:
    docker compose -f web/docker-compose.yml logs -f
    docker exec stockmonsters tail -f /var/log/neko/stockmonsters.log

  measure what one session costs, while someone is actually playing:
    web/scripts/measure.sh 120

MSG
