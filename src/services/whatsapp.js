const wppconnect = require('@wppconnect-team/wppconnect');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.qrCodeBase64 = null;
  }

  init() {
    wppconnect.create({
        session: 'whatsapp-bot',
        headless: true,
        autoClose: 0,
        folderNameToken: 'tokens',
        catchQR: (base64Qr) => {
          this.qrCodeBase64 = base64Qr;
          console.log('QR Code received');
        },
        statusFind: (statusSession) => {
          console.log('Status:', statusSession);
          if (statusSession === 'inChat') {
            this.isReady = true;
            this.qrCodeBase64 = null;
          } else if (statusSession === 'notLogged' || statusSession === 'browserClose') {
            this.isReady = false;
          }
        },
        browserArgs: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      })
      .then((wppClient) => {
        this.client = wppClient;
        this.isReady = true;
        console.log('WhatsApp Ready');
      })
      .catch((err) => {
        console.error('Error initializing WhatsApp:', err);
        this.isReady = false;
      });
  }

  getStatus() {
    return {
      isReady: this.isReady,
      qrCodeBase64: this.qrCodeBase64,
      client: this.client
    };
  }

  async logout() {
    if (this.client) {
      await this.client.logout();
      this.client = null;
      this.isReady = false;
      this.qrCodeBase64 = null;

      setTimeout(() => this.init(), 2000);
    }
  }
}

module.exports = new WhatsAppService();