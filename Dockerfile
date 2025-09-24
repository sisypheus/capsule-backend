FROM node:24-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --silent

COPY . .

RUN npm run build

FROM node:24-alpine AS runner

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm ci --omit=dev --no-audit --no-fund --silent

COPY --from=builder /usr/src/app/builder ./builder
COPY --from=builder /usr/src/app/dist ./dist

USER node

EXPOSE 3000

CMD ["node", "dist/src/main.js"]