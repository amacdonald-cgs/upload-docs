# Stage 1: Build the application
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Install pnpm for faster dependency management (optional, can use npm)
# RUN npm install -g pnpm

# Copy package files
COPY package*.json ./
# COPY pnpm-lock.yaml ./ # If using pnpm

# Install all dependencies (including devDependencies for building)
# RUN pnpm install
RUN npm install

# Copy the rest of the application source code
COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# Stage 2: Create the production image
FROM node:18-alpine

WORKDIR /usr/src/app

# Copy package files again for installing production dependencies
COPY package*.json ./
# COPY pnpm-lock.yaml ./ # If using pnpm

# Install production dependencies only
# RUN pnpm install --prod
RUN npm install --omit=dev --ignore-scripts

# Copy the built application (dist folder) and node_modules from the builder stage
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Expose the port the app runs on
EXPOSE 3001

# Environment variables needed by the application:
# - DATABASE_URL: Connection string for PostgreSQL.
# - TIKA_URL: URL for the Apache Tika server.
# - RABBITMQ_URL: Connection string for RabbitMQ (e.g., amqp://user:password@rabbitmq:5672).
# - OPENAI_API_KEY: Your API key for OpenAI services.
# These are typically set via docker-compose.yml or other runtime configuration methods.

# Define the command to run the application
# The existing "start" script in package.json is "node dist/index.js"
CMD [ "npm", "start" ]
