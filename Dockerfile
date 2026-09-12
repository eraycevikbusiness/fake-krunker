# FRAGSTORM: Spiel + Mehrspieler-Server in einem Container
#   docker build -t fragstorm .
#   docker run -p 8080:8080 fragstorm
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
ENV PORT=8080 HOST=0.0.0.0 NO_OPEN=1
EXPOSE 8080
CMD ["node", "serve.mjs", "--no-open"]
