const { Queue, Worker } = require('bullmq');
const fs = require('fs');
const path = require('path');
const redisService = require('./redis');
const fallbackQueue = require('./fallbackQueue');
const { downloadFileFromUrl } = require('../utils/download');
const { getTokenFromRedis, tokenStoreMap } = require('../routes/auth');

const QUEUE_NAME = 'whatsapp-messages';
const connection = process.env.REDIS_URL 
  ? { url: process.env.REDIS_URL }
  : { host: 'redis', port: 6379 };

class MessageQueueService {
  constructor() {
    this.queue = null;
    this.worker = null;
    this.whatsappService = null;
    this.useFallback = false;
    this.fallback = fallbackQueue;
  }

  async init() {
    const redisAvailable = await redisService.checkRedisAvailability();
    
    if (!redisAvailable) {
      this.useFallback = true;
      console.warn('Redis not available, using fallback queue');
      return;
    }

    try {
      this.queue = new Queue(QUEUE_NAME, { 
        connection,
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: true
        }
      });
      
      this.useFallback = false;
      console.log('✅ Redis queue initialized');
    } catch (error) {
      console.warn('Redis queue initialization failed, using fallback queue:', error.message);
      this.useFallback = true;
      await this.cleanupBullMQ();
    }
  }

  async cleanupBullMQ() {
    if (this.queue) {
      try {
        await this.queue.close();
      } catch {}
      this.queue = null;
    }
    if (this.worker) {
      try {
        await this.worker.close();
      } catch {}
      this.worker = null;
    }
  }

  async addJobs(jobs, token) {
    if (this.useFallback || !this.queue) {
      return this.fallback.addBulk(
        jobs.map((job, index) => ({
          name: 'send-message',
          data: { ...job, token }
        }))
      );
    }

    try {
      return await this.queue.addBulk(
        jobs.map((job, index) => ({
          name: 'send-message',
          data: { ...job, token },
          opts: { delay: index * 1000 }
        }))
      );
    } catch (error) {
      console.warn('Redis queue failed, switching to fallback queue:', error.message);
      this.useFallback = true;
      await this.cleanupBullMQ();
      return this.fallback.addBulk(
        jobs.map((job, index) => ({
          name: 'send-message',
          data: { ...job, token }
        }))
      );
    }
  }

  async startWorker(_tokenStore, whatsappService) {
    this.whatsappService = whatsappService;

    await this.init();

    if (this.useFallback) {
      this.fallback.startWorker(_tokenStore, whatsappService, this.processMessage.bind(this));
      return;
    }

    if (this.worker) {
      return;
    }

    try {
      this.worker = new Worker(
        QUEUE_NAME,
        async (job) => {
          return this.processMessage(job.data);
        },
        { 
          connection, 
          concurrency: 1,
          autorun: true
        }
      );

      this.worker.on('completed', (job) => {
        console.log(`✅ Job ${job.id} completed for ${job.data.phone}`);
      });

      this.worker.on('failed', (job, err) => {
        console.error(`❌ Job ${job?.id} failed:`, err.message);
      });

      this.worker.on('error', (err) => {
        console.warn('Redis worker error, switching to fallback queue:', err.message);
        this.useFallback = true;
        this.cleanupBullMQ();
        this.fallback.startWorker(_tokenStore, whatsappService, this.processMessage.bind(this));
      });

      console.log('📋 Message queue worker started');
    } catch (error) {
      console.warn('Redis worker failed, switching to fallback queue:', error.message);
      this.useFallback = true;
      await this.cleanupBullMQ();
      this.fallback.startWorker(_tokenStore, whatsappService, this.processMessage.bind(this));
    }
  }

  async processMessage(data) {
    const { token, phone, message, attachment } = data;

    let tokenData = tokenStoreMap.get(token) || await getTokenFromRedis(token);
    if (!tokenData) {
      throw new Error('Invalid token');
    }

    // Cache in memory
    tokenStoreMap.set(token, tokenData);

    const session = this.whatsappService.getSession(tokenData.sessionName);
    
    // If session not running, start it
    if (!session.client) {
      await this.whatsappService.startSession(tokenData.sessionName, tokenData.number);
    }

    const updatedSession = this.whatsappService.getSession(tokenData.sessionName);
    if (!updatedSession.isReady || !updatedSession.client) {
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
        await updatedSession.client.sendImage(chatId, attachmentPath, path.basename(attachmentPath), message);
      } else {
        await updatedSession.client.sendFile(chatId, attachmentPath, path.basename(attachmentPath), message);
      }

      if (isTemporaryFile && attachmentPath && fs.existsSync(attachmentPath)) {
        // Don't delete cached files
      }
    } else {
      await updatedSession.client.sendText(chatId, message);
    }

    return { phone, success: true };
  }

  async close() {
    await this.cleanupBullMQ();
    await this.fallback.close();
  }
}

module.exports = new MessageQueueService();