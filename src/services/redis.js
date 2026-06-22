const redis = require('redis');

class RedisService {
  constructor() {
    this.client = null;
  }

  async connect() {
    if (this.client) {
      return this.client;
    }

    this.client = redis.createClient({
      url: process.env.REDIS_URL || 'redis://redis:6379'
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.client.on('connect', () => {
      console.log('Redis Client Connected');
    });

    await this.client.connect();
    return this.client;
  }

  async get(key) {
    if (!this.client) {
      await this.connect();
    }
    return this.client.get(key);
  }

  async set(key, value, ttl = 3600) {
    if (!this.client) {
      await this.connect();
    }
    return this.client.set(key, value, { EX: ttl });
  }

  async del(key) {
    if (!this.client) {
      await this.connect();
    }
    return this.client.del(key);
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }
}

module.exports = new RedisService();
