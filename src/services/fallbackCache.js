class FallbackCache {
    constructor() {
        this.cache = new Map();
        this.ttlTimers = new Map();
    }

    set(key, value, ttl = 3600) {
        if (this.ttlTimers.has(key)) {
            clearTimeout(this.ttlTimers.get(key));
        }

        this.cache.set(key, value);

        const timer = setTimeout(() => {
            this.del(key);
        }, ttl * 1000);

        this.ttlTimers.set(key, timer);
        return Promise.resolve();
    }

    get(key) {
        return Promise.resolve(this.cache.get(key) || null);
    }

    del(key) {
        if (this.ttlTimers.has(key)) {
            clearTimeout(this.ttlTimers.get(key));
            this.ttlTimers.delete(key);
        }
        this.cache.delete(key);
        return Promise.resolve();
    }

    clear() {
        this.ttlTimers.forEach(timer => clearTimeout(timer));
        this.ttlTimers.clear();
        this.cache.clear();
    }
}

module.exports = new FallbackCache();