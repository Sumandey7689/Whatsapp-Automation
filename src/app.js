const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const whatsappService = require('./services/whatsapp');
const redisService = require('./services/redis');
const messageQueue = require('./services/queue');
const { router: authRoutes, tokenStore } = require('./routes/auth');
const messageRoutes = require('./routes/messages');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;

const logsDir = path.join(__dirname, '..', 'logs');
const attachmentsDir = path.join(__dirname, '..', 'attachments');
const tempDir = path.join(__dirname, '..', 'temp');
[logsDir, attachmentsDir, tempDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

async function initServices() {
  try {
    await redisService.connect();
    await messageQueue.startWorker(tokenStore, whatsappService);
  } catch (error) {
    console.error('Error initializing services:', error);
  }
}

initServices();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.use('/api', authRoutes);
app.use('/api', messageRoutes);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`   APIs available:`);
  console.log(`   - POST /api/login       : Login with mobile number`);
  console.log(`   - POST /api/login-status: Check login status (needs token)`);
  console.log(`   - POST /api/logout      : Log out (needs token)`);
  console.log(`   - POST /api/send-messages: Send bulk messages (needs token)`);
});
