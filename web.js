// Disable output buffering
process.stdout._handle.setBlocking(true);

const {
  chromium
} = require('playwright');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting WhatsApp bot...');

(async () => {
  console.log('📱 Launching browser...');
  const context = await chromium.launchPersistentContext('./wa-session', {
    headless: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

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

  await page.goto('https://web.whatsapp.com/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(6000);

  // Try to close any popups (What's new, notifications, etc.)
  const popupSelectors = [
    'button[aria-label="Close"]',
    'div[role="button"][aria-label*="close" i]',
    'svg[data-icon="x"]'
  ];

  for (const selector of popupSelectors) {
    try {
      const popup = await page.locator(selector).first();
      if (await popup.isVisible({ timeout: 3000 })) {
        await popup.click();
        console.log('✅ Closed popup!');
        await page.waitForTimeout(1000);
        break;
      }
    } catch {}
  }

  console.log('🔍 Checking login state...');

  // ✅ safe login detection - skip interactive input, just wait for QR or logged in
  let loggedIn = false;
  for (let i = 0; i < 60; i++) {
    try {
      if (await page.locator('[data-testid="chat-list"]').isVisible()) {
        loggedIn = true;
        console.log('♻️ Already logged in!');
        break;
      }
    } catch {}
    await page.waitForTimeout(1000);
  }

  if (!loggedIn) {
    console.log('⚠️ Login required! QR code screenshot saved to qr-code.png');
    try {
      await page.waitForSelector('canvas', { timeout: 30000 });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: './qr-code.png', fullPage: true });
    } catch (e) {
      console.log('⚠️ Could not save QR code screenshot:', e.message);
    }
    
    console.log('⏳ Waiting for login (scan QR code with WhatsApp)...');
    
    // Wait up to 5 minutes for manual login
    for (let i = 0; i < 300; i++) {
      try {
        if (await page.locator('[data-testid="chat-list"]').isVisible()) {
          loggedIn = true;
          console.log('✅ Login successful!');
          break;
        }
      } catch {}
      await page.waitForTimeout(1000);
    }
    
    if (!loggedIn) {
      console.log('❌ Login timeout! Exiting.');
      await context.close();
      process.exit(1);
    }
  }

  console.log('🚀 WhatsApp ready\n');

  const contactsPath = path.join(__dirname, 'contact.json');
  const contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf8'));

  console.log(`📋 Loaded ${contacts.length} contacts to send messages\n`);

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const targetPhone = contact.phone;
    const message = contact.message;
    const attachment = contact.attachment;

    console.log(`📤 [${i + 1}/${contacts.length}] Sending to ${targetPhone}...`);

    let url;
    if (attachment) {
      url = `https://web.whatsapp.com/send?phone=${targetPhone}`;
    } else {
      url = `https://web.whatsapp.com/send?phone=${targetPhone}&text=${encodeURIComponent(message)}`;
    }
    await page.goto(url);

    try {
      await page.waitForLoadState('domcontentloaded');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(10000);

      // Close any popups (What's new, notifications, etc.)
      for (const selector of popupSelectors) {
        try {
          const popup = await page.locator(selector).first();
          if (await popup.isVisible({ timeout: 3000 })) {
            await popup.click();
            console.log('✅ Closed popup!');
            await page.waitForTimeout(1000);
            break;
          }
        } catch {}
      }

      // Debug screenshot
      try {
        await page.screenshot({ path: `debug-navigate-${targetPhone}.png` });
        console.log(`📸 Debug screenshot saved to debug-navigate-${targetPhone}.png`);
      } catch {}

      const invalid = await page.locator('text=Phone number shared via url is invalid')
        .isVisible()
        .catch(() => false);

      if (invalid) {
        console.log(`❌ Invalid number: ${targetPhone}\n`);
        continue;
      }

      // Wait for either chat panel OR message input box
      let readyToSend = false;
      const selectors = [
        '[data-testid="conversation-panel-messages"]',
        '#main',
        '[data-testid="conversation-panel"]',
        'div[role="main"]',
        'div[contenteditable="true"]'
      ];

      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, { timeout: 10000 });
          readyToSend = true;
          console.log(`✅ Page ready using selector: ${selector}`);
          break;
        } catch (e) {
          console.log(`⚠️ Selector ${selector} failed, trying next...`);
        }
      }

      if (!readyToSend) {
        console.log(`❌ Could not detect page ready for ${targetPhone}, taking screenshot...`);
        try {
          await page.screenshot({ path: `error-page-load-${targetPhone}.png` });
          console.log(`📸 Screenshot saved to error-page-load-${targetPhone}.png`);
        } catch {}
        continue;
      }

      if (attachment) {
        const fullPath = path.resolve(__dirname, attachment);
        
        if (!fs.existsSync(fullPath)) {
          console.log(`❌ File not found: ${fullPath}`);
          continue;
        }

        console.log(`📁 Uploading file: ${fullPath}`);
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(fullPath);
        await page.waitForTimeout(6000);

        if (message) {
          const allInputs = page.locator('div[contenteditable="true"]');
          const count = await allInputs.count();
          
          for (let j = 0; j < count; j++) {
            const input = allInputs.nth(j);
            try {
              await input.waitFor({ timeout: 3000 });
              await input.click();
              await page.waitForTimeout(300);
              await input.fill(message);
              await page.waitForTimeout(500);
              break;
            } catch {}
          }
        }

        await page.keyboard.press('Enter');
      } else {
        const inputBox = page.locator('div[contenteditable="true"]').first();
        await inputBox.waitFor({
          timeout: 20000
        });

        await inputBox.click();
        await page.waitForTimeout(500);

        await inputBox.focus();
        await page.waitForTimeout(200);

        await page.keyboard.press('Enter');
      }

      console.log(`✅ Sent to ${targetPhone}\n`);
      await page.waitForTimeout(4000);
    } catch (err) {
      console.log(`❌ Failed for ${targetPhone}`);
      console.log('Reason:', err.message, '\n');
      // Take screenshot for debugging
      try {
        await page.screenshot({ path: `error-${targetPhone}.png` });
        console.log(`📸 Screenshot saved to error-${targetPhone}.png`);
      } catch {}
    }
  }

  console.log('🎉 All messages sent!');

})();