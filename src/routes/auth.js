const express = require('express');
const crypto = require('crypto');
const whatsappService = require('../services/whatsapp');
const redisService = require('../services/redis');

const router = express.Router();

// Initialize Redis connection
(async () => {
  await redisService.connect();
})();

const tokenStore = new Map();
const numberToToken = new Map();

const TOKEN_KEY_PREFIX = 'auth:token:';
const NUMBER_KEY_PREFIX = 'auth:number:';

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function getTokenFromRedis(token) {
  const data = await redisService.get(TOKEN_KEY_PREFIX + token);
  return data ? JSON.parse(data) : null;
}

async function setTokenToRedis(token, tokenData) {
  await redisService.set(TOKEN_KEY_PREFIX + token, JSON.stringify(tokenData), 86400 * 30); // 30 days
  await redisService.set(NUMBER_KEY_PREFIX + tokenData.number, token, 86400 * 30);
}

async function deleteTokenFromRedis(token, number) {
  await redisService.del(TOKEN_KEY_PREFIX + token);
  await redisService.del(NUMBER_KEY_PREFIX + number);
}

async function getNumberTokenFromRedis(number) {
  return await redisService.get(NUMBER_KEY_PREFIX + number);
}

router.post('/login', async (req, res) => {
  try {
    let {
      number
    } = req.body;

    if (!number) {
      return res.status(400).json({
        success: false,
        message: 'Number required'
      });
    }

    number = number.replace(/\D/g, '');

    // Check Redis first
    let existingToken = numberToToken.get(number) || await getNumberTokenFromRedis(number);
    if (existingToken) {
      let tokenData = tokenStore.get(existingToken) || await getTokenFromRedis(existingToken);
      if (tokenData) {
        // Cache in memory
        tokenStore.set(existingToken, tokenData);
        numberToToken.set(number, existingToken);

        const session = whatsappService.getSession(tokenData.sessionName);

        // If session not running, start it
        if (!session.client) {
          whatsappService.startSession(tokenData.sessionName, number).catch(err => {
            console.error('Failed to start session:', err);
          });
        }

        return res.json({
          success: true,
          message: 'Already logged in',
          token: existingToken,
          isReady: session.isReady,
          qrCode: session.qrCodeBase64
        });
      }
    }

    const token = generateToken();
    const sessionName = `session_${number}`;

    const tokenData = {
      token,
      number,
      sessionName,
      createdAt: Date.now()
    };

    // Store in memory and Redis
    tokenStore.set(token, tokenData);
    numberToToken.set(number, token);
    await setTokenToRedis(token, tokenData);

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

router.post('/login-status', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token required'
    });
  }

  let tokenData = tokenStore.get(token) || await getTokenFromRedis(token);
  if (!tokenData) {
    return res.status(403).json({
      success: false,
      message: 'Invalid token'
    });
  }

  // Cache in memory
  tokenStore.set(token, tokenData);
  numberToToken.set(tokenData.number, token);

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

    let tokenData = tokenStore.get(token) || await getTokenFromRedis(token);
    if (!tokenData) {
      return res.status(403).json({
        success: false,
        message: 'Invalid token'
      });
    }

    await whatsappService.logout(tokenData.sessionName);
    tokenStore.delete(token);
    numberToToken.delete(tokenData.number);
    await deleteTokenFromRedis(token, tokenData.number);

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


const exportedTokenStore = {
  get: async (token) => tokenStore.get(token) || await getTokenFromRedis(token),
  has: async (token) => tokenStore.has(token) || !!(await getTokenFromRedis(token))
};

// Also export a proxy for backward compatibility
const tokenStoreProxy = new Proxy({}, {
  get: (_, token) => {
    return tokenStore.get(token) || getTokenFromRedis(token);
  }
});

module.exports = {
  router,
  tokenStore: tokenStoreProxy,
  getTokenFromRedis,
  tokenStoreMap: tokenStore
};