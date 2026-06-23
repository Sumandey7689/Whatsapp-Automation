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
      number,
      status: null
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
            sessionData.status = statusSession;
            if (statusSession === 'inChat') {
              sessionData.isReady = true;
              sessionData.qrCodeBase64 = null;
            } else if (statusSession === 'notLogged' || statusSession === 'browserClose') {
              sessionData.isReady = false;
            }
          },
          browserArgs: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--metrics-recording-only',
            '--mute-audio'
          ]
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
        wid: result.id._serialized || '',
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

  async logout(sessionName, number) {
    try {
      if (this.clients[sessionName]) {
        try {
          // Try to logout gracefully (ignore if context is already destroyed)
          await this.clients[sessionName].logout().catch(() => {});
          // Try to close the browser/page
          if (this.clients[sessionName].page) {
            await this.clients[sessionName].page.close().catch(() => {});
          }
          if (this.clients[sessionName].browser) {
            await this.clients[sessionName].browser.close().catch(() => {});
          }
        } catch (err) {
          console.log(`Cleanup error for ${sessionName}:`, err.message);
        }
        delete this.clients[sessionName];
        delete this.sessions[sessionName];
        delete this.sessionPromises[sessionName];
      }

      // Clean up session profile directory
      const profilesDir = path.join(__dirname, '..', '..', 'profiles', sessionName);
      if (fs.existsSync(profilesDir)) {
        fs.rmSync(profilesDir, {
          recursive: true,
          force: true
        });
        console.log(`Deleted profile directory for ${sessionName}`);
      }

      // Clean up tokens directory (wppconnect stores tokens here)
      const tokensDir = path.join(__dirname, '..', '..', 'tokens', sessionName);
      if (fs.existsSync(tokensDir)) {
        fs.rmSync(tokensDir, {
          recursive: true,
          force: true
        });
        console.log(`Deleted tokens directory for ${sessionName}`);
      }

      // Clean up number validation cache in Redis
      if (number) {
        let cleanedNumber = number.replace(/\D/g, '');
        if (cleanedNumber.length === 10) {
          cleanedNumber = '91' + cleanedNumber;
        }
        const cacheKey = CACHE_KEY_PREFIX + cleanedNumber;
        await redisService.del(cacheKey);
        console.log(`Deleted number validation cache for ${cleanedNumber}`);
      }

      console.log(`Successfully logged out ${sessionName}`);
    } catch (err) {
      console.error(`Logout error for ${sessionName}:`, err);
      throw err;
    }
  }
}

module.exports = new WhatsAppService();