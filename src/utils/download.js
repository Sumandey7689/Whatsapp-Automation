const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

async function downloadFileFromUrl(url, tempDir) {
  let filename;
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    filename = path.basename(pathname);
    if (!filename || filename === '/') {
      throw new Error('No filename in URL');
    }
  } catch {
    const timestamp = Date.now();
    filename = `download-${timestamp}.tmp`;
  }

  const filePath = path.join(tempDir, filename);

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        return downloadFileFromUrl(response.headers.location, tempDir)
          .then(resolve)
          .catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`Failed to download file: ${response.statusCode}`));
      }

      const fileStream = fs.createWriteStream(filePath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(filePath);
      });

      fileStream.on('error', (err) => {
        fs.unlink(filePath, () => reject(err));
      });
    }).on('error', reject);
  });
}

module.exports = {
  downloadFileFromUrl
};