# Build stage
FROM node:20-alpine AS builder

# Accept the API key as a build argument — never baked into source control
ARG VITE_KCL_API_KEY
ENV VITE_KCL_API_KEY=$VITE_KCL_API_KEY

ARG VITE_EUROPEANA_API_KEY
ENV VITE_EUROPEANA_API_KEY=$VITE_EUROPEANA_API_KEY

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Serve stage — static nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
