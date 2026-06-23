const express = require('express');
const {
  tokenStore
} = require('./auth');
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

function validatePhoneFormat(phone) {
  if (!phone || typeof phone !== 'string') return false;
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length >= 10;
}

router.post('/send-messages', authenticateToken, async (req, res) => {
  const {
    tokenData
  } = req;
  const session = whatsappService.getSession(tokenData.sessionName);

  if (!session.isReady) {
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

  const client = session.client;
  const validContacts = [];
  const invalidNumbers = [];

  // First validate format
  for (let index = 0; index < contacts.length; index++) {
    const contact = contacts[index];
    if (validatePhoneFormat(contact.phone)) {
      // Then validate with wppconnect
      try {
        const validation = await whatsappService.validateNumber(client, contact.phone);
        if (validation.valid && validation.numberExists) {
          validContacts.push(contact);
        } else {
          invalidNumbers.push({
            index,
            phone: contact.phone,
            reason: validation.reason || 'Number does not exist on WhatsApp'
          });
        }
      } catch (err) {
        invalidNumbers.push({
          index,
          phone: contact.phone,
          reason: 'Error checking number status'
        });
      }
    } else {
      invalidNumbers.push({
        index,
        phone: contact.phone,
        reason: 'Invalid phone number format'
      });
    }
  }

  try {
    let jobs = [];
    if (validContacts.length > 0) {
      jobs = await messageQueue.addJobs(validContacts, tokenData.token);
    }

    return res.json({
      success: true,
      message: `${validContacts.length} message(s) queued successfully`,
      jobIds: (jobs || []).map(job => job.id),
      invalidNumbers: invalidNumbers,
      totalContacts: contacts.length,
      validCount: validContacts.length,
      invalidCount: invalidNumbers.length
    });
  } catch (error) {
    console.error('Error adding jobs to queue:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to add messages to queue',
      error: error.message,
      invalidNumbers: invalidNumbers
    });
  }
});

module.exports = router;