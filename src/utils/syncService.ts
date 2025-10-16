// Sync service for Convex integration
// Provides hybrid storage: local-first with optional cloud sync

import { getEmailMappings, saveEmailMapping } from './storage';
import { DomainMappings } from './storage';

// Define sync result interface
export interface SyncResult {
  success: boolean;
  mergedCount?: number;
  error?: string;
  localCount?: number;
  remoteCount?: number;
}

// Define merge strategy
export type MergeStrategy = 'LOCAL_WINS' | 'REMOTE_WINS' | 'LATEST_WINS';

export class SyncService {
  private convex: any = null;
  private userId: string | null = null;

  constructor() {
    // Initialize Convex client when available
    this.initializeConvex();
  }

  // Initialize Convex client
  private async initializeConvex() {
    try {
      console.log('🔄 Initializing Convex client...');

      // Dynamic import to avoid issues if convex isn't set up yet
      const { ConvexHttpClient } = await import('convex/browser');

      // Get Convex URL from environment or config
      const convexUrl = this.getConvexUrl();
      console.log('📡 Convex URL:', convexUrl);

      if (convexUrl && convexUrl.includes('convex.cloud')) {
        this.convex = new ConvexHttpClient(convexUrl);
        console.log('✅ Convex client initialized successfully:', convexUrl);
      } else {
        console.warn('❌ Convex URL not configured properly:', convexUrl);
      }
    } catch (error) {
      console.error('❌ Convex initialization failed:', error);
    }
  }

  // Get Convex URL from environment variables
  private getConvexUrl(): string | null {
    try {
      // In browser extension context, we can't read .env files directly
      // So we'll use the known Convex URL from your deployment
      const convexUrl = 'https://prestigious-lemming-627.convex.cloud';

      // Return the URL if it's valid
      if (convexUrl && convexUrl.includes('convex.cloud')) {
        return convexUrl;
      }

      return null;
    } catch (error) {
      console.warn('Error getting Convex URL:', error);
      return null;
    }
  }

  // Generate or get user ID for multi-device sync
  private async getOrCreateUserId(): Promise<string> {
    if (this.userId) return this.userId;

    // Try to get existing user ID from storage
    try {
      const result = await chrome.storage.local.get(['convexUserId']);
      if (result.convexUserId) {
        this.userId = result.convexUserId;
        console.log('📱 Using existing user ID:', this.userId);
        return this.userId as string;
      }
    } catch (error) {
      console.warn('Error getting user ID:', error);
    }

    // For cross-browser sync, we'll use a more deterministic approach
    // Use browser fingerprinting based on available browser APIs
    const fingerprint = await this.generateBrowserFingerprint();
    this.userId = `browser_${fingerprint}`;

    console.log('🔢 Generated new user ID for cross-browser sync:', this.userId);

    // Save for future use
    try {
      await chrome.storage.local.set({ convexUserId: this.userId });
    } catch (error) {
      console.warn('Error saving user ID:', error);
    }

    return this.userId;
  }

  // Generate a browser fingerprint for cross-browser consistency
  private async generateBrowserFingerprint(): Promise<string> {
    try {
      // Use multiple browser APIs to create a consistent fingerprint
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('Browser fingerprint', 2, 2);
        const canvasData = canvas.toDataURL().substring(0, 50);
        const hash = this.simpleHash(canvasData);
        return hash.toString(36);
      }

      // Fallback to timestamp-based if canvas not available
      return Date.now().toString(36);
    } catch (error) {
      // Ultimate fallback
      return Math.random().toString(36).substr(2, 9);
    }
  }

  // Simple hash function for fingerprinting
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // Main sync function - hybrid approach
  async syncWithConvex(strategy: MergeStrategy = 'LATEST_WINS'): Promise<SyncResult> {
    // Check if Convex is available
    if (!this.convex) {
      return {
        success: false,
        error: 'Convex not initialized. Please run "npx convex dev" first.'
      };
    }

    try {
      // 1. Get local data
      const localData = await getEmailMappings();
      const localCount = Object.keys(localData).reduce((sum, domain) => sum + localData[domain].length, 0);

      // 2. Get remote data
      const userId = await this.getOrCreateUserId();
      const remoteData = await this.convex.query('sync:getUserMappings', { userId });
      const remoteCount = Object.keys(remoteData).reduce((sum, domain) => sum + remoteData[domain].length, 0);

      // 3. Merge intelligently based on strategy
      const merged = await this.smartMerge(localData, remoteData, strategy);

      // 4. Update both storages
      await Promise.all([
        this.updateLocalStorage(merged),
        this.updateConvexStorage(userId, merged)
      ]);

      const mergedCount = Object.keys(merged).reduce((sum, domain) => sum + merged[domain].length, 0);

      return {
        success: true,
        mergedCount,
        localCount,
        remoteCount
      };
    } catch (error) {
      console.error('Sync error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown sync error'
      };
    }
  }

  // Smart merge based on strategy
  private async smartMerge(
    localData: DomainMappings,
    remoteData: DomainMappings,
    strategy: MergeStrategy
  ): Promise<DomainMappings> {
    const merged: DomainMappings = { ...remoteData };

    for (const [domain, localEmails] of Object.entries(localData)) {
      if (!merged[domain]) {
        merged[domain] = [];
      }

      for (const localEmail of localEmails) {
        const existingIndex = merged[domain].findIndex(
          (remoteEmail) => remoteEmail.email === localEmail.email
        );

        if (existingIndex >= 0) {
          // Email exists in both - resolve conflict based on strategy
          const remoteEmail = merged[domain][existingIndex];

          switch (strategy) {
            case 'LOCAL_WINS':
              merged[domain][existingIndex] = localEmail;
              break;
            case 'REMOTE_WINS':
              // Keep remote version
              break;
            case 'LATEST_WINS':
            default:
              // Compare timestamps and use latest
              if (localEmail.timestamp > remoteEmail.timestamp) {
                merged[domain][existingIndex] = localEmail;
              }
              break;
          }
        } else {
          // New email from local - always add it
          merged[domain].push(localEmail);
        }
      }
    }

    return merged;
  }

  // Update local storage with merged data
  private async updateLocalStorage(mergedData: DomainMappings): Promise<void> {
    try {
      console.log('💾 Updating local storage with merged data...');

      // Clear existing data first
      await chrome.storage.local.set({ emailMappings: {} });

      // Insert merged data back into local storage
      for (const [domain, emails] of Object.entries(mergedData)) {
        for (const email of emails) {
          await saveEmailMapping(domain, email.email, email.apiUrl);
        }
      }

      console.log('✅ Local storage updated successfully');
    } catch (error) {
      console.error('❌ Error updating local storage:', error);
      throw error;
    }
  }

  // Update Convex storage with merged data
  private async updateConvexStorage(userId: string, mergedData: DomainMappings): Promise<void> {
    if (!this.convex) return;

    try {
      await this.convex.mutation('sync:updateUserMappings', {
        userId,
        mappings: mergedData
      });
    } catch (error) {
      console.error('Error updating Convex storage:', error);
      throw error;
    }
  }

  // Check if sync is available
  isSyncAvailable(): boolean {
    return this.convex !== null;
  }

  // Manually refresh Convex connection
  async refreshConnection(): Promise<boolean> {
    console.log('🔄 Refreshing Convex connection...');
    this.convex = null; // Reset current connection
    await this.initializeConvex();
    return this.isSyncAvailable();
  }

  // Get sync status
  async getSyncStatus(): Promise<{
    available: boolean;
    lastSync?: number;
    localCount?: number;
    remoteCount?: number;
    userId?: string;
  }> {
    const localData = await getEmailMappings();
    const localCount = Object.keys(localData).reduce((sum, domain) => sum + localData[domain].length, 0);

    if (!this.convex) {
      return {
        available: false,
        localCount
      };
    }

    try {
      const userId = await this.getOrCreateUserId();
      const remoteData = await this.convex.query('sync:getUserMappings', { userId });
      const remoteCount = Object.keys(remoteData).reduce((sum, domain) => sum + remoteData[domain].length, 0);

      return {
        available: true,
        localCount,
        remoteCount,
        userId
      };
    } catch (error) {
      return {
        available: false,
        localCount
      };
    }
  }

  // Get current user ID for debugging
  getCurrentUserId(): string | null {
    return this.userId;
  }

  // Force complete sync and UI refresh
  async forceCompleteSync(): Promise<SyncResult> {
    console.log('🔄 Forcing complete sync...');

    // Get current data before sync
    const beforeSync = await this.getSyncStatus();

    // Perform sync
    const syncResult = await this.syncWithConvex('LATEST_WINS');

    if (syncResult.success) {
      console.log('✅ Sync completed successfully');

      // Get data after sync to verify
      const afterSync = await this.getSyncStatus();

      console.log('📊 Sync summary:', {
        before: beforeSync,
        after: afterSync,
        synced: syncResult
      });
    } else {
      console.error('❌ Sync failed:', syncResult.error);
    }

    return syncResult;
  }
}
