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

// Monitor completed web requests for OAuth redirects (captures emails during login process)
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    // Focus on OAuth and login-related URLs that might contain email in parameters
    const oauthPatterns = [
      /\/oauth/,
      /\/auth/,
      /\/login/,
      /\/signin/,
      /accounts\.google\.com/,
      /oauth2/,
      /openid/,
      /saml/
    ];
    const isOAuthUrl = oauthPatterns.some(pattern => pattern.test(details.url));

    if (isOAuthUrl && details.statusCode === 200) {
      console.log('OAuth/Login Request detected:', details.url);

      // Check if tracking is paused
      const result = await chrome.storage.local.get(['trackingSettings']);
      const settings = result.trackingSettings || { isPaused: false, disabledSites: [] };

      if (settings.isPaused) {
        console.log('Tracking is paused, skipping OAuth analysis');
        return;
      }

      try {
        // Extract email from OAuth URL parameters (more reliable than response body)
        await analyzeOAuthUrlForEmail(details);
      } catch (error) {
        console.error('Error analyzing OAuth URL:', error);
      }
    }
  },
  {
    urls: ['<all_urls>'],
    types: ['main_frame', 'sub_frame']
  }
);

// Analyze OAuth URLs for email parameters (captures emails during login process)
async function analyzeOAuthUrlForEmail(details: any) {
  try {
    // Extract email from URL parameters in OAuth redirects
    const url = new URL(details.url);
    const urlParams = url.searchParams;

    // Common OAuth parameter names that might contain email
    const emailParamNames = [
      'email',
      'user_email',
      'email_address',
      'login',
      'username',
      'user',
      'account',
      'profile',
      'identity',
      'email_verified',
      'email_confirmed'
    ];

    let capturedEmail: string | null = null;

    // Check each parameter for email patterns
    for (const paramName of emailParamNames) {
      const paramValue = urlParams.get(paramName);
      if (paramValue) {
        const emailMatch = paramValue.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch && isValidEmail(emailMatch[0])) {
          capturedEmail = emailMatch[0];
          break;
        }
      }
    }

    // Also check all parameters for email patterns (in case email is in unexpected param)
    if (!capturedEmail) {
      for (const [key, value] of urlParams.entries()) {
        if (value && value.includes('@')) {
          const emailMatch = value.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (emailMatch && isValidEmail(emailMatch[0])) {
            capturedEmail = emailMatch[0];
            break;
          }
        }
      }
    }

    if (capturedEmail) {
      console.log('Email found in OAuth URL:', capturedEmail, 'from URL:', details.url);

      // Get the current tab to determine the domain
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const currentTab = tabs[0];

      if (currentTab && currentTab.url) {
        const originalDomain = new URL(currentTab.url).hostname;
        const rootDomain = getRootDomain(originalDomain);

        console.log('OAuth Domain mapping:', { original: originalDomain, root: rootDomain });

        // Store the email mapping using root domain
        await storeEmailMapping(rootDomain, capturedEmail, details.url);
      }
    }
  } catch (error) {
    console.error('Error analyzing OAuth URL:', error);
  }
}

// Analyze API response for email data - DISABLED to avoid capturing encrypted emails after login
// async function analyzeResponseForEmail(details: any) {
//   try {
//     // Get current tab to access cookies
//     const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
//     const currentTab = tabs[0];

//     if (!currentTab || !currentTab.url) return;

//     // Fetch the API endpoint with credentials
//     const response = await fetch(details.url, {
//       method: 'GET',
//       credentials: 'include', // Include cookies for authentication
//       headers: {
//         'Accept': 'application/json, text/plain, */*',
//         'Cache-Control': 'no-cache'
//       }
//     });

//     if (response.ok) {
//       const contentType = response.headers.get('content-type');

//       // Process JSON responses
//       if (contentType && contentType.includes('application/json')) {
//         const data = await response.json();

//         // Try Google OAuth extraction first (for Google login flows)
//         const googleEmails = extractGoogleOAuthData(data);
//         const generalEmails = extractEmailsFromResponse(data);

//         // Combine and deduplicate
//         const allEmails = [...new Set([...googleEmails, ...generalEmails])];

//         for (const email of allEmails) {
//           if (isValidEmail(email)) {
//             console.log('Email found:', email, 'from URL:', details.url);

//             // Get the domain from current tab and apply smart grouping
//             const originalDomain = new URL(currentTab.url).hostname;
//             const rootDomain = getRootDomain(originalDomain);

//             console.log('Domain mapping:', { original: originalDomain, root: rootDomain });

//             // Store the email mapping using root domain
//             await storeEmailMapping(rootDomain, email, details.url);
//           }
//         }
//       }
//       // Also try to extract from HTML responses (for some APIs that return HTML)
//       else if (contentType && contentType.includes('text/html')) {
//         const html = await response.text();
//         const emails = extractEmailsFromHTML(html);

//         for (const email of emails) {
//           if (isValidEmail(email)) {
//             console.log('Email found in HTML:', email, 'from URL:', details.url);

//             // Get the domain from current tab and apply smart grouping
//             const originalDomain = new URL(currentTab.url).hostname;
//             const rootDomain = getRootDomain(originalDomain);

//             console.log('Domain mapping:', { original: originalDomain, root: rootDomain });

//             // Store the email mapping using root domain
//             await storeEmailMapping(rootDomain, email, details.url);
//           }
//         }
//       }
//     }
//   } catch (error) {
//     console.error('Error fetching API response:', error);
//   }
// }

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

// Store email mapping for domain (only keep last used email per domain)
async function storeEmailMapping(domain: string, email: string, apiUrl: string) {
  try {
    const mappings = await chrome.storage.local.get(['emailMappings']);
    const storage = mappings.emailMappings || {};

    if (!storage[domain]) {
      storage[domain] = [];
    }

    const existingEntry = storage[domain].find((entry: any) => entry.email === email);

    if (!existingEntry) {
      // Add new entry (track every login, don't replace)
      storage[domain].unshift({
        email: email,
        apiUrl: apiUrl,
        timestamp: Date.now(),
        count: 1
      });

      // Keep only last 10 emails per domain to avoid storage bloat
      if (storage[domain].length > 10) {
        storage[domain] = storage[domain].slice(0, 10);
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
  console.log('Background received message:', message.type, message.data);
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
    console.log('Processing LOGIN_DETECTED message:', message.data);
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
        // Add new entry (track every login, don't replace)
        mappings[website].unshift({
          email: email,
          apiUrl: url,
          timestamp: timestamp,
          count: 1
        });

        // Keep only last 10 emails per domain to avoid storage bloat
        if (mappings[website].length > 10) {
          mappings[website] = mappings[website].slice(0, 10);
        }

        // Save updated mappings
        chrome.storage.local.set({ emailMappings: mappings }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error saving email mappings:', chrome.runtime.lastError);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            console.log('Login detected and stored:', { email, website, method });
            sendResponse({ success: true });
          }
        });
      } else {
        // Update existing entry
        existingEntry.timestamp = timestamp;
        existingEntry.count += 1;

        chrome.storage.local.set({ emailMappings: mappings }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error updating email count:', chrome.runtime.lastError);
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            console.log('Login count updated:', { email, website, newCount: existingEntry.count });
            sendResponse({ success: true });
          }
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
        // Add new entry (track every login, don't replace)
        mappings[domain].unshift({
          email: email,
          apiUrl: `manual://${domain}`,
          timestamp: Date.now(),
          count: 1
        });

        // Keep only last 10 emails per domain to avoid storage bloat
        if (mappings[domain].length > 10) {
          mappings[domain] = mappings[domain].slice(0, 10);
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

  if (message.type === 'EDIT_DOMAIN') {
    const { oldDomain, newDomain } = message.data;
    chrome.storage.local.get(['emailMappings'], (result) => {
      const mappings = result.emailMappings || {};

      if (mappings[oldDomain]) {
        // Create new domain entry with all emails from old domain
        mappings[newDomain] = mappings[oldDomain];
        // Remove old domain
        delete mappings[oldDomain];

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
    const { domain, oldEmail, newEmail, description } = message.data;
    chrome.storage.local.get(['emailMappings'], (result) => {
      const mappings = result.emailMappings || {};

      if (mappings[domain]) {
        const emailIndex = mappings[domain].findIndex((entry: any) => entry.email === oldEmail);

        if (emailIndex >= 0) {
          mappings[domain][emailIndex].email = newEmail;
          mappings[domain][emailIndex].timestamp = Date.now();
          if (description !== undefined) {
            mappings[domain][emailIndex].description = description;
          }

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