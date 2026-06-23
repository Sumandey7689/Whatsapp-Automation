FROM node:20-bullseye-slim

# Install system dependencies for Puppeteer/WPPConnect
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    xvfb \
    xauth \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy the rest of the application
COPY . .

# Create required directories
RUN mkdir -p /app/tokens /app/logs /app/attachments /app/temp /app/profiles

# Make start script executable
RUN chmod +x /app/start.sh

# Run the application with cleanup
CMD ["sh", "-c", "/app/start.sh"]
