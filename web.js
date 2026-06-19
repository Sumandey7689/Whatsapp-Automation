
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
let isSendingMessages = false;
let isLoggingOut = false;

// Helper function to download file from URL
async function downloadFileFromUrl(url) {
  const fs = require('fs');
  const path = require('path');
  const https = require('https');
  const http = require('http');
  
  // Create temp directory if it doesn't exist
  const tempDir = path.join(__dirname, 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // Extract filename from URL or use random name
  let filename;
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    filename = path.basename(pathname);
    // If filename is empty or just '/', use random name
    if (!filename || filename === '/') {
      throw new Error('No filename in URL');
    }
  } catch {
    // Generate random filename
    const timestamp = Date.now();
    filename = `download-${timestamp}.tmp`;
  }
  
  const filePath = path.join(tempDir, filename);
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirect
        return downloadFileFromUrl(response.headers.location)
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

// Helper function to take screenshots
async function takeDebugScreenshot(targetPage, label) {
  try {
    // Create logs directory if it doesn't exist
    const fs = require('fs');
    const path = require('path');
    const logsDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Create latest filename
    const latestFilename = path.join(logsDir, 'latest.png');
    
    // Take screenshot and save directly to latest.png (overwrite each time)
    await targetPage.screenshot({ path: latestFilename, fullPage: true });
  } catch (err) {
    console.log(`⚠️ Could not take debug screenshot (${label}):`, err.message);
  }
}

// Smart wait for attachment upload to complete
async function waitForAttachmentUpload(targetPage) {
  try {
    // Wait for upload progress or file preview to appear
    const previewSelectors = [
      '[data-testid="media-editor"]',
      'img[src*="blob"]',
      'div[role="img"]',
      'canvas[style*="background-image"]'
    ];
    
    for (const sel of previewSelectors) {
      try {
        await targetPage.locator(sel).waitFor({ timeout: 10000 });
        console.log('   ✅ Attachment preview visible');
        return true;
      } catch {}
    }
    
    // If no preview, just wait a reasonable time
    await targetPage.waitForTimeout(2000);
    return false;
  } catch {
    return false;
  }
}

// Smart wait for message to be sent
async function waitForMessageSent(targetPage) {
  try {
    // Wait for single or double checkmarks
    const checkMarkSelectors = [
      '[data-testid="msg-dblcheck"]',
      '[data-testid="msg-check"]'
    ];
    
    for (const sel of checkMarkSelectors) {
      try {
        await targetPage.locator(sel).last().waitFor({ timeout: 3000 });
        console.log('   ✅ Message sent checkmark visible');
        return true;
      } catch {}
    }
    
    // Fallback: small wait
    await targetPage.waitForTimeout(1000);
    return false;
  } catch {
    return false;
  }
}

// Try to close any popups (What's new, notifications, etc.)
const popupSelectors = [
  'button[aria-label="Close"]',
  'div[role="button"][aria-label*="close" i]',
  'svg[data-icon="x"]',
  'button[aria-label="Dismiss"]',
  'button:has-text("Close")',
  'button:has-text("Later")',
  'button:has-text("Not now")',
  'div[role="dialog"] button',
  '[data-testid*="close"]'
];

async function closePopups(targetPage) {
  let closedAny = false;
  
  // Try all selectors multiple times to catch all popups
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const selector of popupSelectors) {
      try {
        // Get ALL matching elements (not just first)
        const elements = targetPage.locator(selector);
        const count = await elements.count();
        
        for (let i = 0; i < count; i++) {
          const el = elements.nth(i);
          if (await el.isVisible({ timeout: 1000 })) {
            await el.click();
            closedAny = true;
            console.log(`✅ Closed popup! (selector: ${selector})`);
            await targetPage.waitForTimeout(100);
          }
        }
      } catch {}
    }
    if (closedAny) await targetPage.waitForTimeout(300);
  }
  
  return closedAny;
}

// Initialize browser and page
async function initBrowser() {
  console.log('📱 Launching browser...');
  browserContext = await chromium.launchPersistentContext('./wa-session', {
    headless: false,
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
  
  await takeDebugScreenshot(page, 'after-goto-domcontentloaded');
  
  console.log('⏳ Waiting for page to load...');
  await page.waitForLoadState('networkidle', { timeout: 60000 });
  
  await takeDebugScreenshot(page, 'after-networkidle');
  
  // Wait for either QR code or chat list to be visible
  const initialLoadSelectors = [
    '[data-testid="qr-code"]',
    '[data-testid="chat-list"]',
    'canvas',
    '#main'
  ];
  let pageLoaded = false;
  for (const sel of initialLoadSelectors) {
    try {
      await page.locator(sel).waitFor({ timeout: 5000 });
      pageLoaded = true;
      break;
    } catch {}
  }
  
  await takeDebugScreenshot(page, 'before-popup-close');

  // Try closing popups multiple times
  for (let i = 0; i < 3; i++) {
    const closed = await closePopups(page);
    if (closed) await page.waitForTimeout(500);
  }
  
  await takeDebugScreenshot(page, 'after-popup-close');

  console.log('🔍 Checking initial login state...');
  isLoggedIn = await checkLoginState();
  
  await takeDebugScreenshot(page, `login-state-${isLoggedIn ? 'logged-in' : 'logged-out'}`);
  
  if (isLoggedIn) {
    console.log('♻️ Already logged in!');
  }

  // Start background loop to check for QR code and update status
  startBackgroundLoop();
}

async function checkLoginState() {
  if (!page || !browserContext || isLoggingOut) {
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
  if (!page || !browserContext || isSendingMessages || isLoggingOut) {
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
  if (!page || !browserContext || isSendingMessages || isLoggingOut) {
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
      await takeDebugScreenshot(page, 'qrcode-not-found');
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
      await takeDebugScreenshot(page, 'qrcode-extraction-failed');
    }

    return base64;
  } catch (e) {
    console.log('❌ Error getting QR code:', e.message);
    try {
      await takeDebugScreenshot(page, 'qrcode-error');
    } catch {}
    return null;
  }
}

function startBackgroundLoop() {
  setInterval(async () => {
    if (!page || !browserContext || isSendingMessages || isLoggingOut) {
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
    
    // Set flags to pause all operations
    isLoggingOut = true;
    isSendingMessages = true;
    
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
      let retries = 3;
      while (retries > 0) {
        try {
          fs.rmSync(sessionDir, {recursive: true, force: true});
          console.log('📁 Session directory cleared');
          break;
        } catch (e) {
          console.log(`⚠️ Retry deleting session (${retries} left)...`);
          retries--;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }
    
    // Reset state
    isLoggedIn = false;
    qrCodeBase64 = null;
    isLoggingOut = false;
    isSendingMessages = false;
    
    // Reinitialize browser
    console.log('🔄 Reinitializing browser...');
    await initBrowser();
    
    return res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    // Make sure to reset flags even if there's an error
    isLoggingOut = false;
    isSendingMessages = false;
    
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

  isSendingMessages = true;
  console.log('⏸️ Pausing background checks while sending messages...');
  const results = [];
  
  try {
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const targetPhone = contact.phone;
      const message = contact.message;
      const attachment = contact.attachment;

      console.log(`📤 [${i + 1}/${contacts.length}] Sending to ${targetPhone}...`);
      await closePopups(page);
      
      // Initialize variables for attachment handling
      let attachmentPath = null;
      let isTemporaryFile = false;
      
      try {
        let usedNativeUI = false;
        
        try {
          // Try native UI first
          console.log(`   Trying native UI first...`);
          
          await takeDebugScreenshot(page, `send-native-start-${targetPhone}`);
          
          // Step 1: Find and click the search box - wait properly!
          console.log(`   Finding search box...`);
          let searchBox = null;
          const searchSelectors = [
            '[data-testid="search-input"]',
            '[title*="Search"]',
            '[placeholder*="Search"]'
          ];
          
          for (const sel of searchSelectors) {
            try {
              const loc = page.locator(sel).first();
              await loc.waitFor({ state: 'visible', timeout: 3000 });
              searchBox = loc;
              console.log(`   ✓ Found search box with selector: ${sel}`);
              break;
            } catch {}
          }
          
          if (!searchBox) {
            await takeDebugScreenshot(page, `send-native-search-fail-${targetPhone}`);
            throw new Error('Could not find search box');
          }
          
          await searchBox.click();
          await page.waitForTimeout(300);
          
          await takeDebugScreenshot(page, `send-native-after-search-click-${targetPhone}`);
          
          // Step 2: Clear any existing text and type the phone number
          await page.keyboard.press('Control+A');
          await page.waitForTimeout(150);
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(150);
          await searchBox.fill(targetPhone);
          // Wait for search results properly!
          await page.waitForTimeout(1500);
          
          await takeDebugScreenshot(page, `send-native-after-type-phone-${targetPhone}`);
          
          // Step 3: Wait for contact to appear and click it
          console.log(`   Looking for contact...`);
          let contactResult = null;
          const contactSelectors = [
            `[data-testid="cell-frame-title"]`,
            `[data-testid="cell-frame"]`,
            `[role="listitem"]`
          ];
          
          for (const sel of contactSelectors) {
            try {
              const loc = page.locator(sel).first();
              await loc.waitFor({ state: 'visible', timeout: 5000 });
              contactResult = loc;
              console.log(`   ✓ Found contact with selector: ${sel}`);
              break;
            } catch {}
          }
          
          if (!contactResult) {
            console.log(`   Taking screenshot for debugging native UI failure...`);
            await takeDebugScreenshot(page, `send-native-contact-fail-${targetPhone}`);
            throw new Error('Could not find contact');
          }
          
          await contactResult.click();
          console.log(`   ✓ Contact selected`);
          
          await takeDebugScreenshot(page, `send-native-after-contact-select-${targetPhone}`);
          
          // Step 4: Wait for chat to load
          console.log(`   Waiting for chat to load...`);
          const messageInput = page.locator('div[contenteditable="true"]').first();
          await messageInput.waitFor({ timeout: 15000 });
          console.log(`   ✓ Chat loaded`);
          
          await takeDebugScreenshot(page, `send-native-chat-loaded-${targetPhone}`);
          
          // Close any popups just in case
          await closePopups(page);

          // Handle attachment if present
          if (attachment) {
            // Download only if not already downloaded
            if (!attachmentPath) {
              if (attachment.startsWith('http://') || attachment.startsWith('https://')) {
                console.log(`   🌐 Downloading file from URL: ${attachment}`);
                attachmentPath = await downloadFileFromUrl(attachment);
                isTemporaryFile = true;
                console.log(`   ✅ File downloaded to: ${attachmentPath}`);
              } else {
                // Local file
                attachmentPath = path.resolve(__dirname, attachment);
                if (!fs.existsSync(attachmentPath)) {
                  results.push({ phone: targetPhone, success: false, error: 'File not found' });
                  console.log(`❌ File not found: ${attachmentPath}`);
                  continue;
                }
              }
            }

            console.log(`   📁 Uploading file: ${attachmentPath}`);
            await takeDebugScreenshot(page, `before-attach-${targetPhone}`);
            
            // Step 1: Click Attach button
            const attachButton = page.locator('button[aria-label="Attach"]').first();
            await attachButton.waitFor({ state: 'visible', timeout: 10000 });
            await attachButton.click({ timeout: 10000 });
            console.log(`   ✅ Clicked Attach button`);
            await page.waitForTimeout(1500);
            await takeDebugScreenshot(page, `after-attach-click-${targetPhone}`);
            
            // Step 2: Find all buttons in menu and only click Document!
            const menuButtons = page.locator('div[role="listitem"] button, button[role="menuitem"]');
            const count = await menuButtons.count();
            console.log(`   Found ${count} menu buttons`);
            
            let documentClicked = false;
            for (let i = 0; i < count; i++) {
              const text = await menuButtons.nth(i).innerText({ timeout: 2000 }).catch(() => '');
              console.log(`   Button ${i} text: ${text}`);
              if (text.includes('Document')) {
                await menuButtons.nth(i).click({ timeout: 5000 });
                documentClicked = true;
                console.log(`   ✅ Clicked Document button!`);
                break;
              }
            }
            
            if (!documentClicked) {
              throw new Error('Could not find Document button in menu');
            }
            
            await page.waitForTimeout(2500);
            await takeDebugScreenshot(page, `after-document-click-${targetPhone}`);
            
            // Step 3: Find file input for DOCUMENTS (skip media ones)
            let fileInputFound = false;
            let fileInputs = await page.locator('input[type="file"]').all();
            console.log(`   Found ${fileInputs.length} file inputs`);
            
            for (let i = fileInputs.length - 1; i >= 0; i--) {
              try {
                const accept = await fileInputs[i].getAttribute('accept');
                console.log(`   File input ${i} accept: ${accept}`);
                // Skip inputs that only accept media types!
                if (accept && (accept.includes('image') || accept.includes('video') || accept.includes('audio'))) {
                  console.log(`   Skipping media file input ${i}`);
                  continue;
                }
                await fileInputs[i].setInputFiles(attachmentPath, { timeout: 15000 });
                fileInputFound = true;
                console.log(`   ✅ Attached using file input #${i}`);
                break;
              } catch {}
            }
            
            // If no non-media file input found, try all!
            if (!fileInputFound) {
              console.log(`   Trying all file inputs`);
              for (let i = fileInputs.length - 1; i >= 0; i--) {
                try {
                  await fileInputs[i].setInputFiles(attachmentPath, { timeout: 15000 });
                  fileInputFound = true;
                  console.log(`   ✅ Attached using file input #${i}`);
                  break;
                } catch {}
              }
            }
            
            if (!fileInputFound) {
              throw new Error('Could not attach file');
            }
            
            await page.waitForTimeout(3000);
            await takeDebugScreenshot(page, `after-attach-${targetPhone}`);
            
            // Add message if present
            if (message) {
              console.log(`   Typing message...`);
              try {
                await messageInput.fill(message);
              } catch (e) {
                await page.keyboard.type(message);
              }
              await page.waitForTimeout(300);
              await takeDebugScreenshot(page, `message-typed-${targetPhone}`);
            }
          } else {
            // Just text message
            console.log(`   Typing message...`);
            await messageInput.click();
            await page.waitForTimeout(300);
            await messageInput.fill(message);
            await page.waitForTimeout(300);
            await takeDebugScreenshot(page, `text-message-typed-${targetPhone}`);
          }
          
          await takeDebugScreenshot(page, `send-native-before-send-${targetPhone}`);

          // Press Enter to send
          console.log(`   Sending...`);
          await page.keyboard.press('Enter');
          await waitForMessageSent(page);
          
          await takeDebugScreenshot(page, `send-native-after-send-${targetPhone}`);

          results.push({ phone: targetPhone, success: true });
          console.log(`✅ Sent to ${targetPhone}\n`);
          usedNativeUI = true;
        } catch (nativeErr) {
          console.log(`   ✗ Native UI failed, falling back to send URL`);
          usedNativeUI = false;
        }
        
        if (!usedNativeUI) {
          // Fallback to send URL method
          console.log(`   Using send URL fallback...`);
          
          await takeDebugScreenshot(page, `send-fallback-start-${targetPhone}`);
          
          // Navigate to WhatsApp Web chat for this contact
          const url = `https://web.whatsapp.com/send?phone=${targetPhone}`;
          console.log(`   Navigating to: ${url}`);
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          
          await takeDebugScreenshot(page, `send-fallback-after-goto-${targetPhone}`);

          // Wait for WhatsApp Web to fully load!
          await page.waitForLoadState('networkidle', { timeout: 20000 });
          
          // Try closing popups multiple times
          for (let i = 0; i < 3; i++) {
            const closed = await closePopups(page);
            if (closed) await page.waitForTimeout(500);
          }
          
          await takeDebugScreenshot(page, `send-fallback-after-popup-close-${targetPhone}`);

          // Check for invalid number
          const invalid = await page.locator('text=Phone number shared via url is invalid')
            .isVisible({ timeout: 3000 })
            .catch(() => false);

          if (invalid) {
            await takeDebugScreenshot(page, `send-fallback-invalid-number-${targetPhone}`);
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
            await takeDebugScreenshot(page, `send-fallback-chat-fail-${targetPhone}`);
            results.push({ phone: targetPhone, success: false, error: 'Could not load chat' });
            console.log(`❌ Could not load chat: ${targetPhone}\n`);
            continue;
          }
          
          await takeDebugScreenshot(page, `send-fallback-chat-loaded-${targetPhone}`);

          const messageInput = page.locator('div[contenteditable="true"]').first();

          // Handle attachment if present
          if (attachment) {
            // Download only if not already downloaded
            if (!attachmentPath) {
              if (attachment.startsWith('http://') || attachment.startsWith('https://')) {
                console.log(`   🌐 Downloading file from URL: ${attachment}`);
                attachmentPath = await downloadFileFromUrl(attachment);
                isTemporaryFile = true;
                console.log(`   ✅ File downloaded to: ${attachmentPath}`);
              } else {
                // Local file
                attachmentPath = path.resolve(__dirname, attachment);
                if (!fs.existsSync(attachmentPath)) {
                  results.push({ phone: targetPhone, success: false, error: 'File not found' });
                  console.log(`❌ File not found: ${attachmentPath}`);
                  continue;
                }
              }
            }

            console.log(`   📁 Uploading file: ${attachmentPath}`);
            await takeDebugScreenshot(page, `before-attach-${targetPhone}`);
            
            // Step 1: Click Attach button
            const attachButton = page.locator('button[aria-label="Attach"]').first();
            await attachButton.waitFor({ state: 'visible', timeout: 10000 });
            await attachButton.click({ timeout: 10000 });
            console.log(`   ✅ Clicked Attach button`);
            await page.waitForTimeout(1500);
            await takeDebugScreenshot(page, `after-attach-click-${targetPhone}`);
            
            // Step 2: Find all buttons in menu and only click Document!
            const menuButtons = page.locator('div[role="listitem"] button, button[role="menuitem"]');
            const count = await menuButtons.count();
            console.log(`   Found ${count} menu buttons`);
            
            let documentClicked = false;
            for (let i = 0; i < count; i++) {
              const text = await menuButtons.nth(i).innerText({ timeout: 2000 }).catch(() => '');
              console.log(`   Button ${i} text: ${text}`);
              if (text.includes('Document')) {
                await menuButtons.nth(i).click({ timeout: 5000 });
                documentClicked = true;
                console.log(`   ✅ Clicked Document button!`);
                break;
              }
            }
            
            if (!documentClicked) {
              throw new Error('Could not find Document button in menu');
            }
            
            await page.waitForTimeout(2500);
            await takeDebugScreenshot(page, `after-document-click-${targetPhone}`);
            
            // Step 3: Find file input for DOCUMENTS (skip media ones)
            let fileInputFound = false;
            let fileInputs = await page.locator('input[type="file"]').all();
            console.log(`   Found ${fileInputs.length} file inputs`);
            
            for (let i = fileInputs.length - 1; i >= 0; i--) {
              try {
                const accept = await fileInputs[i].getAttribute('accept');
                console.log(`   File input ${i} accept: ${accept}`);
                // Skip inputs that only accept media types!
                if (accept && (accept.includes('image') || accept.includes('video') || accept.includes('audio'))) {
                  console.log(`   Skipping media file input ${i}`);
                  continue;
                }
                await fileInputs[i].setInputFiles(attachmentPath, { timeout: 15000 });
                fileInputFound = true;
                console.log(`   ✅ Attached using file input #${i}`);
                break;
              } catch {}
            }
            
            // If no non-media file input found, try all!
            if (!fileInputFound) {
              console.log(`   Trying all file inputs`);
              for (let i = fileInputs.length - 1; i >= 0; i--) {
                try {
                  await fileInputs[i].setInputFiles(attachmentPath, { timeout: 15000 });
                  fileInputFound = true;
                  console.log(`   ✅ Attached using file input #${i}`);
                  break;
                } catch {}
              }
            }
            
            if (!fileInputFound) {
              throw new Error('Could not attach file');
            }
            
            await page.waitForTimeout(3000);
            await takeDebugScreenshot(page, `after-attach-${targetPhone}`);
            
            // Add message if present
            if (message) {
              console.log(`   Typing message...`);
              try {
                await messageInput.fill(message);
              } catch (e) {
                await page.keyboard.type(message);
              }
              await page.waitForTimeout(300);
              await takeDebugScreenshot(page, `message-typed-${targetPhone}`);
            }
          } else {
            // Just text message
            console.log(`   Typing message...`);
            await messageInput.waitFor({ timeout: 10000 });
            await messageInput.click();
            await page.waitForTimeout(300);
            await messageInput.fill(message);
            await page.waitForTimeout(300);
            await takeDebugScreenshot(page, `text-message-typed-${targetPhone}`);
          }
          
          await takeDebugScreenshot(page, `send-fallback-before-send-${targetPhone}`);

          // Press Enter to send
          console.log(`   Sending...`);
          await page.keyboard.press('Enter');
          await waitForMessageSent(page);
          
          await takeDebugScreenshot(page, `send-fallback-after-send-${targetPhone}`);

          results.push({ phone: targetPhone, success: true });
          console.log(`✅ Sent to ${targetPhone}\n`);
        }

      } catch (err) {
        console.error(`❌ Failed for ${targetPhone}:`, err.message);
        try {
          await takeDebugScreenshot(page, `send-error-${targetPhone}`);
        } catch {}
        results.push({ phone: targetPhone, success: false, error: err.message });
      } finally {
        // Clean up temporary file if it exists
        if (isTemporaryFile && attachmentPath && fs.existsSync(attachmentPath)) {
          try {
            fs.unlinkSync(attachmentPath);
            console.log(`   🗑️ Cleaned up temporary file: ${attachmentPath}`);
          } catch (cleanErr) {
            console.log(`   ⚠️ Failed to clean up temporary file: ${cleanErr.message}`);
          }
        }
      }

      // Add delay between messages to avoid being rate-limited
      if (i < contacts.length - 1) {
        await page.waitForTimeout(1000);
      }
    }
  } finally {
    isSendingMessages = false;
    console.log('▶️ Resuming background checks...');
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
