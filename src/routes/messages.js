const express = require('express');
const fs = require('fs');
const path = require('path');
const whatsappService = require('../services/whatsapp');
const {
  downloadFileFromUrl
} = require('../utils/download');

const router = express.Router();

router.post('/send-messages', async (req, res) => {
  const {
    isReady,
    client
  } = whatsappService.getStatus();
  const tempDir = path.join(__dirname, '..', '..', 'temp');

  if (!isReady || !client) {
    return res.status(401).json({
      success: false,
      message: 'Not logged in'
    });
  }

  const {
    contacts
  } = req.body;
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
          attachmentPath = await downloadFileFromUrl(attachment, tempDir);
          isTemporaryFile = true;
          console.log(`   ✅ File downloaded to: ${attachmentPath}`);
        } else {
          attachmentPath = path.resolve(__dirname, '..', '..', attachment);
          if (!fs.existsSync(attachmentPath)) {
            results.push({
              phone: targetPhone,
              success: false,
              error: 'File not found'
            });
            console.log(`❌ File not found: ${attachmentPath}\n`);
            continue;
          }
        }

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

      results.push({
        phone: targetPhone,
        success: true
      });
      console.log(`✅ Sent to ${targetPhone}\n`);

      if (isTemporaryFile && attachmentPath && fs.existsSync(attachmentPath)) {
        try {
          fs.unlinkSync(attachmentPath);
        } catch {}
      }
    } catch (err) {
      console.error(`❌ Failed for ${targetPhone}:`, err.message, err.stack);
      results.push({
        phone: targetPhone,
        success: false,
        error: err.message
      });
    }

    if (i < contacts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return res.json({
    success: true,
    results
  });
});

module.exports = router;