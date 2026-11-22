# STOPee — imagen de producción para Google Cloud Run.
# Construcción en dos etapas: la primera compila el sitio (necesita las
# dependencias de desarrollo); la final solo lleva lo necesario para correrlo.

FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-slim AS runtime
ENV NODE_ENV=production
# Cloud Run inyecta PORT (8080 por defecto); server.js ya lo lee.
ENV PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/build ./build
COPY server.js ./
# Permisos de lectura y ejecución para todos los usuarios, sea cual sea el modo
# que tengan los archivos en la computadora donde se construye la imagen.
RUN chmod -R 755 /app && chown -R node:node /app
# Nunca como root dentro del contenedor.
USER node
EXPOSE 8080
CMD ["node", "server.js"]
