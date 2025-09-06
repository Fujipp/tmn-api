# Playwright image with Chromium + fonts + deps
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["npm","start"]
