FROM mcr.microsoft.com/playwright:v1.59.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# No need to install xvfb separately - it's already in the Playwright image

# Run the script
CMD ["xvfb-run", "-a", "node", "web.js"]