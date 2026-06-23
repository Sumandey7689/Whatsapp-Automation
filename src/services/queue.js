const { Queue, Worker } = require('bullmq');
const fs = require('fs');
const path = require('path');
const redisService = require('./redis');
const { downloadFileFromUrl } = require('../utils/download');

const QUEUE_NAME = 'whatsapp-messages';
const connection = process.env.REDIS_URL 
  ? { url: process.env.REDIS_URL }
  : { host: 'redis', port: 6379 };

class MessageQueueService {
  constructor() {
    this.queue = new Queue(QUEUE_NAME, { connection });
    this.worker = null;
    this.tokenStore = null;
    this.whatsappService = null;
  }

  async addJobs(jobs, token) {
    return this.queue.addBulk(
      jobs.map((job, index) => ({
        name: 'send-message',
        data: { ...job, token },
        opts: { delay: index * 1000 }
      }))
    );
  }

  async startWorker(tokenStore, whatsappService) {
    this.tokenStore = tokenStore;
    this.whatsappService = whatsappService;

    if (this.worker) {
      return;
    }

    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        return this.processMessage(job.data);
      },
      { connection, concurrency: 1 }
    );

    this.worker.on('completed', (job) => {
      console.log(`✅ Job ${job.id} completed for ${job.data.phone}`);
    });

    this.worker.on('failed', (job, err) => {
      console.error(`❌ Job ${job?.id} failed:`, err.message);
    });

    console.log('📋 Message queue worker started');
  }

  async processMessage(data) {
    const { token, phone, message, attachment } = data;

    const tokenData = this.tokenStore[token];
    if (!tokenData) {
      throw new Error('Invalid token');
    }

    const session = this.whatsappService.getSession(tokenData.sessionName);
    if (!session.isReady || !session.client) {
      throw new Error('WhatsApp client not ready');
    }

    const tempDir = path.join(__dirname, '..', '..', 'temp');
    
    let cleanedPhone = phone.replace(/\D/g, '');
    if (cleanedPhone.length === 10) {
      cleanedPhone = '91' + cleanedPhone;
    }
    const chatId = `${cleanedPhone}@c.us`;

    let attachmentPath = null;
    let isTemporaryFile = false;

    if (attachment) {
      const cacheKey = `attachment:${Buffer.from(attachment).toString('base64')}`;
      const cachedPath = await redisService.get(cacheKey);

      if (cachedPath && fs.existsSync(cachedPath)) {
        console.log(`📦 Using cached attachment from ${cachedPath}`);
        attachmentPath = cachedPath;
      } else {
        if (attachment.startsWith('http://') || attachment.startsWith('https://')) {
          console.log(`🌐 Downloading file from URL: ${attachment}`);
          attachmentPath = await downloadFileFromUrl(attachment, tempDir);
          isTemporaryFile = true;
        } else {
          attachmentPath = path.resolve(__dirname, '..', '..', attachment);
          if (!fs.existsSync(attachmentPath)) {
            throw new Error('File not found');
          }
        }

        await redisService.set(cacheKey, attachmentPath, 86400);
      }

      const ext = path.extname(attachmentPath).toLowerCase();
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
      const isMedia = imageExtensions.includes(ext) || videoExtensions.includes(ext);

      if (isMedia) {
        await session.client.sendImage(chatId, attachmentPath, path.basename(attachmentPath), message);
      } else {
        await session.client.sendFile(chatId, attachmentPath, path.basename(attachmentPath), message);
      }

      if (isTemporaryFile && attachmentPath && fs.existsSync(attachmentPath)) {
        // Don't delete cached files
      }
    } else {
      await session.client.sendText(chatId, message);
    }

    return { phone, success: true };
  }

  async close() {
    await this.queue.close();
    if (this.worker) {
      await this.worker.close();
    }
  }
}

module.exports = new MessageQueueService();
