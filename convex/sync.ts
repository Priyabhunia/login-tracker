import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Define proper types for our data
interface EmailMapping {
  email: string;
  apiUrl: string;
  timestamp: number;
  count: number;
  description?: string;
}

interface DomainMappings {
  [domain: string]: EmailMapping[];
}

// Get user email mappings from Convex
export const getUserMappings = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const mappings = await ctx.db
      .query("emailMappings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    // Convert back to DomainMappings format
    const result: DomainMappings = {};
    mappings.forEach((mapping) => {
      if (!result[mapping.domain]) {
        result[mapping.domain] = [];
      }
      result[mapping.domain].push({
        email: mapping.email,
        apiUrl: mapping.apiUrl,
        timestamp: mapping.timestamp,
        count: mapping.count,
        description: mapping.description,
      });
    });

    return result;
  },
});

// Update user email mappings in Convex
export const updateUserMappings = mutation({
  args: {
    userId: v.string(),
    mappings: v.any(), // Using v.any() for flexibility with DomainMappings
  },
  handler: async (ctx, args) => {
    const mappings = args.mappings as DomainMappings;

    // First, delete existing mappings for this user
    const existingMappings = await ctx.db
      .query("emailMappings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    for (const mapping of existingMappings) {
      await ctx.db.delete(mapping._id);
    }

    // Insert new mappings
    for (const [domain, emails] of Object.entries(mappings)) {
      for (const email of emails as EmailMapping[]) {
        await ctx.db.insert("emailMappings", {
          userId: args.userId,
          domain,
          email: email.email,
          apiUrl: email.apiUrl,
          timestamp: email.timestamp,
          count: email.count,
          description: email.description,
          syncedAt: Date.now(),
        });
      }
    }

    // Update user's last sync time
    const user = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (user) {
      await ctx.db.patch(user._id, {
        lastSync: Date.now(),
      });
    }
  },
});

// Get mappings since last sync timestamp
export const getMappingsSince = query({
  args: {
    userId: v.string(),
    since: v.number(),
  },
  handler: async (ctx, args) => {
    const mappings = await ctx.db
      .query("emailMappings")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.gte(q.field("syncedAt"), args.since))
      .collect();

    return mappings;
  },
});

// Merge local and remote data intelligently
export const mergeMappings = mutation({
  args: {
    userId: v.string(),
    localMappings: v.any(),
    remoteMappings: v.any(),
  },
  handler: async (ctx, args) => {
    const localMappings = args.localMappings as DomainMappings;
    const remoteMappings = args.remoteMappings as DomainMappings;

    // Smart merge strategy: latest timestamp wins
    const merged: DomainMappings = { ...remoteMappings };

    for (const [domain, localEmails] of Object.entries(localMappings)) {
      if (!merged[domain]) {
        merged[domain] = [];
      }

      for (const localEmail of localEmails as EmailMapping[]) {
        const existingIndex = merged[domain].findIndex(
          (remoteEmail) => remoteEmail.email === localEmail.email
        );

        if (existingIndex >= 0) {
          // Email exists in both - use latest timestamp
          const remoteEmail = merged[domain][existingIndex];
          if (localEmail.timestamp > remoteEmail.timestamp) {
            merged[domain][existingIndex] = localEmail;
          }
        } else {
          // New email from local
          merged[domain].push(localEmail);
        }
      }
    }

    // Update the merged data in Convex using the correct mutation name
    // Note: This should be called from the client side, not recursively here
    // We'll return the merged data and let the client handle the update

    return merged;
  },
});