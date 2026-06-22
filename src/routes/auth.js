const express = require('express');
const crypto = require('crypto');
const whatsappService = require('../services/whatsapp');

const router = express.Router();

const tokenStore = {};
const numberToToken = {};

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

router.post('/login', async (req, res) => {
  try {
    let { number } = req.body;

    if (!number) {
      return res.status(400).json({
        success: false,
        message: 'Number required'
      });
    }

    number = number.replace(/\D/g, '');

    if (numberToToken[number]) {
      const existingToken = numberToToken[number];
      const tokenData = tokenStore[existingToken];
      const session = whatsappService.getSession(tokenData.sessionName);

      return res.json({
        success: true,
        message: 'Already logged in',
        token: existingToken,
        isReady: session.isReady,
        qrCode: session.qrCodeBase64
      });
    }

    const token = generateToken();
    const sessionName = `session_${number}`;

    tokenStore[token] = {
      token,
      number,
      sessionName,
      createdAt: Date.now()
    };
    numberToToken[number] = token;

    whatsappService.startSession(sessionName, number).catch(err => {
      console.error('Failed to start session:', err);
    });

    const session = whatsappService.getSession(sessionName);

    res.json({
      success: true,
      token,
      number,
      isReady: session.isReady,
      qrCode: session.qrCodeBase64
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.post('/login-status', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token required'
    });
  }

  const tokenData = tokenStore[token];
  if (!tokenData) {
    return res.status(403).json({
      success: false,
      message: 'Invalid token'
    });
  }

  const session = whatsappService.getSession(tokenData.sessionName);
  return res.json({
    success: true,
    loggedIn: session.isReady,
    qrCode: session.qrCodeBase64
  });
});

router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token required'
      });
    }

    const tokenData = tokenStore[token];
    if (!tokenData) {
      return res.status(403).json({
        success: false,
        message: 'Invalid token'
      });
    }

    await whatsappService.logout(tokenData.sessionName);
    delete tokenStore[token];
    delete numberToToken[tokenData.number];

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

module.exports = { router, tokenStore };
