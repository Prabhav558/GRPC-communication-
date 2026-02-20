FROM node:20-slim AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . ./
RUN npx next build

FROM node:20-slim

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/grpc-server.js ./
COPY --from=builder /app/data-store.js ./
COPY --from=builder /app/start.js ./
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/app ./app
COPY certs/ /app/certs/
COPY proto/ /app/proto/

ENV NODE_ENV=production

EXPOSE 3000 3005

CMD ["node", "start.js"]
