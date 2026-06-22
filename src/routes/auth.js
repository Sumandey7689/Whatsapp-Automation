const express = require('express');
const whatsappService = require('../services/whatsapp');

const router = express.Router();

router.post('/login-qr', async (req, res) => {
  const {
    isReady,
    qrCodeBase64
  } = whatsappService.getStatus();

  if (isReady) {
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

router.post('/login-status', async (req, res) => {
  const {
    isReady
  } = whatsappService.getStatus();

  return res.json({
    success: true,
    loggedIn: isReady
  });
});

router.post('/logout', async (req, res) => {
  try {
    await whatsappService.logout();

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

module.exports = router;