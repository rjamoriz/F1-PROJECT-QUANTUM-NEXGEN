FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ARG REACT_APP_BACKEND_URL=http://localhost:3001
ARG REACT_APP_BACKEND_WS_URL=ws://localhost:3001
ARG REACT_APP_HTTP_TIMEOUT_MS=30000
ARG REACT_APP_AUTH_AUTO_REFRESH=true

ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}
ENV REACT_APP_BACKEND_WS_URL=${REACT_APP_BACKEND_WS_URL}
ENV REACT_APP_HTTP_TIMEOUT_MS=${REACT_APP_HTTP_TIMEOUT_MS}
ENV REACT_APP_AUTH_AUTO_REFRESH=${REACT_APP_AUTH_AUTO_REFRESH}
ENV GENERATE_SOURCEMAP=false
ENV BROWSERSLIST_IGNORE_OLD_DATA=1

RUN npm run build

FROM nginx:1.27-alpine AS runtime

COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
