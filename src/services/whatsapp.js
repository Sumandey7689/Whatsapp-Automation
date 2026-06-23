const wppconnect = require('@wppconnect-team/wppconnect');
const path = require('path');
const fs = require('fs');
const redisService = require('./redis');

// Initialize Redis connection
(async () => {
  await redisService.connect();
})();

const CACHE_KEY_PREFIX = 'whatsapp:number:';
const CACHE_TTL = 86400 * 7; // 7 days

class WhatsAppService {
  constructor() {
    this.clients = {};
    this.sessions = {};
    this.sessionPromises = {}; // Track ongoing session start promises
  }

  async restoreSessions() {
    const tokensDir = path.join(__dirname, '..', '..', 'profiles');
    
    if (!fs.existsSync(tokensDir)) {
      console.log('Tokens directory not found, no sessions to restore');
      return;
    }

    const sessionDirs = fs.readdirSync(tokensDir).filter(file => {
      const fullPath = path.join(tokensDir, file);
      return fs.statSync(fullPath).isDirectory();
    });

    console.log(`Found ${sessionDirs.length} sessions to restore:`, sessionDirs);

    for (const sessionName of sessionDirs) {
      try {
        // Extract number from session name (session_1234567890)
        const number = sessionName.replace('session_', '');
        await this.startSession(sessionName, number);
      } catch (err) {
        console.error(`Failed to restore session ${sessionName}:`, err);
      }
    }
  }

  async startSession(sessionName, number) {
    if (this.clients[sessionName]) {
      return this.clients[sessionName];
    }

    if (this.sessionPromises[sessionName]) {
      return this.sessionPromises[sessionName];
    }

    const sessionData = {
      isReady: false,
      qrCodeBase64: null,
      number
    };
    this.sessions[sessionName] = sessionData;

    const sessionPromise = (async () => {
      try {
        const client = await wppconnect.create({
          session: sessionName,
          headless: true,
          autoClose: 0,
          folderNameToken: 'tokens',
          puppeteerOptions: {
            userDataDir: path.join(__dirname, '..', '..', 'profiles', sessionName)
          },
          catchQR: (base64Qr) => {
            sessionData.qrCodeBase64 = base64Qr;
            console.log(`QR Code received for ${sessionName}`);
          },
          statusFind: (statusSession) => {
            console.log(`Status for ${sessionName}:`, statusSession);
            if (statusSession === 'inChat') {
              sessionData.isReady = true;
              sessionData.qrCodeBase64 = null;
            } else if (statusSession === 'notLogged' || statusSession === 'browserClose') {
              sessionData.isReady = false;
            }
          },
          browserArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        this.clients[sessionName] = client;
        sessionData.isReady = true;
        console.log(`WhatsApp Ready for ${sessionName}`);
        return client;
      } catch (err) {
        console.error(`Error initializing WhatsApp for ${sessionName}:`, err);
        sessionData.isReady = false;
        throw err;
      } finally {
        delete this.sessionPromises[sessionName];
      }
    })();

    this.sessionPromises[sessionName] = sessionPromise;
    return sessionPromise;
  }

  getSession(sessionName) {
    return {
      client: this.clients[sessionName],
      ...this.sessions[sessionName]
    };
  }

  async validateNumber(client, phone) {
    try {
      if (!client) {
        return {
          valid: false,
          reason: 'No WhatsApp client available'
        };
      }

      let cleanedPhone = phone.replace(/\D/g, '');

      if (cleanedPhone.length === 10) {
        cleanedPhone = '91' + cleanedPhone;
      }

      const cacheKey = CACHE_KEY_PREFIX + cleanedPhone;
      
      // Check cache first
      const cachedData = await redisService.get(cacheKey);
      if (cachedData) {
        console.log(`Using cached validation for ${cleanedPhone}`);
        return JSON.parse(cachedData);
      }

      const chatId = `${cleanedPhone}@c.us`;
      const result = await client.checkNumberStatus(chatId);
      const validationResult = {
        valid: result.numberExists,
        numberExists: result.numberExists,
        wid: result.id?._serialized,
        result
      };

      // Cache the result
      await redisService.set(cacheKey, JSON.stringify(validationResult), CACHE_TTL);

      return validationResult;
    } catch (err) {
      console.error('Error validating number:', err);

      return {
        valid: false,
        reason: err.message
      };
    }
  }

  async logout(sessionName) {
    if (this.clients[sessionName]) {
      await this.clients[sessionName].logout();
      delete this.clients[sessionName];
      delete this.sessions[sessionName];
    }
  }
}

module.exports = new WhatsAppService();