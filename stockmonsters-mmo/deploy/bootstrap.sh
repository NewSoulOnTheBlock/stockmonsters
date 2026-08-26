#!/usr/bin/env bash
#
# Bring a fresh Ubuntu box up to running Stockmonsters. Run it as root, on the
# box, as many times as you like — it is written to be re-run.
#
#   ssh root@your-box
#   curl -fsSL https://raw.githubusercontent.com/NewSoulOnTheBlock/stockmonsters/mmo/stockmonsters-mmo/deploy/bootstrap.sh | bash
#
# or, if the checkout is already there:
#
#   /opt/stockmonsters-mmo/deploy/bootstrap.sh
#
# ## It stops halfway the first time, on purpose
#
# There is no way to guess SERVER_SECRET or three signing keys, and inventing
# them would be worse than stopping: SERVER_SECRET is the HMAC behind every
# player's save id, so regenerating it silently orphans every existing player.
# So the first run writes a .env and stops, and you fill it in and run again.
#
# ## What it will not do
#
# It never prints a secret, never writes one to a log, and never puts one on a
# command line. It validates the SHAPE of each key and reports pass or fail.
set -euo pipefail

REPO="${REPO:-https://github.com/NewSoulOnTheBlock/stockmonsters.git}"
BRANCH="${BRANCH:-mmo}"
DIR="${DIR:-/opt/stockmonsters-mmo}"
APP_USER="${APP_USER:-stockmonsters}"
NODE_MAJOR=24

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ok()  { printf '    \033[32mok\033[0m  %s\n' "$*"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run this as root"

# --------------------------------------------------------------- packages ---
say "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates git rsync ufw ${EXTRA_PKGS:-} >/dev/null
ok "base tools"

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
ok "docker $(docker --version | awk '{print $3}' | tr -d ,)"

# Node has to be new enough for `--env-file-if-exists`, which arrived in
# 20.6. Pinning the major keeps a surprise apt upgrade from moving it.
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node -v)"

if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
ok "caddy $(caddy version | head -1)"

# --------------------------------------------------------------- firewall ---
say "firewall"
# SSH FIRST, ALWAYS. `ufw --force enable` on a box with no SSH rule locks you
# out of your own machine with no way back in.
ufw allow OpenSSH >/dev/null
ufw allow 80,443/tcp >/dev/null
# Postgres and Redis are deliberately NOT opened. They are bound to loopback in
# docker-compose.yml, which matters more than this rule does: Docker's iptables
# rules are evaluated before ufw's, so a container published on 0.0.0.0 is
# reachable from the internet whatever ufw has been told.
ufw --force enable >/dev/null
ok "22, 80, 443 open; everything else closed"

# ------------------------------------------------------------------- user ---
say "service user"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/var/lib/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
fi
# The build and the migrations run as this user too, so it needs docker.
usermod -aG docker "$APP_USER"
ok "$APP_USER"

# ------------------------------------------------------------------- code ---
say "code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  # Hard reset is safe here BECAUSE .env and data/ are gitignored and survive
  # it. Anything else edited in place on the box is meant to be lost — the box
  # is not where this is developed.
  git -C "$DIR" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
  git -C "$DIR" reset --hard --quiet "origin/$BRANCH"
else
  # A different directory from the old streaming app's /opt/stockmonsters, on
  # purpose: sync.sh untars without deleting, so two apps sharing a directory
  # would silently blend into each other.
  git clone --quiet --branch "$BRANCH" "$REPO" "$DIR"
fi
APP="$DIR/stockmonsters-mmo"
[ -d "$APP" ] || die "$APP is missing — is the branch right? (BRANCH=$BRANCH)"
ok "$(git -C "$DIR" log --oneline -1)"

# ------------------------------------------------------------------- .env ---
say "configuration"
if [ ! -f "$APP/.env" ]; then
  cp "$APP/.env.example" "$APP/.env"
  chmod 600 "$APP/.env"
  chown "$APP_USER:$APP_USER" "$APP/.env"
  cat <<EOF

  A .env has been written to $APP/.env and nothing has been started.

  Fill it in — every value, by hand:

    nano $APP/.env

  The ones with no sane default, and what happens if you get them wrong:

    SERVER_SECRET       the HMAC that IS every player's save id. Generate ONCE
                        with \`openssl rand -hex 32\` and never change it: a new
                        one turns every existing player into a stranger.
    POSTGRES_PASSWORD   change it from the default before anything starts.
    DATABASE_URL        must match the postgres settings above it.
    BOX_SIGNER_PK       three separate keys, on purpose. One leak should not
    REWARDS_SIGNER_PK   be all three.
    BATTLE_SIGNER_PK
    SM_RPC_URL          and BOX_RPC_URL. Without the second, the mint indexer
    BOX_RPC_URL         never runs and no box ever learns its token id.
    BOX_FROM_BLOCK      the NFT's deployment block. Left at 0, every sync asks
    MARKET_FROM_BLOCK   the RPC for the whole chain and is refused.
    SM_DOMAIN           the domain pointing at this box (also set below).

  PINATA_JWT is NOT needed here — only tools/ipfs.mjs reads it, and that runs
  on your own machine. Leave it out of the box entirely.

  Then run this script again.

EOF
  exit 0
fi
chmod 600 "$APP/.env"
chown "$APP_USER:$APP_USER" "$APP/.env"

# Validate by SHAPE. Never echo a value.
missing=0
need() {
  local key="$1" pattern="${2:-.+}" desc="${3:-}"
  local val
  val="$(grep -E "^$key=" "$APP/.env" | head -1 | cut -d= -f2- || true)"
  if [ -z "$val" ] || [[ "$val" == change-me* ]]; then
    printf '    \033[31mmissing\033[0m  %s %s\n' "$key" "$desc"; missing=1; return
  fi
  if ! [[ "$val" =~ $pattern ]]; then
    printf '    \033[31mmalformed\033[0m  %s %s\n' "$key" "$desc"; missing=1; return
  fi
  ok "$key"
}
KEY='^(0x)?[0-9a-fA-F]{64}$'
ADDR='^0x[0-9a-fA-F]{40}$'
need SERVER_SECRET      '^.{32,}$'  '(needs >=32 chars; openssl rand -hex 32)'
need DATABASE_URL       '^postgres'
need POSTGRES_PASSWORD  '^.{8,}$'
need BOX_SIGNER_PK      "$KEY"
need REWARDS_SIGNER_PK  "$KEY"
need BATTLE_SIGNER_PK   "$KEY"
need BOX_NFT_ADDRESS    "$ADDR"
need SM_RPC_URL         '^https?://'
need BOX_RPC_URL        '^https?://' '(without it the mint indexer never runs)'
need BOX_FROM_BLOCK     '^[0-9]+$'
need SM_CHAIN_ID        '^[0-9]+$'
need BOX_CHAIN_ID       '^[0-9]+$'
[ "$missing" = 0 ] || die "fix $APP/.env and run this again"

# The client is switched to SM_CHAIN_ID, so a voucher signed for BOX_CHAIN_ID
# would be signed for a chain nobody is on — and it fails with a signature
# error that blames the signature.
sm_chain="$(grep -E '^SM_CHAIN_ID=' "$APP/.env" | cut -d= -f2-)"
box_chain="$(grep -E '^BOX_CHAIN_ID=' "$APP/.env" | cut -d= -f2-)"
[ "$sm_chain" = "$box_chain" ] || die "SM_CHAIN_ID ($sm_chain) and BOX_CHAIN_ID ($box_chain) must match"
ok "both halves sign for chain $sm_chain"

DOMAIN="$(grep -E '^SM_DOMAIN=' "$APP/.env" | cut -d= -f2- || true)"
[ -n "$DOMAIN" ] || die "set SM_DOMAIN in $APP/.env to the domain pointing at this box"

chown -R "$APP_USER:$APP_USER" "$DIR"

# ------------------------------------------------------- database + build ---
say "database"
cd "$APP"
docker compose up -d >/dev/null
for i in $(seq 1 40); do
  docker compose ps --format json 2>/dev/null | grep -q '"Health":"healthy"' && break
  sleep 2
done
docker compose ps --format '    {{.Service}}  {{.Status}}'

say "dependencies"
# NOT --omit=dev: vite is a devDependency and build:mmo needs it. sharp is
# native and per-platform, which is why this happens here and never gets
# shipped from a laptop.
sudo -u "$APP_USER" npm ci --silent
ok "node_modules"

say "migrations"
sudo -u "$APP_USER" npm run --silent db:migrate

say "build"
# build:mmo, NOT build. Plain `npm run build` is the standalone build and it
# WIPES dist/client, which is the directory server.mjs serves.
sudo -u "$APP_USER" npm run --silent build:mmo
[ -f "$APP/dist/client/index.html" ] || die "the build produced no dist/client — wrong build script?"
[ -f "$APP/dist/server/server.js" ] || die "the build produced no dist/server"
ok "dist/client $(du -sh "$APP/dist/client" | cut -f1)"

mkdir -p "$APP/data"
chown -R "$APP_USER:$APP_USER" "$APP/data"

# ---------------------------------------------------------------- service ---
say "service"
install -m 644 "$APP/deploy/stockmonsters-mmo.service" /etc/systemd/system/
sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$APP|" /etc/systemd/system/stockmonsters-mmo.service
sed -i "s|^ReadWritePaths=.*|ReadWritePaths=$APP/data|" /etc/systemd/system/stockmonsters-mmo.service
systemctl daemon-reload
systemctl enable --now stockmonsters-mmo >/dev/null
sleep 3
systemctl is-active --quiet stockmonsters-mmo \
  || die "the service did not start — journalctl -u stockmonsters-mmo -n 50"
ok "stockmonsters-mmo running"

# ------------------------------------------------------------------ caddy ---
say "caddy"
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
install -m 644 "$APP/deploy/Caddyfile" /etc/caddy/Caddyfile
# The domain is the one thing Caddy needs that is not in the file.
mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=SM_DOMAIN=%s\n' "$DOMAIN" \
  > /etc/systemd/system/caddy.service.d/domain.conf
systemctl daemon-reload
systemctl reload-or-restart caddy
ok "proxying $DOMAIN -> localhost:3000"

# ----------------------------------------------------------------- verify ---
say "checking it actually works"
health=""
for i in $(seq 1 20); do
  health="$(curl -fsS http://localhost:3000/health 2>/dev/null || true)"
  [ -n "$health" ] && break
  sleep 2
done
[ -n "$health" ] || die "the server never answered /health"
echo "$health" | head -c 400; echo
node -e '
  const h = JSON.parse(process.argv[1]);
  const p = h.profiles ?? {};
  if (!p.enabled)  { console.error("\n!! Postgres is not connected — players will not persist"); process.exit(1) }
  if (!p.healthy)  { console.error("\n!! Postgres is configured but unhealthy"); process.exit(1) }
' "$health"
ok "the database is connected and healthy"

chain="$(curl -fsS http://localhost:3000/token/chain)"
echo "    chain: $chain"

cat <<EOF

  Stockmonsters is up.

    https://$DOMAIN

    systemctl status stockmonsters-mmo
    journalctl -u stockmonsters-mmo -f

  To ship new code:  ./deploy/sync.sh root@this-box

EOF
