import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // User management for multi-device sync
  users: defineTable({
    userId: v.string(),
    deviceId: v.string(),
    lastSync: v.number(),
    createdAt: v.number(),
  }).index("by_userId", ["userId"]),

  // Email mappings storage
  emailMappings: defineTable({
    userId: v.string(),
    domain: v.string(),
    email: v.string(),
    apiUrl: v.string(),
    timestamp: v.number(),
    count: v.number(),
    description: v.optional(v.string()),
    // For conflict resolution
    localTimestamp: v.optional(v.number()),
    syncedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_domain", ["userId", "domain"])
    .index("by_email", ["userId", "email"]),
});
