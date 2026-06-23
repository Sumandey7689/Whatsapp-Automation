# WhatsApp Bot Service

A robust WhatsApp bot service built with Node.js, WPPConnect, Redis, and BullMQ. Supports bulk messaging with attachments, session management, and queue processing.

## Features

- 📱 WhatsApp Web integration via WPPConnect
- 📨 Bulk message sending with attachments
- 📊 Queue management with BullMQ
- 💾 Redis for caching and token storage
- 🐳 Docker support for easy deployment
- 🔐 Token-based authentication
- ✅ Number validation before sending
- 🔄 Auto-reconnection and session recovery

## Prerequisites

- Docker and Docker Compose (recommended)
- OR Node.js 20+ and Redis 7+ (for local development)
- A WhatsApp account to link as the bot

## Quick Start with Docker

### 1. Clone/Navigate to Project
```bash
cd e:\Automation\Playwright
```

### 2. Start Services
```bash
docker compose up -d --build
```

This will start:
- `whatsapp-redis`: Redis server (port 6379)
- `whatsapp-bot`: Main application (port 3000)

### 3. Login via Web UI
Open your browser and go to `http://localhost:3000`

Or use the API (see [API Endpoints](#api-endpoints) below).

## Local Development (Without Docker)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Redis
Ensure Redis is running locally on port 6379.

### 3. Start Application
```bash
npm start
```

## API Endpoints

### Authentication

#### POST `/api/login`
Start a new WhatsApp session or retrieve an existing one.

**Request:**
```json
POST http://localhost:3000/api/login
Content-Type: application/json

{
  "number": "919002617469"
}
```

**Response:**
```json
{
  "success": true,
  "token": "46acbfd8c1c123d48444f790107633260255fc6f9a3267e8f606702a37e70b66",
  "number": "919002617469",
  "isReady": false,
  "qrCode": "data:image/png;base64,..."
}
```

---

#### POST `/api/login-status`
Check session status (requires token).

**Request:**
```json
POST http://localhost:3000/api/login-status
Authorization: Bearer YOUR_TOKEN_HERE
```

**Response (Ready):**
```json
{
  "success": true,
  "loggedIn": true,
  "qrCode": null
}
```

**Response (Needs QR):**
```json
{
  "success": true,
  "loggedIn": false,
  "qrCode": "data:image/png;base64,..."
}
```

---

#### POST `/api/logout`
Logout and invalidate token.

**Request:**
```json
POST http://localhost:3000/api/logout
Authorization: Bearer YOUR_TOKEN_HERE
```

---

### Messaging

#### POST `/api/send-messages`
Send bulk messages (requires token).

**Request:**
```json
POST http://localhost:3000/api/send-messages
Content-Type: application/json
Authorization: Bearer YOUR_TOKEN_HERE

{
  "contacts": [
    {
      "phone": "919002617469",
      "message": "Hacker",
      "attachment": "https://m.media-amazon.com/images/I/31sDQI7yfDL._AC_UF894,1000_QL80_.jpg"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "1 message(s) queued successfully",
  "jobIds": ["1"],
  "invalidNumbers": [],
  "totalContacts": 1,
  "validCount": 1,
  "invalidCount": 0
}
```

---

## Project Structure

```
e:\Automation\Playwright/
├── src/
│   ├── routes/
│   │   ├── auth.js         # Authentication routes
│   │   └── messages.js     # Messaging routes
│   ├── services/
│   │   ├── whatsapp.js     # WPPConnect session management
│   │   ├── redis.js        # Redis integration
│   │   ├── queue.js        # BullMQ queue worker
│   │   ├── fallbackCache.js
│   │   └── fallbackQueue.js
│   ├── utils/
│   │   └── download.js     # Attachment downloader
│   └── app.js              # Express server entry
├── profiles/               # WhatsApp Web session profiles
├── attachments/            # Downloaded attachments
├── logs/                   # Application logs
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## Troubleshooting

### View Logs
```bash
docker logs -f whatsapp-bot
```

### Clear Redis Cache
```bash
# Clear all data
docker exec -it whatsapp-redis redis-cli FLUSHDB
```

### Restart Services
```bash
docker compose restart
```

### Stop Everything
```bash
docker compose down
```

## License

MIT
