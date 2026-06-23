class FallbackQueue {
  constructor() {
    this.queue = [];
    this.worker = null;
    this.processFn = null;
    this.tokenStore = null;
    this.whatsappService = null;
    this.isProcessing = false;
  }

  addBulk(jobs) {
    this.queue.push(...jobs);
    if (!this.isProcessing) {
      this.processQueue();
    }
    return Promise.resolve();
  }

  startWorker(tokenStore, whatsappService, processFn) {
    this.tokenStore = tokenStore;
    this.whatsappService = whatsappService;
    this.processFn = processFn;
    console.log('📋 Fallback queue worker started');
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0 || !this.processFn) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      try {
        await this.processFn(job.data);
        console.log(`✅ Job ${job.name} completed for ${job.data.phone}`);
      } catch (error) {
        console.error(`❌ Job failed:`, error.message);
      }
    }

    this.isProcessing = false;
  }

  async close() {
    this.queue = [];
    this.isProcessing = false;
    this.processFn = null;
  }
}

module.exports = new FallbackQueue();