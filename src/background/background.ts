// Background script for Email Tracker Extension
// Converted from background.js to TypeScript

// Storage key for login history
const STORAGE_KEY = 'emailMappings';

// Domain utilities for smart domain grouping
function getRootDomain(domain: string): string {
  if (!domain) return domain;

  // Remove www if present
  let cleanDomain = domain.toLowerCase().replace(/^www\./, '');

  // Split by dots
  const parts = cleanDomain.split('.');

  if (parts.length <= 2) {
    return cleanDomain; // Already a root domain
  }

  // Check if it's a known separate TLD (like co.uk)
  const separateTlds = new Set([
    'co.uk', 'co.jp', 'co.kr', 'com.au', 'co.nz', 'co.za', 'com.br', 'com.mx',
    'co.in', 'co.ca', 'com.sg', 'com.hk', 'co.th', 'com.tw', 'com.tr', 'com.ar'
  ]);

  const potentialTld = parts.slice(-2).join('.');
  if (separateTlds.has(potentialTld)) {
    return parts.slice(-3).join('.');
  }

  // For regular TLDs, return the last two parts
  return parts.slice(-2).join('.');
}

// Initialize storage
chrome.runtime.onInstalled.addListener(() => {
  console.log('Email Tracker Extension installed');
  chrome.storage.local.set({
    emailMappings: {},
    trackingSettings: {
      isPaused: false,
      disabledSites: []
    }
  });
});

// Monitor completed web requests
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    // Filter for API-like URLs that might contain user data
    const apiPatterns = [/\/api\//, /\/user/, /\/profile/, /\/account/, /\/me/, /\/auth/, /\/oauth/, /\/accounts\.google/];
    const isApiUrl = apiPatterns.some(pattern => pattern.test(details.url));

    // Special handling for Google OAuth endpoints
    const googlePatterns = [/accounts\.google\.com/, /www\.googleapis\.com/, /oauth2/];
    const isGoogleOAuth = googlePatterns.some(pattern => pattern.test(details.url));

    if ((isApiUrl || isGoogleOAuth) && details.statusCode === 200) {
      console.log('API/Google OAuth Request detected:', details.url);

      // Check if tracking is paused
      const result = await chrome.storage.local.get(['trackingSettings']);
      const settings = result.trackingSettings || { isPaused: false, disabledSites: [] };

      if (settings.isPaused) {
        console.log('Tracking is paused, skipping API analysis');
        return;
      }

      try {
        // Fetch the response to analyze it for email data
        await analyzeResponseForEmail(details);
      } catch (error) {
        console.error('Error analyzing response:', error);
      }
    }
  },
  {
    urls: ['<all_urls>'],
    types: ['xmlhttprequest']
  }
);

// Analyze API response for email data
async function analyzeResponseForEmail(details: any) {
  try {
    // Get current tab to access cookies
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];

    if (!currentTab || !currentTab.url) return;

    // Fetch the API endpoint with credentials
    const response = await fetch(details.url, {
      method: 'GET',
      credentials: 'include', // Include cookies for authentication
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Cache-Control': 'no-cache'
      }
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type');

      // Process JSON responses
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();

        // Try Google OAuth extraction first (for Google login flows)
        const googleEmails = extractGoogleOAuthData(data);
        const generalEmails = extractEmailsFromResponse(data);

        // Combine and deduplicate
        const allEmails = [...new Set([...googleEmails, ...generalEmails])];

        for (const email of allEmails) {
          if (isValidEmail(email)) {
            console.log('Email found:', email, 'from URL:', details.url);

            // Get the domain from current tab and apply smart grouping
            const originalDomain = new URL(currentTab.url).hostname;
            const rootDomain = getRootDomain(originalDomain);

            console.log('Domain mapping:', { original: originalDomain, root: rootDomain });

            // Store the email mapping using root domain
            await storeEmailMapping(rootDomain, email, details.url);
          }
        }
      }
      // Also try to extract from HTML responses (for some APIs that return HTML)
      else if (contentType && contentType.includes('text/html')) {
        const html = await response.text();
        const emails = extractEmailsFromHTML(html);

        for (const email of emails) {
          if (isValidEmail(email)) {
            console.log('Email found in HTML:', email, 'from URL:', details.url);

            // Get the domain from current tab and apply smart grouping
            const originalDomain = new URL(currentTab.url).hostname;
            const rootDomain = getRootDomain(originalDomain);

            console.log('Domain mapping:', { original: originalDomain, root: rootDomain });

            // Store the email mapping using root domain
            await storeEmailMapping(rootDomain, email, details.url);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error fetching API response:', error);
  }
}

// Extract emails from JSON response (enhanced with Gmail detection)
function extractEmailsFromResponse(data: any): string[] {
  const emails: string[] = [];

  if (!data) return emails;

  // First, try Gmail-specific extraction
  const gmailEmails = extractGmailFromJSON(data);
  emails.push(...gmailEmails);

  // Then try general email extraction for non-Gmail addresses
  const allEmails = extractAllEmailsFromJSON(data);

  // Filter out Gmail addresses (already captured) and invalid emails
  const nonGmailEmails = allEmails.filter(email =>
    !isGmailAddress(email) && isValidEmail(email)
  );

  emails.push(...nonGmailEmails);

  return [...new Set(emails)]; // Remove duplicates
}

// Extract all emails from JSON (general purpose)
function extractAllEmailsFromJSON(data: any): string[] {
  const emails: string[] = [];

  // Common email field names
  const emailFields = ['email', 'username', 'userEmail', 'login', 'account', 'user', 'mail'];

  // Search in top-level fields
  for (const field of emailFields) {
    if (data[field] && typeof data[field] === 'string') {
      const emailMatches = data[field].match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
      if (emailMatches) {
        emails.push(...emailMatches);
      }
    }
  }

  // Search recursively in nested objects
  const nestedEmails = searchNestedForEmails(data);
  emails.push(...nestedEmails);

  return emails;
}

// Extract emails from HTML content
function extractEmailsFromHTML(html: string): string[] {
  const emails: string[] = [];

  if (!html) return emails;

  // Try Gmail extraction first
  const gmailEmails = extractGmailFromHTML(html);
  emails.push(...gmailEmails);

  // Then extract all emails
  const allEmails = extractAllEmailsFromHTML(html);

  // Filter out Gmail addresses (already captured) and invalid emails
  const nonGmailEmails = allEmails.filter(email =>
    !isGmailAddress(email) && isValidEmail(email)
  );

  emails.push(...nonGmailEmails);

  return [...new Set(emails)]; // Remove duplicates
}

// Extract all emails from HTML
function extractAllEmailsFromHTML(html: string): string[] {
  const emails: string[] = [];

  // Multiple patterns to catch emails in different contexts
  const patterns = [
    // JSON in script tags
    /"email"\s*:\s*"([^"]+@[^"]+)"/gi,
    /"email"\s*:\s*'([^']+@[^']+)'/gi,
    /'email'\s*:\s*'([^']+@[^']+)'/gi,
    /'email'\s*:\s*"([^"]+@[^"]+)"/gi,

    // Common HTML attributes
    /data-email="([^"]+@[^"]+)"/gi,
    /data-email='([^']+@[^']+)'/gi,

    // General email pattern in text
    /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) {
        emails.push(match[1]);
      }
    }
  });

  return emails;
}

// Gmail-specific extraction functions
function extractGmailFromJSON(data: any): string[] {
  const gmails: string[] = [];

  if (!data) return gmails;

  // Gmail domains to look for
  const gmailDomains = ['gmail.com', 'googlemail.com'];

  // Search recursively
  searchJSONForGmail(data, gmails, gmailDomains);

  return [...new Set(gmails)];
}

// Enhanced Google OAuth response extraction
function extractGoogleOAuthData(data: any): string[] {
  const emails: string[] = [];

  if (!data) return emails;

  // Google OAuth specific patterns
  const googlePatterns = [
    // Standard Google user info
    'email',
    'emailAddress',
    'verified_email',
    // Google profile data
    'emails',
    'emailAddresses',
    // OAuth response fields
    'user',
    'profile',
    'account'
  ];

  // Check top-level fields
  for (const pattern of googlePatterns) {
    if (data[pattern]) {
      if (typeof data[pattern] === 'string') {
        const emailMatch = data[pattern].match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) emails.push(emailMatch[1]);
      } else if (Array.isArray(data[pattern])) {
        data[pattern].forEach((item: any) => {
          if (item.email) {
            emails.push(item.email);
          }
        });
      } else if (typeof data[pattern] === 'object') {
        // Handle nested objects like {email: "user@gmail.com", verified: true}
        if (data[pattern].email) {
          emails.push(data[pattern].email);
        }
      }
    }
  }

  return emails;
}

function extractGmailFromHTML(html: string): string[] {
  const gmails: string[] = [];

  if (!html) return gmails;

  // Gmail domains to look for
  const gmailDomains = ['gmail.com', 'googlemail.com'];

  // Patterns specifically for Gmail in HTML
  const patterns = [
    /\b([a-zA-Z0-9._%+-]+@(gmail|googlemail)\.com)\b/gi,
    /"email"\s*:\s*"([^"]*@(gmail|googlemail)\.com[^"]*)"/gi,
    /"email"\s*:\s*'([^']*@(gmail|googlemail)\.com[^']*)'/gi,
    /data-email="([^"]*@(gmail|googlemail)\.com[^"]*)"/gi,
    /data-email='([^']*@(gmail|googlemail)\.com[^']*)'/gi
  ];

  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) {
        gmails.push(match[1]);
      }
    }
  });

  return [...new Set(gmails)];
}

function searchJSONForGmail(obj: any, results: string[], gmailDomains: string[]) {
  if (typeof obj === 'string') {
    // Check if string contains Gmail
    const emailMatches = obj.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatches) {
      emailMatches.forEach(email => {
        if (gmailDomains.some(domain => email.toLowerCase().endsWith(`@${domain}`))) {
          results.push(email);
        }
      });
    }
  } else if (Array.isArray(obj)) {
    obj.forEach(item => searchJSONForGmail(item, results, gmailDomains));
  } else if (obj && typeof obj === 'object') {
    // Check common email fields first
    const emailFields = ['email', 'username', 'userEmail', 'login', 'account', 'user'];
    for (const field of emailFields) {
      if (obj[field] && typeof obj[field] === 'string') {
        const emailMatches = obj[field].match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        if (emailMatches) {
          emailMatches.forEach(email => {
            if (gmailDomains.some(domain => email.toLowerCase().endsWith(`@${domain}`))) {
              results.push(email);
            }
          });
        }
      }
    }

    // Search all fields recursively
    Object.values(obj).forEach(value => {
      if (value && typeof value === 'object') {
        searchJSONForGmail(value, results, gmailDomains);
      }
    });
  }
}

// Check if email is Gmail
function isGmailAddress(email: string): boolean {
  const gmailDomains = ['gmail.com', 'googlemail.com'];
  return gmailDomains.some(domain => email.toLowerCase().endsWith(`@${domain}`));
}

// Search recursively for all emails in nested objects
function searchNestedForEmails(obj: any): string[] {
  const emails: string[] = [];

  if (typeof obj === 'string') {
    const emailMatches = obj.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatches) {
      emails.push(...emailMatches);
    }
  } else if (Array.isArray(obj)) {
    obj.forEach(item => {
      emails.push(...searchNestedForEmails(item));
    });
  } else if (obj && typeof obj === 'object') {
    Object.values(obj).forEach(value => {
      if (value && typeof value === 'object') {
        emails.push(...searchNestedForEmails(value));
      }
    });
  }

  return emails;
}

// Validate email (filter out common non-user emails)
function isValidEmail(email: string): boolean {
  const invalidPatterns = [
    /noreply/,
    /no-reply/,
    /support/,
    /admin/,
    /test/,
    /example/,
    /placeholder/,
    /your.email/
  ];

  const isInvalid = invalidPatterns.some(pattern => pattern.test(email.toLowerCase()));
  return !isInvalid && email.includes('@') && email.length > 5;
}

// Store email mapping for domain
async function storeEmailMapping(domain: string, email: string, apiUrl: string) {
  try {
    const mappings = await chrome.storage.local.get(['emailMappings']);
    const storage = mappings.emailMappings || {};

    if (!storage[domain]) {
      storage[domain] = [];
    }

    const existingEntry = storage[domain].find((entry: any) => entry.email === email);

    if (!existingEntry) {
      storage[domain].unshift({
        email: email,
        apiUrl: apiUrl,
        timestamp: Date.now(),
        count: 1
      });

      if (storage[domain].length > 5) {
        storage[domain] = storage[domain].slice(0, 5);
      }

      await chrome.storage.local.set({ emailMappings: storage });
      console.log('Email mapping stored:', { domain, email });
    } else {
      existingEntry.timestamp = Date.now();
      existingEntry.count += 1;
    }
  } catch (error) {
    console.error('Error storing email mapping:', error);
  }
}

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_EMAIL_MAPPINGS') {
    chrome.storage.local.get(['emailMappings'], (result) => {
      sendResponse({ mappings: result.emailMappings || {} });
    });
    return true; // Keep message channel open
  }

  if (message.type === 'CLEAR_MAPPINGS') {
    chrome.storage.local.set({ emailMappings: {} }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'LOGIN_DETECTED') {
    const { email, website, timestamp, url, method } = message.data;

    // Get current mappings
    chrome.storage.local.get(['emailMappings'], (result) => {
      const mappings = result.emailMappings || {};

      if (!mappings[website]) {
        mappings[website] = [];
      }

      // Check if email already exists for this domain
      const existingEntry = mappings[website].find((entry: any) => entry.email === email);

      if (!existingEntry) {
        // Add new entry
        mappings[website].unshift({
          email: email,
          apiUrl: url,
          timestamp: timestamp,
          count: 1
        });

        // Keep only last 5 emails per domain
        if (mappings[website].length > 5) {
          mappings[website] = mappings[website].slice(0, 5);
        }

        // Save updated mappings
        chrome.storage.local.set({ emailMappings: mappings }, () => {
          console.log('Login detected and stored:', { email, website, method });
          sendResponse({ success: true });
        });
      } else {
        // Update existing entry
        existingEntry.timestamp = timestamp;
        existingEntry.count += 1;

        chrome.storage.local.set({ emailMappings: mappings }, () => {
          console.log('Login count updated:', { email, website, newCount: existingEntry.count });
          sendResponse({ success: true });
        });
      }
    });
    return true;
  }

  // Handle other message types (ADD_EMAIL, DELETE_EMAIL, etc.)
  if (message.type === 'ADD_EMAIL') {
    const { domain, email } = message.data;
    chrome.storage.local.get(['emailMappings'], (result) => {
      const mappings = result.emailMappings || {};

      if (!mappings[domain]) {
        mappings[domain] = [];
      }

      // Check if email already exists
      const existingEntry = mappings[domain].find((entry: any) => entry.email === email);

      if (!existingEntry) {
        mappings[domain].unshift({
          email: email,
          apiUrl: `manual://${domain}`,
          timestamp: Date.now(),
          count: 1
        });

        if (mappings[domain].length > 5) {
          mappings[domain] = mappings[domain].slice(0, 5);
        }

        chrome.storage.local.set({ emailMappings: mappings }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: 'Email already exists for this domain' });
      }
    });
    return true;
  }

  if (message.type === 'DELETE_EMAIL') {
    const { domain, email } = message.data;
    chrome.storage.local.get(['emailMappings'], (result) => {
      const mappings = result.emailMappings || {};

      if (mappings[domain]) {
        mappings[domain] = mappings[domain].filter((entry: any) => entry.email !== email);

        if (mappings[domain].length === 0) {
          delete mappings[domain];
        }

        chrome.storage.local.set({ emailMappings: mappings }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: 'Domain not found' });
      }
    });
    return true;
  }

  if (message.type === 'DELETE_DOMAIN') {
    const { domain } = message.data;
    chrome.storage.local.get(['emailMappings'], (result) => {
      const mappings = result.emailMappings || {};

      if (mappings[domain]) {
        delete mappings[domain];
        chrome.storage.local.set({ emailMappings: mappings }, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: 'Domain not found' });
      }
    });
    return true;
  }

  if (message.type === 'EDIT_EMAIL') {
    const { domain, oldEmail, newEmail } = message.data;
    chrome.storage.local.get(['emailMappings'], (result) => {
      const mappings = result.emailMappings || {};

      if (mappings[domain]) {
        const emailIndex = mappings[domain].findIndex((entry: any) => entry.email === oldEmail);

        if (emailIndex >= 0) {
          mappings[domain][emailIndex].email = newEmail;
          mappings[domain][emailIndex].timestamp = Date.now();

          chrome.storage.local.set({ emailMappings: mappings }, () => {
            sendResponse({ success: true });
          });
        } else {
          sendResponse({ success: false, error: 'Email not found' });
        }
      } else {
        sendResponse({ success: false, error: 'Domain not found' });
      }
    });
    return true;
  }

  if (message.type === 'CHECK_NEW_ACCOUNT') {
    const { domain, email } = message.data;
    chrome.storage.local.get(['emailMappings'], (result) => {
      const mappings = result.emailMappings || {};

      if (mappings[domain]) {
        const existingEntry = mappings[domain].find((entry: any) => entry.email === email);
        const isNew = !existingEntry;

        sendResponse({ isNew });
      } else {
        sendResponse({ isNew: true });
      }
    });
    return true;
  }

  if (message.type === 'GET_TRACKING_STATUS') {
    chrome.storage.local.get(['trackingSettings'], (result) => {
      const settings = result.trackingSettings || { isPaused: false, disabledSites: [] };
      sendResponse({ isPaused: settings.isPaused });
    });
    return true;
  }

  if (message.type === 'TOGGLE_TRACKING') {
    chrome.storage.local.get(['trackingSettings'], (result) => {
      const settings = result.trackingSettings || { isPaused: false, disabledSites: [] };
      settings.isPaused = !settings.isPaused;

      chrome.storage.local.set({ trackingSettings: settings }, () => {
        sendResponse({ success: true, isPaused: settings.isPaused });
      });
    });
    return true;
  }

  // Default case - no matching message type
  return false;
});