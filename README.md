# Full Workflow Guide

This guide explains the complete workflow for using the WhatsApp Bot.

---

## Prerequisites

- Docker and Docker Compose installed
- A WhatsApp account (to link as the bot)

---

## Step 1: Start the Services

### 1.1 Navigate to the Project Directory
```bash
cd e:\Automation\Playwright
```

### 1.2 Start Docker Compose
```bash
docker compose up -d
```

This will start 2 containers:
1. `whatsapp-redis`: Redis server for queue and cache
2. `whatsapp-bot`: Main bot application (runs on port 3000)

### 1.3 Verify Containers are Running
```bash
docker compose ps
```

---

## Step 2: Authenticate (Login) with WhatsApp

You have 2 options for logging in:

### Option A: Using the Web UI
1. Open your browser and go to `http://localhost:3000`
2. Enter your WhatsApp number (e.g., `1234567890`) and click "Login"
3. Wait for the QR code to appear
4. Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
5. Scan the QR code
6. Once logged in, you'll see "Status: Logged In"

### Option B: Using the API

#### 2.1 Request Login Token
Send a POST request to `/api/login` with your phone number:
```json
POST http://localhost:3000/api/login
Content-Type: application/json

{
  "number": "1234567890"
}
```

**Response Example:**
```json
{
  "success": true,
  "token": "46acbfd8c1c123d48444f790107633260255fc6f9a3267e8f606702a37e70b66",
  "number": "1234567890",
  "isReady": false,
  "qrCode": "data:image/png;base64,..."
}
```

Save the `token` from the response — you'll need it for all authenticated requests!

#### 2.2 Check Login Status
Use the token to check if you're logged in (or get a new QR code if needed):
```json
POST http://localhost:3000/api/login-status
Content-Type: application/json
Authorization: Bearer YOUR_TOKEN_HERE
```

**Response Example when Logged In:**
```json
{
  "success": true,
  "loggedIn": true,
  "qrCode": null
}
```

---

## Step 3: Send Bulk Messages

### 3.1 Prepare Your Contacts
Create an array of contacts with `phone` and `message` (and optional `attachment`):
```json
{
  "contacts": [
    {
      "phone": "917478699658",
      "message": "Hello from WhatsApp Bot!",
      "attachment": "https://example.com/image.jpg"
    },
    {
      "phone": "911234567890",
      "message": "Another message!"
    }
  ]
}
```

### 3.2 Send via API
```json
POST http://localhost:3000/api/send-messages
Content-Type: application/json
Authorization: Bearer YOUR_TOKEN_HERE

{
  "contacts": [
    {
      "phone": "910987456321",
      "message": "Hello from WhatsApp Bot!"
    },
    {
      "phone": "911234567890",
      "message": "Hi there!"
    }
  ]
}
```

**Response Example:**
```json
{
  "success": true,
  "message": "2 message(s) queued successfully",
  "jobIds": ["1", "2"],
  "invalidNumbers": [],
  "totalContacts": 2,
  "validCount": 2,
  "invalidCount": 0
}
```

---

## Step 4: Monitor the Bot

### 4.1 Check Bot Logs
```bash
docker logs -f whatsapp-bot
```

### 4.2 Check Redis Cache (Optional)
To see what's in Redis:
```bash
# List all keys
docker exec -it whatsapp-redis redis-cli KEYS "*"

# View cached number validations
docker exec -it whatsapp-redis redis-cli MGET "whatsapp:number:917478699658" "whatsapp:number:919002617469"
```

---

## Step 5: Logout (When Done)

### 5.1 Logout via API
```json
POST http://localhost:3000/api/logout
Authorization: Bearer YOUR_TOKEN_HERE
```

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Troubleshooting & Maintenance

### Clear Redis Cache
If you need to delete cached data (like number validations):
```bash
# Delete specific number caches
docker exec -it whatsapp-redis redis-cli DEL "whatsapp:number:919002617469"

# Delete all number caches
docker exec -it whatsapp-redis redis-cli --scan --pattern "whatsapp:number:*" | xargs docker exec -i whatsapp-redis redis-cli DEL

# Clear ALL Redis data (including auth tokens and queue data)
docker exec -it whatsapp-redis redis-cli FLUSHDB
```

### Restart the Bot
If the in-memory fallback cache needs to be cleared:
```bash
docker compose restart whatsapp-bot
```

### Stop Everything
```bash
docker compose down
```

---

## Key Files & Directories
- `e:\Automation\Playwright\profiles\`: Stores Chromium profiles for WhatsApp Web sessions
- `e:\Automation\Playwright\tokens\`: (Not used in current version, but reserved)
- `e:\Automation\Playwright\attachments\`: Stores downloaded attachments
- `e:\Automation\Playwright\logs\`: Stores app logs
