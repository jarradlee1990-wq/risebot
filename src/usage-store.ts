import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

type ChatType = "private" | "group" | "supergroup" | "channel";

type ChatEntry = {
  id: string;
  type: ChatType;
  title?: string;
  username?: string;
  firstName?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  messageCount: number;
  lookupCount: number;
  lastLookupAt?: string;
};

type UserEntry = {
  id: string;
  username?: string;
  firstName?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  messageCount: number;
  lookupCount: number;
};

type LookupEvent = {
  timestamp: string;
  chatId: string;
  outcome: "success" | "failure";
};

type UsageStatsFile = {
  createdAt: string;
  updatedAt: string;
  totalMessages: number;
  totalLookups: number;
  successfulLookups: number;
  failedLookups: number;
  chats: Record<string, ChatEntry>;
  users: Record<string, UserEntry>;
  lookupEvents: LookupEvent[];
};

export type UsageEvent = {
  chatId: number;
  chatType: ChatType;
  chatTitle?: string;
  chatUsername?: string;
  userId?: number;
  username?: string;
  firstName?: string;
};

export type UsageSummary = {
  createdAt: string;
  updatedAt: string;
  totalMessages: number;
  totalLookups: number;
  successfulLookups: number;
  failedLookups: number;
  requestsLastHour: number;
  requestsLast24h: number;
  successfulRequestsLastHour: number;
  failedRequestsLastHour: number;
  uniqueChats: number;
  privateChats: number;
  groupChats: number;
  uniqueUsers: number;
  activeChats24h: number;
  activeGroups24h: number;
  topGroups: ChatEntry[];
};

const EMPTY_STATS = (): UsageStatsFile => {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    updatedAt: now,
    totalMessages: 0,
    totalLookups: 0,
    successfulLookups: 0,
    failedLookups: 0,
    chats: {},
    users: {},
    lookupEvents: [],
  };
};

const LOOKUP_EVENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export class UsageStore {
  private stats: UsageStatsFile = EMPTY_STATS();
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<UsageStatsFile>;
      this.stats = {
        ...EMPTY_STATS(),
        ...parsed,
        chats: parsed.chats ?? {},
        users: parsed.users ?? {},
        lookupEvents: parsed.lookupEvents ?? [],
      };
      this.pruneLookupEvents();
    } catch {
      this.stats = EMPTY_STATS();
      await this.save();
    }
  }

  async recordMessage(event: UsageEvent): Promise<void> {
    const now = new Date().toISOString();
    this.stats.totalMessages += 1;
    this.stats.updatedAt = now;

    const chatKey = String(event.chatId);
    const existingChat = this.stats.chats[chatKey];
    this.stats.chats[chatKey] = {
      id: chatKey,
      type: event.chatType,
      title: event.chatTitle,
      username: event.chatUsername,
      firstName: event.firstName,
      firstSeenAt: existingChat?.firstSeenAt ?? now,
      lastSeenAt: now,
      messageCount: (existingChat?.messageCount ?? 0) + 1,
      lookupCount: existingChat?.lookupCount ?? 0,
      lastLookupAt: existingChat?.lastLookupAt,
    };

    if (event.userId !== undefined) {
      const userKey = String(event.userId);
      const existingUser = this.stats.users[userKey];
      this.stats.users[userKey] = {
        id: userKey,
        username: event.username,
        firstName: event.firstName,
        firstSeenAt: existingUser?.firstSeenAt ?? now,
        lastSeenAt: now,
        messageCount: (existingUser?.messageCount ?? 0) + 1,
        lookupCount: existingUser?.lookupCount ?? 0,
      };
    }

    await this.save();
  }

  async recordLookup(event: UsageEvent, outcome: "success" | "failure"): Promise<void> {
    const now = new Date().toISOString();
    this.stats.totalLookups += 1;
    this.stats.updatedAt = now;

    if (outcome === "success") {
      this.stats.successfulLookups += 1;
    } else {
      this.stats.failedLookups += 1;
    }

    this.stats.lookupEvents.push({
      timestamp: now,
      chatId: String(event.chatId),
      outcome,
    });
    this.pruneLookupEvents();

    const chatKey = String(event.chatId);
    const existingChat = this.stats.chats[chatKey];
    this.stats.chats[chatKey] = {
      id: chatKey,
      type: event.chatType,
      title: event.chatTitle ?? existingChat?.title,
      username: event.chatUsername ?? existingChat?.username,
      firstName: event.firstName ?? existingChat?.firstName,
      firstSeenAt: existingChat?.firstSeenAt ?? now,
      lastSeenAt: existingChat?.lastSeenAt ?? now,
      messageCount: existingChat?.messageCount ?? 0,
      lookupCount: (existingChat?.lookupCount ?? 0) + 1,
      lastLookupAt: now,
    };

    if (event.userId !== undefined) {
      const userKey = String(event.userId);
      const existingUser = this.stats.users[userKey];
      this.stats.users[userKey] = {
        id: userKey,
        username: event.username ?? existingUser?.username,
        firstName: event.firstName ?? existingUser?.firstName,
        firstSeenAt: existingUser?.firstSeenAt ?? now,
        lastSeenAt: existingUser?.lastSeenAt ?? now,
        messageCount: existingUser?.messageCount ?? 0,
        lookupCount: (existingUser?.lookupCount ?? 0) + 1,
      };
    }

    await this.save();
  }

  getSummary(): UsageSummary {
    const chats = Object.values(this.stats.chats);
    const users = Object.values(this.stats.users);
    const now = Date.now();
    const lastHour = now - 60 * 60 * 1000;
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const requestsLastHour = this.stats.lookupEvents.filter(
      (event) => new Date(event.timestamp).getTime() >= lastHour,
    );
    const requestsLast24h = this.stats.lookupEvents.filter(
      (event) => new Date(event.timestamp).getTime() >= last24h,
    );

    const groupChats = chats.filter(
      (chat) => chat.type === "group" || chat.type === "supergroup",
    );

    return {
      createdAt: this.stats.createdAt,
      updatedAt: this.stats.updatedAt,
      totalMessages: this.stats.totalMessages,
      totalLookups: this.stats.totalLookups,
      successfulLookups: this.stats.successfulLookups,
      failedLookups: this.stats.failedLookups,
      requestsLastHour: requestsLastHour.length,
      requestsLast24h: requestsLast24h.length,
      successfulRequestsLastHour: requestsLastHour.filter(
        (event) => event.outcome === "success",
      ).length,
      failedRequestsLastHour: requestsLastHour.filter(
        (event) => event.outcome === "failure",
      ).length,
      uniqueChats: chats.length,
      privateChats: chats.filter((chat) => chat.type === "private").length,
      groupChats: groupChats.length,
      uniqueUsers: users.length,
      activeChats24h: chats.filter(
        (chat) => new Date(chat.lastSeenAt).getTime() >= last24h,
      ).length,
      activeGroups24h: groupChats.filter(
        (chat) => new Date(chat.lastSeenAt).getTime() >= last24h,
      ).length,
      topGroups: groupChats
        .sort((a, b) => b.lookupCount - a.lookupCount || b.messageCount - a.messageCount)
        .slice(0, 10),
    };
  }

  private pruneLookupEvents(): void {
    const cutoff = Date.now() - LOOKUP_EVENT_RETENTION_MS;
    this.stats.lookupEvents = this.stats.lookupEvents.filter(
      (event) => new Date(event.timestamp).getTime() >= cutoff,
    );
  }

  private async save(): Promise<void> {
    this.saveQueue = this.saveQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(this.stats, null, 2));
    });

    await this.saveQueue;
  }
}
