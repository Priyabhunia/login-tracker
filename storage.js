// Storage operations for Email Tracker Extension

const STORAGE_KEY = 'emailMappings';

// Email mapping data structure
// {
//   "example.com": [
//     {
//       email: "user@example.com",
//       apiUrl: "https://api.example.com/user",
//       timestamp: 1234567890,
//       count: 1
//     }
//   ]
// }

// Save email mapping for a domain
async function saveEmailMapping(domain, email, apiUrl) {
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

// Get all email mappings
async function getEmailMappings() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    return result[STORAGE_KEY] || {};
  } catch (error) {
    console.error('Error getting email mappings:', error);
    return {};
  }
}

// Get email mappings for a specific domain
async function getEmailMappingsForDomain(domain) {
  try {
    const mappings = await getEmailMappings();
    return mappings[domain] || [];
  } catch (error) {
    console.error('Error getting email mappings for domain:', error);
    return [];
  }
}

// Get all unique emails across all domains
async function getAllEmails() {
  try {
    const mappings = await getEmailMappings();
    const allEmails = [];

    for (const domain in mappings) {
      mappings[domain].forEach(entry => {
        if (!allEmails.find(email => email.email === entry.email)) {
          allEmails.push({
            email: entry.email,
            domains: [domain],
            latestTimestamp: entry.timestamp,
            totalLogins: entry.count
          });
        } else {
          const existingEmail = allEmails.find(email => email.email === entry.email);
          if (!existingEmail.domains.includes(domain)) {
            existingEmail.domains.push(domain);
          }
          existingEmail.totalLogins += entry.count;
          if (entry.timestamp > existingEmail.latestTimestamp) {
            existingEmail.latestTimestamp = entry.timestamp;
          }
        }
      });
    }

    // Sort by latest timestamp (most recent first)
    return allEmails.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  } catch (error) {
    console.error('Error getting all emails:', error);
    return [];
  }
}

// Clear all email mappings
async function clearAllMappings() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: {} });
    console.log('All email mappings cleared');
    return true;
  } catch (error) {
    console.error('Error clearing email mappings:', error);
    return false;
  }
}

// Clear email mappings for a specific domain
async function clearDomainMappings(domain) {
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

// Get storage statistics
async function getStorageStats() {
  try {
    const mappings = await getEmailMappings();
    const stats = {
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

// Export functions for use in other scripts
window.EmailStorage = {
  saveEmailMapping,
  getEmailMappings,
  getEmailMappingsForDomain,
  getAllEmails,
  clearAllMappings,
  clearDomainMappings,
  getStorageStats
};