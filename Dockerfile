FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY scripts/ ./scripts/
COPY web/ ./web/
COPY assets/ ./assets/

ENV HOST=0.0.0.0 PORT=8080
EXPOSE 8080

USER node
CMD ["node", "scripts/serve.mjs"]
