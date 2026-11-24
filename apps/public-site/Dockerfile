# Build from repository root. This image contains only the public Next.js runtime.
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app/apps/public-site
COPY apps/public-site/package.json apps/public-site/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
FROM dependencies AS build
ARG NEXT_PUBLIC_BOOKING_MODE=online
ARG NEXT_PUBLIC_SHOW_PHONE=1
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_COMPANY_PHONE
ARG NEXT_PUBLIC_COMPANY_EMAIL
ARG NEXT_PUBLIC_COMPANY_ADDRESS
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_BOOKING_MODE=$NEXT_PUBLIC_BOOKING_MODE NEXT_PUBLIC_SHOW_PHONE=$NEXT_PUBLIC_SHOW_PHONE NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_COMPANY_PHONE=$NEXT_PUBLIC_COMPANY_PHONE NEXT_PUBLIC_COMPANY_EMAIL=$NEXT_PUBLIC_COMPANY_EMAIL NEXT_PUBLIC_COMPANY_ADDRESS=$NEXT_PUBLIC_COMPANY_ADDRESS
COPY apps/public-site ./
COPY client-portal/public ./public/client
RUN npm run build
FROM node:24-bookworm-slim AS runtime
ARG NEXT_PUBLIC_BOOKING_MODE=online
ARG NEXT_PUBLIC_SHOW_PHONE=1
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_BOOKING_MODE=$NEXT_PUBLIC_BOOKING_MODE NEXT_PUBLIC_SHOW_PHONE=$NEXT_PUBLIC_SHOW_PHONE NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 WEBSITE_ENV=production WEBSITE_CONTAINER=1 HOST=0.0.0.0 PORT=4173
WORKDIR /app/apps/public-site
COPY --from=build --chown=node:node /app/apps/public-site ./
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.cjs"]
