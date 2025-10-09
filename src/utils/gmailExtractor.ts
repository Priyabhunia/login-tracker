// Gmail extraction utilities for Login Tracker Extension

/**
 * Gmail-specific email patterns and detection
 */
export class GmailExtractor {
  private static readonly GMAIL_DOMAINS = [
    'gmail.com',
    'googlemail.com',
    'gmail.co.uk',
    'gmail.de',
    'gmail.fr',
    'gmail.it',
    'gmail.es',
    'gmail.ca',
    'gmail.com.au'
  ];

  private static readonly GMAIL_PATTERNS = [
    // Standard Gmail patterns
    /^[a-zA-Z0-9._%+-]+@gmail\.com$/,
    /^[a-zA-Z0-9._%+-]+@googlemail\.com$/,

    // Gmail with country TLDs
    /^[a-zA-Z0-9._%+-]+@gmail\.(co\.uk|de|fr|it|es|ca|com\.au)$/,

    // Gmail with plus addressing
    /^[a-zA-Z0-9._%+-]+\+[a-zA-Z0-9._%+-]+@gmail\.com$/,

    // Gmail with dots in username (common pattern)
    /^[a-zA-Z0-9._%+-]+\.[a-zA-Z0-9._%+-]+@gmail\.com$/
  ];

  /**
   * Check if an email is a Gmail address
   */
  static isGmailAddress(email: string): boolean {
    const emailLower = email.toLowerCase();
    return this.GMAIL_DOMAINS.some(domain => emailLower.endsWith(`@${domain}`));
  }

  /**
   * Extract Gmail addresses from text
   */
  static extractGmailFromText(text: string): string[] {
    if (!text) return [];

    const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    return emailMatches.filter(email => this.isGmailAddress(email));
  }

  /**
   * Extract Gmail from JSON response data
   */
  static extractGmailFromJSON(data: any): string[] {
    const gmails: string[] = [];

    if (!data) return gmails;

    // Search recursively through JSON structure
    this.searchJSONForGmail(data, gmails);

    return [...new Set(gmails)]; // Remove duplicates
  }

  /**
   * Recursively search JSON for Gmail addresses
   */
  private static searchJSONForGmail(obj: any, results: string[]): void {
    if (typeof obj === 'string') {
      const gmails = this.extractGmailFromText(obj);
      results.push(...gmails);
    } else if (Array.isArray(obj)) {
      obj.forEach(item => this.searchJSONForGmail(item, results));
    } else if (obj && typeof obj === 'object') {
      // Check common email field names first
      const emailFields = ['email', 'username', 'userEmail', 'login', 'account', 'user', 'profile'];

      for (const field of emailFields) {
        if (obj[field] && typeof obj[field] === 'string') {
          const gmails = this.extractGmailFromText(obj[field]);
          results.push(...gmails);
        }
      }

      // Search all other fields recursively
      Object.values(obj).forEach(value => {
        if (value && typeof value === 'object') {
          this.searchJSONForGmail(value, results);
        }
      });
    }
  }

  /**
   * Extract Gmail from HTML content
   */
  static extractGmailFromHTML(html: string): string[] {
    if (!html) return [];

    // Look for common patterns in HTML that might contain emails
    const patterns = [
      // JSON-LD structured data
      /"email"\s*:\s*"([^"]*@gmail\.com[^"]*)"/gi,
      /"email"\s*:\s*'([^']*@gmail\.com[^']*)'/gi,

      // Common HTML attributes
      /data-email="([^"]*@gmail\.com[^"]*)"/gi,
      /data-email='([^']*@gmail\.com[^']*)'/gi,

      // Text content that might contain emails
      /([a-zA-Z0-9._%+-]+@gmail\.com)/gi
    ];

    const gmails: string[] = [];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        if (match[1] && this.isGmailAddress(match[1])) {
          gmails.push(match[1]);
        }
      }
    });

    return [...new Set(gmails)];
  }

  /**
   * Validate Gmail address format
   */
  static isValidGmailFormat(email: string): boolean {
    if (!this.isGmailAddress(email)) return false;

    // Gmail username rules
    const username = email.split('@')[0];

    // Username should be 6-30 characters
    if (username.length < 6 || username.length > 30) return false;

    // Username should only contain allowed characters
    if (!/^[a-zA-Z0-9._+-]+$/.test(username)) return false;

    // Username shouldn't start or end with dot or dash
    if (username.startsWith('.') || username.startsWith('-') ||
        username.endsWith('.') || username.endsWith('-')) return false;

    // Username shouldn't have consecutive dots or dashes
    if (/\.\.|--/.test(username)) return false;

    return true;
  }

  /**
   * Normalize Gmail address (remove dots, handle plus addressing)
   */
  static normalizeGmailAddress(email: string): string {
    if (!this.isGmailAddress(email)) return email;

    const [username, domain] = email.toLowerCase().split('@');

    // Remove dots from username (Gmail ignores dots)
    const normalizedUsername = username.replace(/\./g, '');

    // Remove plus addressing part
    const plusIndex = normalizedUsername.indexOf('+');
    const cleanUsername = plusIndex > 0 ? normalizedUsername.substring(0, plusIndex) : normalizedUsername;

    return `${cleanUsername}@${domain}`;
  }

  /**
   * Get Gmail extraction priority (for ranking multiple emails)
   */
  static getGmailPriority(email: string, context: string = ''): number {
    let priority = 0;

    // Higher priority for emails in user/profile contexts
    const userContextWords = ['user', 'profile', 'account', 'me', 'my'];
    const contextLower = context.toLowerCase();
    if (userContextWords.some(word => contextLower.includes(word))) {
      priority += 10;
    }

    // Higher priority for emails in email-specific fields
    const emailFieldWords = ['email', 'username', 'login'];
    if (emailFieldWords.some(word => contextLower.includes(word))) {
      priority += 8;
    }

    // Higher priority for valid Gmail format
    if (this.isValidGmailFormat(email)) {
      priority += 5;
    }

    // Lower priority for common test/demo emails
    const testPatterns = [/test/, /demo/, /example/, /sample/];
    if (testPatterns.some(pattern => pattern.test(email))) {
      priority -= 10;
    }

    return priority;
  }

  /**
   * Extract Gmail with context information
   */
  static extractGmailWithContext(data: any): Array<{ email: string; context: string; priority: number }> {
    const results: Array<{ email: string; context: string; priority: number }> = [];

    if (!data) return results;

    this.searchJSONWithContext(data, '', results);

    return results
      .filter(result => this.isGmailAddress(result.email))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Recursively search JSON with context tracking
   */
  private static searchJSONWithContext(
    obj: any,
    currentContext: string,
    results: Array<{ email: string; context: string; priority: number }>
  ): void {
    if (typeof obj === 'string') {
      const gmails = this.extractGmailFromText(obj);
      gmails.forEach(email => {
        results.push({
          email,
          context: currentContext,
          priority: this.getGmailPriority(email, currentContext)
        });
      });
    } else if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        this.searchJSONWithContext(item, `${currentContext}[${index}]`, results);
      });
    } else if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(key => {
        const value = obj[key];
        const newContext = currentContext ? `${currentContext}.${key}` : key;

        if (typeof value === 'string') {
          const gmails = this.extractGmailFromText(value);
          gmails.forEach(email => {
            results.push({
              email,
              context: newContext,
              priority: this.getGmailPriority(email, newContext)
            });
          });
        } else if (value && typeof value === 'object') {
          this.searchJSONWithContext(value, newContext, results);
        }
      });
    }
  }
}

/**
 * Utility functions for Gmail detection
 */
export const GmailUtils = {
  /**
   * Check if email is Gmail
   */
  isGmail: GmailExtractor.isGmailAddress.bind(GmailExtractor),

  /**
   * Extract Gmails from text
   */
  extractFromText: GmailExtractor.extractGmailFromText.bind(GmailExtractor),

  /**
   * Extract Gmails from JSON
   */
  extractFromJSON: GmailExtractor.extractGmailFromJSON.bind(GmailExtractor),

  /**
   * Extract Gmails from HTML
   */
  extractFromHTML: GmailExtractor.extractGmailFromHTML.bind(GmailExtractor),

  /**
   * Validate Gmail format
   */
  isValidFormat: GmailExtractor.isValidGmailFormat.bind(GmailExtractor),

  /**
   * Normalize Gmail address
   */
  normalize: GmailExtractor.normalizeGmailAddress.bind(GmailExtractor),

  /**
   * Get extraction priority
   */
  getPriority: GmailExtractor.getGmailPriority.bind(GmailExtractor)
};

/**
 * Domain utilities for smart domain grouping
 */
export class DomainUtils {
  // Common TLDs that should be treated as separate domains
  private static readonly SEPARATE_TLDS = new Set([
    'co.uk', 'co.jp', 'co.kr', 'com.au', 'co.nz', 'co.za', 'com.br', 'com.mx',
    'co.in', 'co.ca', 'com.sg', 'com.hk', 'co.th', 'com.tw', 'com.tr', 'com.ar',
    'com.co', 'com.pe', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo', 'com.gt',
    'com.sv', 'com.hn', 'com.ni', 'com.cr', 'com.pa', 'com.do', 'com.pr', 'com.jm',
    'com.tt', 'com.bb', 'com.lc', 'com.vc', 'com.gd', 'com.ag', 'com.dm', 'com.kn',
    'com.ms', 'com.vc', 'com.ai', 'com.vg', 'com.bm', 'com.ky', 'com.tc', 'com.fk'
  ]);

  /**
   * Extract root domain from subdomain
   * Examples:
   * - login.facebook.com -> facebook.com
   * - api.twitter.com -> twitter.com
   * - github.com -> github.com (already root)
   */
  static getRootDomain(domain: string): string {
    if (!domain) return domain;

    // Remove www if present
    let cleanDomain = domain.toLowerCase().replace(/^www\./, '');

    // Split by dots
    const parts = cleanDomain.split('.');

    if (parts.length <= 2) {
      return cleanDomain; // Already a root domain
    }

    // Check if it's a known separate TLD (like co.uk)
    const potentialTld = parts.slice(-2).join('.');
    if (this.SEPARATE_TLDS.has(potentialTld)) {
      return parts.slice(-3).join('.');
    }

    // For regular TLDs, return the last two parts
    return parts.slice(-2).join('.');
  }

  /**
   * Group subdomains together
   * Examples:
   * - login.facebook.com, m.facebook.com, facebook.com -> facebook.com
   * - api.github.com, github.com -> github.com
   */
  static groupSubdomains(domains: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();

    for (const domain of domains) {
      const rootDomain = this.getRootDomain(domain);

      if (!groups.has(rootDomain)) {
        groups.set(rootDomain, []);
      }

      groups.get(rootDomain)!.push(domain);
    }

    return groups;
  }

  /**
   * Get canonical domain (prefer non-subdomain version)
   */
  static getCanonicalDomain(domains: string[]): string {
    if (domains.length === 0) return '';

    // Prefer root domain over subdomains
    const rootDomains = domains.filter(d => {
      const root = this.getRootDomain(d);
      return d === root;
    });

    if (rootDomains.length > 0) {
      return rootDomains[0];
    }

    // If no root domain, prefer shorter domain
    return domains.sort((a, b) => a.length - b.length)[0];
  }

  /**
   * Check if domain is a known OAuth/login subdomain
   */
  static isLoginSubdomain(domain: string): boolean {
    const loginPatterns = [
      /^login\./,
      /^signin\./,
      /^auth\./,
      /^accounts\./,
      /^account\./,
      /^sso\./,
      /^oauth\./,
      /^api\./,
      /^www\./ // Sometimes www is used for login
    ];

    return loginPatterns.some(pattern => pattern.test(domain));
  }
}