# WhatsApp Bot Automation

A premium, automated WhatsApp messaging bot with a beautiful UI, built with Playwright and Docker.

## Features

- 🎨 Beautiful premium compact UI with real-time status
- 📱 QR code login for easy authentication
- 🚀 Send bulk messages to multiple contacts
- 🔄 Automatic session keep-alive
- ⚠️ Graceful session expiration handling
- 🐳 Dockerized for easy deployment
- 📊 Progress bar and status monitoring
- 📸 Debugging screenshots

## Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Node.js (optional, for local development)

### Running with Docker

1. **Clone or navigate to the project directory**
   ```bash
   cd e:\Automation\Playwright
   ```

2. **Start the bot**
   ```bash
   docker compose up -d
   ```

3. **Open the UI**
   Go to `http://localhost:3000` in your browser

4. **Login with WhatsApp**
   - Scan the QR code with your WhatsApp
   - Open WhatsApp → Settings → Linked Devices → Link a Device

## API Endpoints

### POST /api/login-qr
Get QR code for login or check current status.

**Response:**
```json
{
  "success": true,
  "loggedIn": false,
  "qrCode": "data:image/png;base64,..."
}
```

### POST /api/login-status
Check if currently logged in.

**Response:**
```json
{
  "success": true,
  "loggedIn": true
}
```

### POST /api/logout
Log out and clear session.

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### POST /api/send-messages
Send bulk messages to multiple contacts.

**Request Body:**
```json
{
  "contacts": [
    {
      "phone": "1234567890",
      "message": "Hello from WhatsApp Bot!",
      "attachment": "path/to/file.pdf"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "phone": "1234567890",
      "success": true
    }
  ]
}
```

## Project Structure

```
e:\Automation\Playwright\
├── web.js              # Main bot application
├── index.html          # Premium UI
├── package.json        # Dependencies
├── Dockerfile          # Docker configuration
├── docker-compose.yml  # Compose configuration
├── contact.json        # Contact list (optional)
└── README.md           # This file
```

## Development

### Local Development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Install Playwright browsers**
   ```bash
   npx playwright install chromium
   ```

3. **Run locally**
   ```bash
   node web.js
   ```

### Rebuilding the Docker Image

```bash
docker compose up -d --build
```

## Troubleshooting

### Session Expires After Inactivity
- Bot has built-in keep-alive mechanism
- If session expires, UI will automatically show QR code for re-login

### Can't Load Chat When Sending Messages
- Make sure you're logged in
- Check bot logs with: `docker compose logs -f whatsapp-bot`
- Debug screenshots are saved to the container

### Viewing Logs
```bash
docker compose logs -f whatsapp-bot
```

### Stopping the Bot
```bash
docker compose down
```

## Technologies Used

- **Playwright** - Browser automation
- **Express.js** - Web server
- **Docker** - Containerization
- **WhatsApp Web** - Messaging platform

## License

MIT License - Feel free to use this project for personal or commercial purposes.

## Disclaimer

This project is for educational and automation purposes only. Please respect WhatsApp's terms of service and use responsibly.
