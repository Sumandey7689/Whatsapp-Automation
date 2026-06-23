const express = require('express');
const { tokenStore } = require('./auth');
const whatsappService = require('../services/whatsapp');
const messageQueue = require('../services/queue');

const router = express.Router();

function authenticateToken(req, res, next) {
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

  req.tokenData = tokenData;
  next();
}

router.post('/send-messages', authenticateToken, async (req, res) => {
  const { tokenData } = req;
  const session = whatsappService.getSession(tokenData.sessionName);
  
  if (!session.isReady) {
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

  try {
    const jobs = await messageQueue.addJobs(contacts, tokenData.token);
    
    return res.json({
      success: true,
      message: `Sent ${contacts.length} messages`,
      jobIds: (jobs || []).map(job => job.id)
    });
  } catch (error) {
    console.error('Error adding jobs to queue:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add messages to queue',
      error: error.message
    });
  }
});

module.exports = router;
