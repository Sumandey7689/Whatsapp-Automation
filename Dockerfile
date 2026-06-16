FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# No need to install xvfb separately - it's already in the Playwright image

# Run the script with xvfb
CMD ["sh", "-c", "xvfb-run -a node web.js"]
