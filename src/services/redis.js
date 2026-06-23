const redis = require('redis');
const fallbackCache = require('./fallbackCache');

class RedisService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.fallback = fallbackCache;
    this.clientCreated = false;
  }

  async connect() {
    if (this.connected && this.client) {
      return this.client;
    }

    try {
      this.client = redis.createClient({
        url: process.env.REDIS_URL || 'redis://redis:6379',
        socket: {
          reconnectStrategy: false,
          connectTimeout: 2000
        }
      });

      this.clientCreated = true;

      let connected = false;

      this.client.on('error', (err) => {
        if (!connected) {
          console.warn('Redis Client Error (will use fallback):', err.message);
        } else {
          console.error('Redis Client Error:', err);
        }
        this.connected = false;
      });

      this.client.on('connect', () => {
        console.log('Redis Client Connected');
        this.connected = true;
        connected = true;
      });

      this.client.on('ready', () => {
        this.connected = true;
      });

      this.client.on('end', () => {
        this.connected = false;
      });

      await this.client.connect();
      this.connected = true;
      connected = true;
      return this.client;
    } catch (error) {
      console.warn('Redis connection failed, using fallback cache:', error.message);
      this.connected = false;
      this.client = null;
      return null;
    }
  }

  async get(key) {
    if (this.connected && this.client) {
      try {
        return await this.client.get(key);
      } catch (error) {
        console.warn('Redis get failed, using fallback:', error.message);
      }
    }
    return this.fallback.get(key);
  }

  async set(key, value, ttl = 3600) {
    if (this.connected && this.client) {
      try {
        return await this.client.set(key, value, { EX: ttl });
      } catch (error) {
        console.warn('Redis set failed, using fallback:', error.message);
      }
    }
    return this.fallback.set(key, value, ttl);
  }

  async del(key) {
    if (this.connected && this.client) {
      try {
        return await this.client.del(key);
      } catch (error) {
        console.warn('Redis del failed, using fallback:', error.message);
      }
    }
    return this.fallback.del(key);
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch (error) {
        console.warn('Redis disconnect error:', error.message);
      }
      this.client = null;
      this.connected = false;
    }
  }
}

module.exports = new RedisService();
