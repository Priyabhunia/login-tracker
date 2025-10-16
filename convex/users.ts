import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// User management for multi-device sync
export const createUser = mutation({
  args: {
    userId: v.string(),
    deviceId: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if user already exists
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existingUser) {
      return existingUser._id;
    }

    // Create new user
    return await ctx.db.insert("users", {
      userId: args.userId,
      deviceId: args.deviceId,
      lastSync: Date.now(),
      createdAt: Date.now(),
    });
  },
});

export const updateLastSync = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
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

export const getUser = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});