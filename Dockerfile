# Pantti auctions Finland as a container (deploy/docker.md). Spec 01.
# Plain Node, no npm packages, so the image is small and the same on a Mac and a Raspberry Pi.
FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=Europe/Helsinki PANTTI_LOG_STDOUT=1
WORKDIR /app
COPY --chown=node:node . .
USER node
# data/ (state, reports, log) and .env are mounted from outside: see docker-compose.yml
CMD ["node", "scripts/docker-loop.js"]
