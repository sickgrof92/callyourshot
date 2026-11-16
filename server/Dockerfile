FROM node:22-slim
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production DB_PATH=/data/callyourshot.db
# Mount a persistent volume at /data: it holds the SQLite database.
VOLUME /data
EXPOSE 8080
CMD ["npm", "start"]
