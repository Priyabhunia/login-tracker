// Storage utilities for Login Tracker Extension

import { LoginData, WebsiteLoginHistory } from '../types/index';

export interface EmailMapping {
  email: string;
  apiUrl: string;
  timestamp: number;
  count: number;
}

export interface DomainMappings {
  [domain: string]: EmailMapping[];
}

export interface EmailSummary {
  email: string;
  domains: string[];
  latestTimestamp: number;
  totalLogins: number;
}

export interface StorageStats {
  totalDomains: number;
  totalEmails: number;
  totalLogins: number;
  domains: Array<{
    domain: string;
    emailCount: number;
    totalLogins: number;
  }>;
}

// Storage key for login history
const STORAGE_KEY = 'emailMappings';

/**
 * Save email mapping for a domain
 */
export async function saveEmailMapping(
  domain: string,
  email: string,
  apiUrl: string
): Promise<boolean> {
  try {
    const mappings = await getEmailMappings();

    if (!mappings[domain]) {
      mappings[domain] = [];
    }

    // Check if email already exists for this domain
    const existingIndex = mappings[domain].findIndex(entry => entry.email === email);

    if (existingIndex >= 0) {
      // Update existing entry
      mappings[domain][existingIndex].timestamp = Date.now();
      mappings[domain][existingIndex].count += 1;
      mappings[domain][existingIndex].apiUrl = apiUrl; // Update with latest API URL
    } else {
      // Add new entry
      mappings[domain].unshift({
        email: email,
        apiUrl: apiUrl,
        timestamp: Date.now(),
        count: 1
      });

      // Keep only last 5 emails per domain to avoid storage bloat
      if (mappings[domain].length > 5) {
        mappings[domain] = mappings[domain].slice(0, 5);
      }
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: mappings });
    console.log('Email mapping saved:', { domain, email });
    return true;
  } catch (error) {
    console.error('Error saving email mapping:', error);
    return false;
  }
}

/**
 * Get all email mappings
 */
export async function getEmailMappings(): Promise<DomainMappings> {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    return result[STORAGE_KEY] || {};
  } catch (error) {
    console.error('Error getting email mappings:', error);
    return {};
  }
}

/**
 * Get email mappings for a specific domain
 */
export async function getEmailMappingsForDomain(domain: string): Promise<EmailMapping[]> {
  try {
    const mappings = await getEmailMappings();
    return mappings[domain] || [];
  } catch (error) {
    console.error('Error getting email mappings for domain:', error);
    return [];
  }
}

/**
 * Get all unique emails across all domains
 */
export async function getAllEmails(): Promise<EmailSummary[]> {
  try {
    const mappings = await getEmailMappings();
    const allEmails: { [email: string]: EmailSummary } = {};

    for (const domain in mappings) {
      mappings[domain].forEach(entry => {
        if (!allEmails[entry.email]) {
          allEmails[entry.email] = {
            email: entry.email,
            domains: [domain],
            latestTimestamp: entry.timestamp,
            totalLogins: entry.count
          };
        } else {
          if (!allEmails[entry.email].domains.includes(domain)) {
            allEmails[entry.email].domains.push(domain);
          }
          allEmails[entry.email].totalLogins += entry.count;
          if (entry.timestamp > allEmails[entry.email].latestTimestamp) {
            allEmails[entry.email].latestTimestamp = entry.timestamp;
          }
        }
      });
    }

    // Convert to array and sort by latest timestamp (most recent first)
    return Object.values(allEmails).sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  } catch (error) {
    console.error('Error getting all emails:', error);
    return [];
  }
}

/**
 * Clear all email mappings
 */
export async function clearAllMappings(): Promise<boolean> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: {} });
    console.log('All email mappings cleared');
    return true;
  } catch (error) {
    console.error('Error clearing email mappings:', error);
    return false;
  }
}

/**
 * Clear email mappings for a specific domain
 */
export async function clearDomainMappings(domain: string): Promise<boolean> {
  try {
    const mappings = await getEmailMappings();
    delete mappings[domain];
    await chrome.storage.local.set({ [STORAGE_KEY]: mappings });
    console.log('Email mappings cleared for domain:', domain);
    return true;
  } catch (error) {
    console.error('Error clearing domain mappings:', error);
    return false;
  }
}

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<StorageStats | null> {
  try {
    const mappings = await getEmailMappings();
    const stats: StorageStats = {
      totalDomains: Object.keys(mappings).length,
      totalEmails: 0,
      totalLogins: 0,
      domains: []
    };

    for (const domain in mappings) {
      const domainData = {
        domain: domain,
        emailCount: mappings[domain].length,
        totalLogins: mappings[domain].reduce((sum, entry) => sum + entry.count, 0)
      };
      stats.domains.push(domainData);
      stats.totalEmails += domainData.emailCount;
      stats.totalLogins += domainData.totalLogins;
    }

    return stats;
  } catch (error) {
    console.error('Error getting storage stats:', error);
    return null;
  }
}

/**
 * Convert LoginData to EmailMapping for storage
 */
export function loginDataToEmailMapping(loginData: LoginData): EmailMapping {
  return {
    email: loginData.email,
    apiUrl: loginData.url,
    timestamp: loginData.timestamp,
    count: 1
  };
}

/**
 * Convert EmailMapping to LoginData for compatibility
 */
export function emailMappingToLoginData(
  emailMapping: EmailMapping,
  website: string
): LoginData {
  return {
    email: emailMapping.email,
    website: website,
    timestamp: emailMapping.timestamp,
    url: emailMapping.apiUrl,
    method: 'oauth'
  };
}