const express = require('express');
const cors = require('cors');
const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;

let client = null;
let isReady = false;
let qrCodeBase64 = null;

// Create directories if they don't exist
const logsDir = path.join(__dirname, 'logs');
const attachmentsDir = path.join(__dirname, 'attachments');
const tempDir = path.join(__dirname, 'temp');
[logsDir, attachmentsDir, tempDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Initialize WPPConnect
function initClient() {
  wppconnect.create({
    session: 'whatsapp-bot',
    headless: true,
    autoClose: 0,
    folderNameToken: 'tokens',
    catchQR: (base64Qr, asciiQR) => {
      qrCodeBase64 = base64Qr;
      console.log('QR Code received');
    },
    statusFind: (statusSession) => {
      console.log('Status:', statusSession);
      if (statusSession === 'inChat') {
        isReady = true;
        qrCodeBase64 = null;
      } else if (statusSession === 'notLogged' || statusSession === 'browserClose') {
        isReady = false;
      }
    },
    browserArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })
  .then((wppClient) => {
    client = wppClient;
    isReady = true;
    console.log('WhatsApp Ready');
  })
  .catch((err) => {
    console.error('Error initializing WhatsApp:', err);
    isReady = false;
  });
}

// Start initializing
initClient();

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API to get QR code
app.post('/api/login-qr', async (req, res) => {
  if (isReady && client) {
    return res.json({
      success: true,
      loggedIn: true,
      message: 'Already logged in'
    });
  }

  if (qrCodeBase64) {
    return res.json({
      success: true,
      loggedIn: false,
      qrCode: qrCodeBase64
    });
  }

  return res.status(404).json({
    success: false,
    message: 'QR code not available yet'
  });
});

// API to check login status
app.post('/api/login-status', async (req, res) => {
  return res.json({
    success: true,
    loggedIn: isReady
  });
});

// API to log out
app.post('/api/logout', async (req, res) => {
  try {
    if (client) {
      await client.logout();
      client = null;
      isReady = false;
      qrCodeBase64 = null;
      
      // Reinitialize after a short delay
      setTimeout(initClient, 2000);
    }

    return res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to log out',
      error: error.message
    });
  }
});

// Helper function to download file from URL
async function downloadFileFromUrl(url) {
  const https = require('https');
  const http = require('http');
  
  let filename;
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    filename = path.basename(pathname);
    if (!filename || filename === '/') {
      throw new Error('No filename in URL');
    }
  } catch {
    const timestamp = Date.now();
    filename = `download-${timestamp}.tmp`;
  }
  
  const filePath = path.join(tempDir, filename);
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFileFromUrl(response.headers.location)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download file: ${response.statusCode}`));
      }
      
      const fileStream = fs.createWriteStream(filePath);
      response.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(filePath);
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(filePath, () => reject(err));
      });
    }).on('error', reject);
  });
}

// API to send messages
app.post('/api/send-messages', async (req, res) => {
  if (!isReady || !client) {
    return res.status(401).json({
      success: false,
      message: 'Not logged in'
    });
  }

  const { contacts } = req.body;
  if (!contacts || !Array.isArray(contacts)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid contacts array'
    });
  }

  const results = [];
  
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    let targetPhone = contact.phone;
    const message = contact.message;
    const attachment = contact.attachment;

    console.log(`📤 [${i + 1}/${contacts.length}] Sending to ${targetPhone}...`);
    
    try {
      targetPhone = targetPhone.replace(/\D/g, '');
      // Ensure the number has country code (add 91 for India as default if missing)
      if (targetPhone.length === 10) {
        targetPhone = '91' + targetPhone;
      }
      const chatId = `${targetPhone}@c.us`;
      console.log(`   Using chatId: ${chatId}`);
      
      let attachmentPath = null;
      let isTemporaryFile = false;
      
      if (attachment) {
        if (attachment.startsWith('http://') || attachment.startsWith('https://')) {
          console.log(`   🌐 Downloading file from URL: ${attachment}`);
          attachmentPath = await downloadFileFromUrl(attachment);
          isTemporaryFile = true;
          console.log(`   ✅ File downloaded to: ${attachmentPath}`);
        } else {
          attachmentPath = path.resolve(__dirname, attachment);
          if (!fs.existsSync(attachmentPath)) {
            results.push({ phone: targetPhone, success: false, error: 'File not found' });
            console.log(`❌ File not found: ${attachmentPath}\n`);
            continue;
          }
        }

        // Determine file type
        const ext = path.extname(attachmentPath).toLowerCase();
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
        const isMedia = imageExtensions.includes(ext) || videoExtensions.includes(ext);

        if (isMedia) {
          await client.sendImage(chatId, attachmentPath, path.basename(attachmentPath), message);
        } else {
          await client.sendFile(chatId, attachmentPath, path.basename(attachmentPath), message);
        }
      } else {
        await client.sendText(chatId, message);
      }

      results.push({ phone: targetPhone, success: true });
      console.log(`✅ Sent to ${targetPhone}\n`);
      
      // Clean up temporary file
      if (isTemporaryFile && attachmentPath && fs.existsSync(attachmentPath)) {
        try {
          fs.unlinkSync(attachmentPath);
        } catch {}
      }
    } catch (err) {
      console.error(`❌ Failed for ${targetPhone}:`, err.message, err.stack);
      results.push({ phone: targetPhone, success: false, error: err.message });
    }

    // Add delay between messages
    if (i < contacts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return res.json({
    success: true,
    results
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`   APIs available:`);
  console.log(`   - POST /api/login-qr    : Get QR code for login`);
  console.log(`   - POST /api/login-status: Check login status`);
  console.log(`   - POST /api/logout      : Log out of WhatsApp`);
  console.log(`   - POST /api/send-messages: Send bulk messages`);
});
