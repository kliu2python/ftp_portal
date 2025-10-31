# syntax=docker/dockerfile:1
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production && npm cache clean --force

COPY public ./public
COPY server.js ./
COPY utils ./utils

ENV NODE_ENV=production
ENV PORT=3080

EXPOSE 3080

CMD ["npm", "start"]
