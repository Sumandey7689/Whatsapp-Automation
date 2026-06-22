const express = require('express');
const whatsappService = require('../services/whatsapp');
const messageQueue = require('../services/queue');

const router = express.Router();

router.post('/send-messages', async (req, res) => {
  const { isReady } = whatsappService.getStatus();
  
  if (!isReady) {
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
    const jobs = await messageQueue.addJobs(contacts);
    
    return res.json({
      success: true,
      message: `Sent ${contacts.length} messages`,
      jobIds: jobs.map(job => job.id)
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
