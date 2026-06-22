const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const whatsappService = require('./services/whatsapp');
const authRoutes = require('./routes/auth');
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
    fs.mkdirSync(dir, {
      recursive: true
    });
  }
});

whatsappService.init();

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.use('/api', authRoutes);
app.use('/api', messageRoutes);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`   APIs available:`);
  console.log(`   - POST /api/login-qr    : Get QR code for login`);
  console.log(`   - POST /api/login-status: Check login status`);
  console.log(`   - POST /api/logout      : Log out of WhatsApp`);
  console.log(`   - POST /api/send-messages: Send bulk messages`);
});