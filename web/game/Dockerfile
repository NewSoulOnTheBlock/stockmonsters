# Stockmonsters — browser-playable build
#
# PSDK/LiteRGSS has no HTML5 export, but it DOES ship native Linux binaries
# (ruby-dist/bin/ruby + LiteRGSS.so, SFML-based). So we run the real game
# natively in this container and stream it to the browser over WebRTC via neko.
#
# Build from the REPO ROOT:
#   docker build -f web/game/Dockerfile -t stockmonsters-web .

# ---------------------------------------------------------------------------
# Stage 1 — pull the Linux PSDK runtime out of the Pokémon Studio .deb
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS psdk

# Must match "studioVersion" in Stockmonsters/project.studio
ARG STUDIO_VERSION=2.10.0
ARG STUDIO_DEB=https://github.com/PokemonWorkshop/PokemonStudio/releases/download/v${STUDIO_VERSION}/pokemon-studio_${STUDIO_VERSION}_amd64.deb

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl binutils zstd; \
    curl -fsSL -o /tmp/studio.deb "${STUDIO_DEB}"; \
    mkdir -p /tmp/x; cd /tmp/x; \
    ar x /tmp/studio.deb data.tar.zst; \
    mkdir -p /opt/psdk; \
    zstd -d -c data.tar.zst \
      | tar -xf - -C /opt/psdk --strip-components=6 \
            ./usr/lib/pokemon-studio/resources/psdk-binaries; \
    # the game supplies its own Game.rb; drop Studio's launcher copy
    rm -f /opt/psdk/Game.rb; \
    # editor-only tooling is dead weight (and a foothold) in production
    rm -rf /opt/psdk/pokemonsdk/docs /opt/psdk/pokemonsdk/.git; \
    test -x /opt/psdk/ruby-dist/bin/ruby; \
    test -f /opt/psdk/ruby-dist/lib/LiteRGSS.so

# ---------------------------------------------------------------------------
# Stage 2 — neko (X + PulseAudio + WebRTC gateway) + the game
# ---------------------------------------------------------------------------
FROM ghcr.io/m1k1o/neko/base:latest

USER root

# SFML/LiteRGSS needs X11, an OpenGL stack (llvmpipe — no GPU on the box) and
# audio. openbox is here purely to give the game window focus; it is locked
# down in openbox.xml so players cannot escape to a desktop.
# The neko base (Debian 13) already ships libgl1, mesa-dri, the X client libs,
# libopenal1, libsndfile1 and friends; these are the ones it lacks.
# x11-utils provides xdpyinfo, which launch-game uses to wait for the display.
# libyaml/libsodium are dlopened by PSDK's bundled psych.so and never resolve
# without them, which aborts the game during extension loading.
# NOTE: PSDK also bundles libs wanting libvpx.so.7 (Debian 13 has 9). That path
# is only reached by SFEMovie video playback, which this game does not use.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        openbox \
        libglu1-mesa \
        x11-utils \
        libyaml-0-2 \
        libsodium23; \
    apt-get clean -y; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/*

# --- PSDK runtime -----------------------------------------------------------
COPY --from=psdk /opt/psdk /opt/psdk

ENV PSDK_BINARY_PATH=/opt/psdk/ \
    LD_LIBRARY_PATH=/opt/psdk/ruby-dist/lib \
    LIBGL_ALWAYS_SOFTWARE=1 \
    GALLIUM_DRIVER=llvmpipe \
    MESA_GL_VERSION_OVERRIDE=3.3

# PSDK's Ruby is NOT relocatable: it was built with RVM on the packager's
# machine and has that prefix compiled in, so it looks for its own stdlib
# (including enc/encdb.so, without which you get "uninitialized constant
# Encoding::UTF_8") under this exact path. Point it at where we unpacked it.
RUN set -eux; \
    prefix="$(/opt/psdk/ruby-dist/bin/ruby --disable=gems,rubyopt,did_you_mean \
                -e 'puts $LOAD_PATH.first[%r{\A.*(?=/lib/ruby/)}]')"; \
    echo "PSDK ruby baked-in prefix: ${prefix}"; \
    mkdir -p "$(dirname "${prefix}")"; \
    ln -sfn /opt/psdk/ruby-dist "${prefix}"; \
    /opt/psdk/ruby-dist/bin/ruby --disable=gems,rubyopt,did_you_mean \
        -e 'raise "encodings still broken" unless Encoding::UTF_8'

# Route OpenAL through PulseAudio so neko can capture the game's audio.
RUN mkdir -p /etc/openal && printf '[general]\ndrivers = pulse,alsa\n' > /etc/openal/alsoft.conf

# --- Game -------------------------------------------------------------------
# Build context is the repo root; see .dockerignore for what is stripped.
COPY Stockmonsters /opt/game

# Rendering scale: game is natively 320x240. scale=3 -> a 960x720 window, which
# is an exact integer upscale (crisp pixels) and cheap to encode.
ENV GAME_SCALE=3 \
    GAME_LANG=en

COPY web/game/launch-game.sh /usr/local/bin/launch-game
COPY web/game/openbox.xml    /etc/neko/openbox.xml
COPY web/game/supervisord.conf /etc/neko/supervisord/stockmonsters.conf

# --- on-screen controls for phones ------------------------------------------
# The game is keyboard-only and neko's mobile fallback just opens the OS soft
# keyboard, so touch players have nothing to press. This script adds a D-pad
# and face buttons. It is injected into neko's own page (not an iframe) so it
# can call window.$client directly.
COPY web/game/touch-controls.js /var/www/touch-controls.js
RUN set -eux; \
    test -f /var/www/index.html; \
    grep -q 'touch-controls.js' /var/www/index.html \
      || sed -i 's#</body>#<script src="touch-controls.js"></script></body>#' /var/www/index.html; \
    grep -q 'touch-controls.js' /var/www/index.html; \
    sed -i 's#<title>n.eko</title>#<title>Stockmonsters</title>#' /var/www/index.html; \
    # let the page use the full screen on notched phones
    sed -i 's#\(<meta name="viewport" content="[^"]*\)"#\1,viewport-fit=cover"#' /var/www/index.html

# PSDK draws its own mouse cursor sprite inside the game window. That makes
# sense on a desktop; on a shared stream it is a pointer nobody controls,
# sitting in the middle of everyone's screen. Configs are read from the JSON
# (see PSDK's `register(:devices, 'devices_config', :json, ...)`), so this is
# all it takes — and it stays a streaming concern rather than editing the game.
RUN set -eux; \
    f=/opt/game/Data/configs/devices_config.json; \
    sed -i 's/"isMouseDisabled": *false/"isMouseDisabled": true/' "$f"; \
    grep -q '"isMouseDisabled": true' "$f"

# The game writes .gameopts and Saves/ into its own directory.
RUN set -eux; \
    chmod +x /usr/local/bin/launch-game; \
    mkdir -p /opt/game/Saves; \
    chown -R neko:neko /opt/game

# NOTE: no `USER neko` here on purpose — neko's supervisord must start as root
# and drops privileges to $USER itself (see supervisord.conf `user=`).
