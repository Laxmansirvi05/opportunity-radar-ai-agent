# Official Playwright image ships Chromium plus every required OS-level
# dependency already installed, which avoids the classic "works locally,
# breaks in Docker" headache with headless Chrome.
FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

COPY package*.json ./

# --ignore-scripts: the base image already has Chromium installed, so the
# postinstall `playwright install` step (needed for local/bare-metal setups)
# would just be redundant network + disk work here.
RUN npm ci --omit=dev --ignore-scripts

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# The base image ships a non-root "pwuser" - run as that instead of root.
USER pwuser

CMD ["node", "src/index.js"]
