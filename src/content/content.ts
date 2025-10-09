// Content script for Login Tracker Extension
// Runs on web pages to detect login events and UI interactions

import { ContentMessage, APICallData } from '../types/index';

/**
 * Content script initialization
 */
function initializeContentScript(): void {
  console.log('Login Tracker content script loaded on:', window.location.hostname);

  // Check if this is a login page and show notification banner
  checkForLoginPageAndShowBanner();

  // Monitor for potential login events
  monitorForLoginEvents();

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
}

/**
 * Monitor for login-related events on the page
 */
function monitorForLoginEvents(): void {
  // Monitor form submissions (for manual login detection)
  document.addEventListener('submit', handleFormSubmission);

  // Monitor for OAuth redirects
  monitorOAuthRedirects();

  // Monitor for page visibility changes (tab switching)
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

/**
 * Handle form submissions to detect manual logins
 */
function handleFormSubmission(event: Event): void {
  const form = event.target as HTMLFormElement;

  if (isLoginForm(form)) {
    console.log('Login form detected and submitted');

    // Extract email from form if possible
    const emailInput = form.querySelector('input[type="email"], input[name*="email"]') as HTMLInputElement;
    if (emailInput && emailInput.value) {
      const email = emailInput.value;
      const domain = window.location.hostname;

      // Send login detection to background script
      chrome.runtime.sendMessage({
        type: 'LOGIN_DETECTED',
        data: {
          email: email,
          website: domain,
          timestamp: Date.now(),
          url: window.location.href,
          method: 'manual'
        }
      });
    }
  }
}

/**
 * Check if a form is likely a login form
 */
function isLoginForm(form: HTMLFormElement): boolean {
  const formAction = form.action.toLowerCase();
  const formClass = form.className.toLowerCase();
  const formId = form.id.toLowerCase();

  // Check for common login form indicators
  const loginIndicators = [
    'login',
    'signin',
    'auth',
    'user',
    'account'
  ];

  const isLoginAction = loginIndicators.some(indicator =>
    formAction.includes(indicator) || formClass.includes(indicator) || formId.includes(indicator)
  );

  // Check for email and password fields
  const hasEmailField = !!form.querySelector('input[type="email"], input[name*="email"]');
  const hasPasswordField = !!form.querySelector('input[type="password"], input[name*="password"]');

  return (isLoginAction || (hasEmailField && hasPasswordField));
}

/**
 * Check if current page is a login page (enhanced version)
 */

/**
 * Monitor for OAuth redirect patterns
 */
function monitorOAuthRedirects(): void {
  // Monitor URL changes for OAuth callbacks
  let currentUrl = window.location.href;

  // Check for OAuth parameters in URL
  const urlParams = new URLSearchParams(window.location.search);
  const oauthParams = ['code', 'state', 'access_token', 'authorization_code'];

  const hasOAuthParams = oauthParams.some(param => urlParams.has(param));

  if (hasOAuthParams) {
    console.log('OAuth callback detected');
    // This might indicate a successful login
    setTimeout(() => {
      attemptToExtractEmailFromPage();
    }, 2000); // Wait a bit for page to load
  }

  // Monitor for URL changes (for SPA navigation)
  const observer = new MutationObserver(() => {
    if (currentUrl !== window.location.href) {
      currentUrl = window.location.href;

      // Check if new URL has OAuth parameters
      const newUrlParams = new URLSearchParams(window.location.search);
      const hasNewOAuthParams = oauthParams.some(param => newUrlParams.has(param));

      if (hasNewOAuthParams) {
        console.log('OAuth URL change detected');
        setTimeout(() => {
          attemptToExtractEmailFromPage();
        }, 1500);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Handle page visibility changes
 */
function handleVisibilityChange(): void {
  if (!document.hidden) {
    // Page became visible, might be after OAuth redirect
    setTimeout(() => {
      attemptToExtractEmailFromPage();
    }, 1000);
  }
}

/**
 * Attempt to extract email from current page
 */
function attemptToExtractEmailFromPage(): void {
  const domain = window.location.hostname;

  // Try multiple methods to extract email (prioritized order)
  const email = extractEmailFromDOM() ||
                extractEmailFromMeta() ||
                extractEmailFromJSON() ||
                parseVisiblePageContent();
                // Removed scanBrowserStorage() as it often captures tokens

  if (email && isValidEmail(email)) {
    console.log('Email extracted from page:', email);

    // Always show minimal notification and auto-store
    showNewAccountNotification(domain, email);
  }
}

/**
 * Extract email from DOM elements
 */
function extractEmailFromDOM(): string | null {
  // More specific selectors for legitimate email displays
  const emailSelectors = [
    // High-confidence selectors (likely to contain real emails)
    '[data-email]',
    '.user-email',
    '.account-email',
    '.profile-email',
    '.user-info [class*="email"]',
    '.account-info [class*="email"]',
    '.user-details [class*="email"]',
    // Medium-confidence selectors
    '.email',
    '[class*="email"]:not([class*="template"]):not([class*="example"])',
    '[id*="email"]:not([id*="template"]):not([id*="example"])',
    // User menu and navigation areas
    '.user-menu [class*="email"]',
    '.dropdown-menu [class*="email"]',
    '.nav-user [class*="email"]',
    '[role="menuitem"] [class*="email"]'
  ];

  for (const selector of emailSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of Array.from(elements)) {
      const text = element.textContent || (element as HTMLInputElement).value;
      if (text && text.trim().length > 0) {
        // Extract email with improved pattern
        const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) {
          const email = emailMatch[0];
          // Additional validation to avoid tokens
          if (isValidEmail(email)) {
            return email;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Extract email from meta tags
 */
function extractEmailFromMeta(): string | null {
  const metaSelectors = [
    'meta[name="user"]',
    'meta[property="email"]',
    'meta[name="email"]'
  ];

  for (const selector of metaSelectors) {
    const meta = document.querySelector(selector) as HTMLMetaElement;
    if (meta && meta.content) {
      const emailMatch = meta.content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) return emailMatch[0];
    }
  }

  return null;
}

/**
 * Extract email from JSON-LD structured data
 */
function extractEmailFromJSON(): string | null {
  const jsonScripts = document.querySelectorAll('script[type="application/ld+json"]');

  for (const script of Array.from(jsonScripts)) {
    try {
      const data = JSON.parse(script.textContent || '{}');
      const email = searchJSONForEmail(data);
      if (email && isValidEmail(email)) {
        return email;
      }
    } catch (e) {
      // Ignore invalid JSON
    }
  }

  return null;
}

/**
 * Recursively search JSON for email
 */
function searchJSONForEmail(obj: any): string | null {
  if (typeof obj === 'string') {
    const emailMatch = obj.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    if (emailMatch) return emailMatch[0];
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key in obj) {
      const result = searchJSONForEmail(obj[key]);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Validate email address
 */
function isValidEmail(email: string): boolean {
  // Convert to lowercase for checking
  const lowerEmail = email.toLowerCase();

  // Basic email format validation
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return false;
  }

  // Invalid patterns to reject
  const invalidPatterns = [
    /noreply/,
    /no-reply/,
    /support/,
    /admin/,
    /test/,
    /example/,
    /placeholder/,
    /your\.email/,
    /\+.*\+/,  // Multiple plus signs (often in tokens)
    /^\d{10,}$/,  // All numbers (likely tokens)
    /^[a-f0-9]{32,}$/i,  // Long hex strings (likely tokens/hashes)
    /\.\w{10,}$/,  // Very long TLDs (likely tokens)
    /token/,  // Contains "token"
    /session/,  // Contains "session"
    /auth/,  // Contains "auth"
    /key/,  // Contains "key"
    /secret/,  // Contains "secret"
    /encrypted/,  // Contains "encrypted"
    /hash/,  // Contains "hash"
    /digest/,  // Contains "digest"
    /signature/,  // Contains "signature"
  ];

  const isInvalid = invalidPatterns.some(pattern => pattern.test(lowerEmail));
  if (isInvalid) {
    return false;
  }

  // Valid patterns to accept (common email providers)
  const validProviders = [
    /@gmail\.com$/,
    /@yahoo\.com$/,
    /@outlook\.com$/,
    /@hotmail\.com$/,
    /@icloud\.com$/,
    /@protonmail\.com$/,
    /@mail\.com$/,
    /@yandex\.com$/,
    /@zoho\.com$/,
    /@aol\.com$/,
    // Add more legitimate providers as needed
  ];

  const hasValidProvider = validProviders.some(provider => provider.test(lowerEmail));
  if (hasValidProvider) {
    return true;
  }

  // For other domains, check if it's a reasonable email format
  const parts = email.split('@');
  if (parts.length !== 2) {
    return false;
  }

  const [username, domain] = parts;

  // Username should be reasonable (not too long, no suspicious patterns)
  if (username.length > 30 || username.length < 2) {
    return false;
  }

  // Domain should be reasonable
  if (domain.length > 50 || domain.length < 4) {
    return false;
  }

  // Check for suspicious patterns in username
  const suspiciousUsernamePatterns = [
    /^[a-f0-9]{8,}$/i,  // Hex-like username
    /^\d{6,}$/,  // All numbers
    /_{10,}/,  // Too many underscores
    /\.{5,}/,  // Too many dots
  ];

  const hasSuspiciousUsername = suspiciousUsernamePatterns.some(pattern => pattern.test(username));
  if (hasSuspiciousUsername) {
    return false;
  }

  return true;
}

/**
 * Scan browser storage for email data
 */
function scanBrowserStorage(): string | null {
  try {
    // Scan localStorage and sessionStorage
    const allData = { ...localStorage, ...sessionStorage };

    for (const [key, value] of Object.entries(allData)) {
      const emails = extractEmailsFromString(String(value));
      if (emails.length > 0) {
        // Return the first valid email found
        const validEmail = emails.find(email => isValidEmail(email));
        if (validEmail) return validEmail;
      }
    }
  } catch (error) {
    console.error('Error scanning browser storage:', error);
  }

  return null;
}

/**
 * Parse visible page content for email patterns
 */
function parseVisiblePageContent(): string | null {
  try {
    // Look for common "logged in as" patterns (high confidence)
    const bodyText = document.body.textContent || '';

    // Pattern 1: "Logged in as email@domain.com" - very specific pattern
    const loggedInPattern = /(?:logged in as|welcome|hello|signed in as|you are logged in as):\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
    const loggedInMatch = bodyText.match(loggedInPattern);
    if (loggedInMatch && isValidEmail(loggedInMatch[1])) {
      return loggedInMatch[1];
    }

    // Pattern 2: Look for emails in specific contexts (medium confidence)
    const contextPatterns = [
      // Email preceded by "Email:" or "Account:"
      /(?:email|account):\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
      // Email in quotes after common labels
      /(?:user|account|profile):\s*["']([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["']/i,
    ];

    for (const pattern of contextPatterns) {
      const match = bodyText.match(pattern);
      if (match && isValidEmail(match[1])) {
        return match[1];
      }
    }

    // Pattern 3: Check profile/settings pages for email displays (medium confidence)
    const profileElements = document.querySelectorAll('[data-testid*="profile"], [class*="profile"], [id*="profile"], [class*="account"], [id*="account"], .user-info, .account-info, .user-details');
    for (const element of Array.from(profileElements)) {
      const text = element.textContent || '';
      // Look for email patterns in context
      const emailMatch = text.match(/(?:email|account):\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (emailMatch && isValidEmail(emailMatch[1])) {
        return emailMatch[1];
      }
    }

    // Pattern 4: Check for email in user menu/dropdown (medium confidence)
    const userMenuItems = document.querySelectorAll('[role="menuitem"], .user-menu, .dropdown-menu, .nav-user, [class*="user"], [class*="account"]');
    for (const menu of Array.from(userMenuItems)) {
      const text = menu.textContent || '';
      const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch && isValidEmail(emailMatch[1])) {
        return emailMatch[1];
      }
    }

    // Pattern 5: Look for emails in structured data areas (low confidence, last resort)
    const structuredElements = document.querySelectorAll('[data-user], [data-account], .user-data, .account-data');
    for (const element of Array.from(structuredElements)) {
      const text = element.textContent || '';
      const emailMatch = text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch && isValidEmail(emailMatch[1])) {
        return emailMatch[1];
      }
    }

  } catch (error) {
    console.error('Error parsing page content:', error);
  }

  return null;
}

/**
 * Extract emails from string using regex
 */
function extractEmailsFromString(text: string): string[] {
  const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const matches = text.match(emailPattern);
  return matches || [];
}

/**
 * Check if this is a new account for the domain
 */
async function checkForNewAccount(domain: string, email: string): Promise<boolean> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CHECK_NEW_ACCOUNT',
      data: { domain, email }
    });

    return response && response.isNew === true;
  } catch (error) {
    console.error('Error checking for new account:', error);
    return false;
  }
}

/**
 * Show new account notification
 */
function showNewAccountNotification(domain: string, email: string): void {
  // Auto-store the email without asking user
  chrome.runtime.sendMessage({
    type: 'LOGIN_DETECTED',
    data: {
      email: email,
      website: domain,
      timestamp: Date.now(),
      url: window.location.href,
      method: 'oauth'
    }
  });

  // Create minimal notification element
  const notification = document.createElement('div');
  notification.id = 'new-account-notification';
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #f8f9fa;
    color: #333;
    padding: 12px 16px;
    border-radius: 6px;
    border: 1px solid #e9ecef;
    z-index: 10001;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    max-width: 280px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  `;

  notification.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <div style="color: #28a745; font-weight: 500;">✓</div>
      <div style="flex: 1;">
        <div style="font-weight: 500; margin-bottom: 2px;">Email saved</div>
        <div style="color: #666; font-size: 12px;">${escapeHtml(email)}</div>
      </div>
      <button id="close-notification" style="
        background: none;
        border: none;
        color: #999;
        cursor: pointer;
        font-size: 16px;
        padding: 0;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">×</button>
    </div>
  `;

  document.body.appendChild(notification);

  // Set up close button
  const closeBtn = document.getElementById('close-notification');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      notification.remove();
    });
  }

  // Auto-remove after 3 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 3000);

  console.log('Email auto-saved:', { domain, email });
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Handle messages from background script
 */
function handleBackgroundMessage(
  message: ContentMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: any) => void
): void {
  switch (message.type) {
    case 'API_CALL_DETECTED':
      // Handle API call data if needed
      break;
    case 'PAGE_LOADED':
      // Handle page load notification if needed
      break;
  }
}

// Banner element reference
let notificationBanner: HTMLElement | null = null;

/**
 * Check if current page is a login page and show notification banner
 */
async function checkForLoginPageAndShowBanner(): Promise<void> {
  // Wait a bit for page to load completely
  await new Promise(resolve => setTimeout(resolve, 1000));

  if (isLoginPage()) {
    console.log('Login page detected, checking for stored emails...');

    try {
      const domain = window.location.hostname;
      const response = await chrome.runtime.sendMessage({
        type: 'GET_EMAIL_MAPPINGS'
      });

      if (response && response.mappings && response.mappings[domain]) {
        const emails = response.mappings[domain];
        if (emails && emails.length > 0) {
          showLoginNotificationBanner(emails);
        }
      }
    } catch (error) {
      console.error('Error checking for stored emails:', error);
    }
  }
}


/**
 * Show notification banner with previously used emails
 */
function showLoginNotificationBanner(emails: Array<{ email: string; timestamp: number; count: number }>): void {
  // Remove existing banner if present
  if (notificationBanner) {
    notificationBanner.remove();
  }

  // Create banner element
  notificationBanner = document.createElement('div');
  notificationBanner.id = 'email-tracker-banner';
  notificationBanner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #4f46e5;
    color: white;
    padding: 12px 20px;
    z-index: 10000;
    font-family: Arial, sans-serif;
  `;

  const emailList = emails.slice(0, 3).map(email => {
    const lastUsed = new Date(email.timestamp).toLocaleDateString();
    return `• ${email.email} (Last: ${lastUsed})`;
  }).join('<br>');

  notificationBanner.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <div style="flex: 1;">
        <div style="display: flex; align-items: center; margin-bottom: 4px;">
          <span style="margin-right: 8px;">📧</span>
          <strong>Email Tracker</strong>
        </div>
        <div style="font-size: 13px; opacity: 0.9;">
          You previously used:
          <div style="margin-top: 4px; line-height: 1.4;">
            ${emailList}
          </div>
        </div>
      </div>
      <button id="close-banner" style="
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        padding: 8px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        margin-left: 16px;
      ">×</button>
    </div>
  `;

  // Add close functionality
  const closeButton = notificationBanner.querySelector('#close-banner');
  closeButton?.addEventListener('click', () => {
    if (notificationBanner) {
      notificationBanner.style.animation = 'slideUp 0.3s ease-out';
      setTimeout(() => notificationBanner?.remove(), 300);
    }
  });

  // Add CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideDown {
      from { transform: translateY(-100%); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @keyframes slideUp {
      from { transform: translateY(0); opacity: 1; }
      to { transform: translateY(-100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);

  // Insert banner at the top of the page
  document.body.insertBefore(notificationBanner, document.body.firstChild);

  console.log('Login notification banner shown for domain:', window.location.hostname);
}

/**
 * Enhanced login form detection for better banner triggering
 */
function isLoginPage(): boolean {
  const currentUrl = window.location.href.toLowerCase();

  // Check URL patterns
  const loginUrlPatterns = [
    /\/login/,
    /\/signin/,
    /\/auth/,
    /\/account\/signin/,
    /\/user\/login/,
    /\/session\/new/,
    /\/sign-in/,
    /\/log-in/
  ];

  const isLoginUrl = loginUrlPatterns.some(pattern => pattern.test(currentUrl));

  // Check for login form elements
  const hasEmailInput = !!document.querySelector('input[type="email"], input[name*="email"]');
  const hasPasswordInput = !!document.querySelector('input[type="password"], input[name*="password"]');

  // Check for "Sign in with Google" button and other OAuth providers
  const hasGoogleSignIn = !!document.querySelector('[href*="google"], [data-provider="google"], .google-signin, #google-signin, [aria-label*="Google"], [class*="google"], [title*="Google"]');
  const hasOAuthButtons = !!document.querySelector('[href*="oauth"], [data-oauth], .oauth-signin, .social-login, [class*="oauth"], [href*="accounts.google"]');

  // Check for common login-related text content
  const pageText = document.body.textContent?.toLowerCase() || '';
  const hasLoginText = /\b(sign in|log in|login|signin|authenticate|logon)\b/.test(pageText);

  // Check for form with both email and password fields
  const forms = document.querySelectorAll('form');
  let hasLoginForm = false;
  for (const form of Array.from(forms)) {
    const emailInputs = form.querySelectorAll('input[type="email"], input[name*="email"]');
    const passwordInputs = form.querySelectorAll('input[type="password"], input[name*="password"]');
    if (emailInputs.length > 0 && passwordInputs.length > 0) {
      hasLoginForm = true;
      break;
    }
  }

  return isLoginUrl || hasLoginForm || hasGoogleSignIn || hasOAuthButtons || (hasLoginText && (hasEmailInput || hasPasswordInput));
}

// Initialize content script when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
  initializeContentScript();
}