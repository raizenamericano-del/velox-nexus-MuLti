# syntax=docker/dockerfile:1
# ==========================================================================
# VELOX NEXUS — Railway-ready image
#
# Everything the engine needs (yt-dlp + ffmpeg) is baked in at build time, so
# the first request after a deploy never waits for a download. `pip install -U
# yt-dlp` on every build keeps extraction current with platform changes.
#
# LAYER ORDER: package.json has a postinstall hook that runs
# scripts/ensure-ytdlp.js, so scripts/ must be present before `npm ci`. The
# install itself passes --ignore-scripts (yt-dlp comes from pip here) so no
# dependency install script ever runs during the build.
# ==========================================================================

FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PORT=8000

# ffmpeg      → merge video+audio, MP3 conversion
# python3/pip → yt-dlp runtime
# unzip       → required by the Deno installer
# ca-certificates + curl → engine update & health probes
# tini        → reaps zombie yt-dlp/ffmpeg processes
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg ca-certificates curl unzip tini \
 && rm -rf /var/lib/apt/lists/*

# Latest yt-dlp on every build. --break-system-packages is required on
# Debian bookworm+; the fallback keeps older base images working.
RUN python3 -m pip install --no-cache-dir --break-system-packages -U yt-dlp \
 || python3 -m pip install --no-cache-dir -U yt-dlp

# Optional: yt-dlp uses a JS runtime for some YouTube formats. Non-fatal —
# extraction still works without it, just with fewer variants.
RUN (curl -fsSL https://deno.land/install.sh | sh -s -- -y \
     && ln -sf /root/.deno/bin/deno /usr/local/bin/deno \
     && deno --version) \
 || echo "[build] deno unavailable, continuing without it"

WORKDIR /app

COPY package*.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev --ignore-scripts \
 || npm install --omit=dev --ignore-scripts

COPY server ./server
COPY public ./public

# Drop privileges: the app only reads /app and writes to TMPDIR.
RUN useradd -m -u 1001 nexus \
 && mkdir -p /app/.tmp /app/vendor \
 && chown -R nexus:nexus /app
USER nexus

ENV TMPDIR=/app/.tmp \
    YTDLP_AUTO_INSTALL=true \
    YTDLP_AUTO_UPDATE=true

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
