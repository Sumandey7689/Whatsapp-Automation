const wppconnect = require('@wppconnect-team/wppconnect');
const path = require('path');

class WhatsAppService {
  constructor() {
    this.clients = {};
    this.sessions = {};
  }

  async startSession(sessionName, number) {
    if (this.clients[sessionName]) {
      return this.clients[sessionName];
    }

    const sessionData = {
      isReady: false,
      qrCodeBase64: null,
      number
    };
    this.sessions[sessionName] = sessionData;

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
    }
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
        return { valid: false, reason: 'No WhatsApp client available' };
      }

      const result = await client.checkNumberStatus(phone);
      return {
        valid: result.status === 200,
        numberExists: result.numberExists,
        result: result
      };
    } catch (err) {
      console.error('Error validating number:', err);
      return {
        valid: false,
        reason: 'Error checking number status'
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