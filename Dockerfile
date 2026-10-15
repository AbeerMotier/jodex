# syntax=docker/dockerfile:1.7
# =====================================================================
# جُودِكس — صورة الإنتاج (Next.js standalone + Chromium لتقارير PDF)
#   docker build -t jodex .
#   docker run --env-file .env.production -p 3000:3000 jodex
# الأسرار تُمرَّر وقت التشغيل فقط (لا شيء منها في الصورة).
# =====================================================================
ARG NODE_VERSION=22.20.0

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Asia/Riyadh \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium
# Chromium (توليد PDF) + خطوط احتياطية؛ خط IBM Plex Sans Arabic مضمّن من public/fonts
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-noto-core ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 jodex \
 && useradd --system --uid 1001 --gid jodex --home /app jodex
COPY --from=build --chown=jodex:jodex /app/.next/standalone ./
COPY --from=build --chown=jodex:jodex /app/.next/static ./.next/static
COPY --from=build --chown=jodex:jodex /app/public ./public
USER jodex
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
