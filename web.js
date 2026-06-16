
// Disable output buffering
process.stdout._handle.setBlocking(true);

const {
  chromium
} = require('playwright');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

console.log('🚀 Starting WhatsApp bot...');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let browserContext = null;
let page = null;
let isLoggedIn = false;
let qrCodeBase64 = null;

// Try to close any popups (What's new, notifications, etc.)
const popupSelectors = [
  'button[aria-label="Close"]',
  'div[role="button"][aria-label*="close" i]',
  'svg[data-icon="x"]'
];

async function closePopups(targetPage) {
  for (const selector of popupSelectors) {
    try {
      const popup = await targetPage.locator(selector).first();
      if (await popup.isVisible({ timeout: 3000 })) {
        await popup.click();
        console.log('✅ Closed popup!');
        await targetPage.waitForTimeout(1000);
        break;
      }
    } catch {}
  }
}

// Initialize browser and page
async function initBrowser() {
  console.log('📱 Launching browser...');
  browserContext = await chromium.launchPersistentContext('./wa-session', {
    headless: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  page = await browserContext.newPage();
  page.setDefaultTimeout(30000);

  // 👇 force visibility for headless
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible'
    });
    Object.defineProperty(document, 'hidden', {
      get: () => false
    });

    // Override navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    });
  });

  console.log('🌐 Navigating to WhatsApp Web...');
  await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('⏳ Waiting for page to load...');
  await page.waitForLoadState('networkidle', { timeout: 60000 });
  await page.waitForTimeout(10000);

  console.log('📸 Taking initial screenshot...');
  await page.screenshot({ path: '/app/initial-screenshot.png' });

  await closePopups(page);

  console.log('🔍 Checking initial login state...');
  isLoggedIn = await checkLoginState();
  if (isLoggedIn) {
    console.log('♻️ Already logged in!');
  }

  // Start background loop to check for QR code and update status
  startBackgroundLoop();
}

async function checkLoginState() {
  if (!page || !browserContext) {
    return false;
  }
  try {
    // Check if we're logged in by looking for chat interface
    const loggedInSelectors = [
      '[data-testid="chat-list"]',
      '#main',
      '[data-testid="conversation-panel"]',
      '[data-testid="search-input"]'
    ];
    for (const selector of loggedInSelectors) {
      try {
        if (await page.locator(selector).isVisible({ timeout: 2000 })) {
          return true;
        }
      } catch {}
    }
  } catch {}
  return false;
}

async function isShowingQRCode() {
  if (!page || !browserContext) {
    return false;
  }
  try {
    // Check if QR code is visible
    const qrSelectors = [
      'canvas',
      '[data-testid="qr-code"] canvas',
      'div canvas',
      'img[alt*="QR"]',
      '[data-testid*="qr"]',
      'div[role="img"]'
    ];
    for (const selector of qrSelectors) {
      try {
        if (await page.locator(selector).isVisible({ timeout: 2000 })) {
          return true;
        }
      } catch {}
    }
  } catch {}
  return false;
}

async function getQRCodeBase64() {
  if (!page || !browserContext) {
    return null;
  }
  try {
    // Try multiple selectors for QR code canvas
    const qrSelectors = [
      'canvas',
      '[data-testid="qr-code"] canvas',
      'div canvas',
      'img[alt*="QR"]',
      '[data-testid*="qr"]',
      'div[role="img"]'
    ];
    
    let qrElement = null;
    for (const selector of qrSelectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.isVisible({ timeout: 5000 })) {
          qrElement = locator;
          console.log(`✅ Found QR code with selector: ${selector}`);
          break;
        }
      } catch {}
    }

    if (!qrElement) {
      console.log('⚠️ No QR code element found, taking screenshot...');
      await page.screenshot({ path: '/app/debug-screenshot.png', fullPage: true });
      console.log('📸 Screenshot saved to debug-screenshot.png');
      return null;
    }

    // Extract canvas data as base64
    const base64 = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        return canvas.toDataURL('image/png');
      }
      // If no canvas, try img elements
      const img = document.querySelector('img');
      if (img && img.src) {
        return img.src;
      }
      return null;
    });

    if (!base64) {
      console.log('⚠️ Could not extract QR code data');
      await page.screenshot({ path: '/app/qr-failed-screenshot.png' });
    }

    return base64;
  } catch (e) {
    console.log('❌ Error getting QR code:', e.message);
    try {
      await page.screenshot({ path: '/app/error-screenshot.png' });
      console.log('📸 Error screenshot saved to error-screenshot.png');
    } catch {}
    return null;
  }
}

function startBackgroundLoop() {
  setInterval(async () => {
    if (!page || !browserContext) {
      return;
    }
    const wasLoggedIn = isLoggedIn;
    isLoggedIn = await checkLoginState();
    
    if (wasLoggedIn && !isLoggedIn) {
      // Session expired!
      console.log('⚠️ Session expired! Showing QR code for re-login.');
    }
    
    if (!isLoggedIn) {
      qrCodeBase64 = await getQRCodeBase64();
    } else {
      qrCodeBase64 = null;
      
      // Keep-alive: periodically interact with the page to prevent session timeout
      try {
        // Just scroll a little or interact to keep session alive
        await page.evaluate(() => {
          window.scrollBy(0, 1);
          window.scrollBy(0, -1);
        });
      } catch {}
    }
  }, 10000); // Check every 10 seconds
}

// API to get QR code
app.post('/api/login-qr', async (req, res) => {
  if (isLoggedIn) {
    return res.json({
      success: true,
      loggedIn: true,
      message: 'Already logged in'
    });
  }

  if (qrCodeBase64) {
    return res.json({
      success: true,
      loggedIn: false,
      qrCode: qrCodeBase64
    });
  }

  // Try to get QR code now
  const qr = await getQRCodeBase64();
  if (qr) {
    qrCodeBase64 = qr;
    return res.json({
      success: true,
      loggedIn: false,
      qrCode: qr
    });
  }

  return res.status(404).json({
    success: false,
    message: 'QR code not available yet'
  });
});

// API to check login status
app.post('/api/login-status', async (req, res) => {
  isLoggedIn = await checkLoginState();
  return res.json({
    success: true,
    loggedIn: isLoggedIn
  });
});

// API to log out
app.post('/api/logout', async (req, res) => {
  try {
    console.log('🔐 Logging out...');
    
    // Try to log out via WhatsApp Web UI first
    try {
      // Click the menu button (three dots)
      const menuButton = page.locator('[aria-label="Menu"]').first();
      if (await menuButton.isVisible({ timeout: 5000 })) {
        await menuButton.click();
        await page.waitForTimeout(1000);
        
        // Click "Log out"
        const logoutButton = page.locator('text=Log out').first();
        if (await logoutButton.isVisible({ timeout: 5000 })) {
          await logoutButton.click();
          await page.waitForTimeout(2000);
          
          // Confirm logout if needed
          try {
            const confirmButton = page.locator('text=Log out').nth(1).first();
            if (await confirmButton.isVisible({ timeout: 3000 })) {
              await confirmButton.click();
              await page.waitForTimeout(2000);
            }
          } catch {}
        }
      }
    } catch (e) {
      console.log('⚠️ Could not log out via UI, clearing session...');
    }
    
    // Close browser context first to release locks on wa-session
    console.log('🔌 Closing browser context...');
    if (browserContext) {
      await browserContext.close();
      browserContext = null;
      page = null;
    }
    
    // Clear the persistent context by removing the wa-session directory
    const fs = require('fs');
    const path = require('path');
    const sessionDir = path.join(__dirname, 'wa-session');
    if (fs.existsSync(sessionDir)) {
      // Retry a few times to make sure directory is released
      let retries = 5;
      while (retries > 0) {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          console.log('📁 Session directory cleared');
          break;
        } catch (e) {
          console.log(`⚠️ Retry deleting session (${retries} left)...`);
          retries--;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // Reset state
    isLoggedIn = false;
    qrCodeBase64 = null;
    
    // Reinitialize browser
    console.log('🔄 Reinitializing browser...');
    await initBrowser();
    
    return res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('❌ Logout error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to log out',
      error: error.message
    });
  }
});

// API to send messages
app.post('/api/send-messages', async (req, res) => {
  // Double-check login status before proceeding
  isLoggedIn = await checkLoginState();
  if (!isLoggedIn) {
    return res.status(401).json({
      success: false,
      message: 'Not logged in. Session may have expired. Please re-login with QR code.'
    });
  }

  const { contacts } = req.body;
  if (!contacts || !Array.isArray(contacts)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid contacts array'
    });
  }

  const results = [];
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const targetPhone = contact.phone;
    const message = contact.message;
    const attachment = contact.attachment;

    console.log(`📤 [${i + 1}/${contacts.length}] Sending to ${targetPhone}...`);

    try {
      // Navigate to WhatsApp Web chat for this contact
      const url = `https://web.whatsapp.com/send?phone=${targetPhone}`;
      console.log(`   Navigating to: ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Wait for WhatsApp Web to process and load
      await page.waitForTimeout(5000);
      
      // Close any popups
      await closePopups(page);

      // Check for invalid number
      const invalid = await page.locator('text=Phone number shared via url is invalid')
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      if (invalid) {
        results.push({ phone: targetPhone, success: false, error: 'Invalid number' });
        console.log(`❌ Invalid number: ${targetPhone}\n`);
        continue;
      }

      // Wait for chat to load - try multiple strategies
      console.log(`   Waiting for chat to load...`);
      let chatLoaded = false;
      const waitStrategies = [
        { selector: 'div[contenteditable="true"]', timeout: 15000 },
        { selector: '[data-testid="conversation-panel"]', timeout: 10000 },
        { selector: '#main', timeout: 10000 }
      ];

      for (const strategy of waitStrategies) {
        try {
          await page.waitForSelector(strategy.selector, { timeout: strategy.timeout });
          chatLoaded = true;
          console.log(`   ✓ Chat loaded (strategy: ${strategy.selector})`);
          break;
        } catch (e) {
          console.log(`   ✗ Strategy failed: ${strategy.selector}`);
        }
      }

      if (!chatLoaded) {
        await page.screenshot({ path: `/app/chat-failed-${targetPhone}.png` });
        results.push({ phone: targetPhone, success: false, error: 'Could not load chat' });
        console.log(`❌ Could not load chat: ${targetPhone}\n`);
        continue;
      }

      // Handle attachment if present
      if (attachment) {
        const fullPath = path.resolve(__dirname, attachment);
        if (!fs.existsSync(fullPath)) {
          results.push({ phone: targetPhone, success: false, error: 'File not found' });
          console.log(`❌ File not found: ${fullPath}`);
          continue;
        }

        console.log(`   📁 Uploading file: ${fullPath}`);
        const attachButton = page.locator('[data-testid="attach"]').first();
        try {
          await attachButton.click({ timeout: 10000 });
        } catch {}

        // Look for file input
        const fileInput = page.locator('input[type="file"]').first();
        try {
          await fileInput.setInputFiles(fullPath, { timeout: 15000 });
        } catch (e) {
          console.log(`   File upload failed, trying alternative method...`);
        }
        await page.waitForTimeout(5000);

        // Add message if present
        if (message) {
          console.log(`   Typing message...`);
          const messageInput = page.locator('div[contenteditable="true"]').first();
          await messageInput.waitFor({ timeout: 10000 });
          await messageInput.click();
          await page.waitForTimeout(500);
          await messageInput.fill(message);
          await page.waitForTimeout(1000);
        }
      } else {
        // Just text message
        console.log(`   Typing message...`);
        const messageInput = page.locator('div[contenteditable="true"]').first();
        await messageInput.waitFor({ timeout: 10000 });
        await messageInput.click();
        await page.waitForTimeout(500);
        await messageInput.fill(message);
        await page.waitForTimeout(1000);
      }

      // Press Enter to send
      console.log(`   Sending...`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(4000);

      results.push({ phone: targetPhone, success: true });
      console.log(`✅ Sent to ${targetPhone}\n`);

    } catch (err) {
      console.error(`❌ Failed for ${targetPhone}:`, err.message);
      try {
        await page.screenshot({ path: `/app/error-${targetPhone}.png` });
      } catch {}
      results.push({ phone: targetPhone, success: false, error: err.message });
    }

    // Add delay between messages to avoid being rate-limited
    if (i < contacts.length - 1) {
      await page.waitForTimeout(3000);
    }
  }

  return res.json({
    success: true,
    results
  });
});

// Start server after browser initialization
(async () => {
  await initBrowser();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`   APIs available:`);
    console.log(`   - POST /api/login-qr    : Get QR code for login`);
    console.log(`   - POST /api/login-status: Check login status`);
    console.log(`   - POST /api/logout      : Log out of WhatsApp`);
    console.log(`   - POST /api/send-messages: Send bulk messages`);
  });
})();

