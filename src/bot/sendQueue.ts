import { randomUUID } from "node:crypto";

import type { Activity } from "botbuilder";

import { config } from "../config";
import { metrics } from "../metrics";
import { sendToTeamsChannel } from "./send";

type SendTarget = {
  teamId: string;
  channelId: string;
  serviceUrl: string;
};

type QueueItem = {
  id: string;
  target: SendTarget;
  activity: Activity;
  attempts: number;
  enqueuedAt: number;
};

let teamsChannelSender = sendToTeamsChannel;

const channelQueues = new Map<string, QueueItem[]>();
const activeChannels = new Set<string>();
const nextChannelSendAt = new Map<string, number>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForChannelSendSlot = async (key: string) => {
  const intervalMs = Math.ceil(1000 / config.teamsSend.targetRps);
  const delayMs = Math.max(0, (nextChannelSendAt.get(key) ?? 0) - Date.now());

  if (delayMs > 0) {
    await sleep(delayMs);
  }

  nextChannelSendAt.set(key, Date.now() + intervalMs);
};

const getQueueKey = (target: SendTarget) => `${target.teamId}:${target.channelId}`;

const getErrorStatusCode = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  const statusCode = record.statusCode ?? record.status ?? record.code;

  if (typeof statusCode === "number") {
    return statusCode;
  }

  if (typeof statusCode === "string") {
    const parsed = Number.parseInt(statusCode, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const getHeaderValue = (headers: unknown, name: string) => {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }

  if (typeof headers === "object") {
    const record = headers as Record<string, unknown>;
    const value = record[name] ?? record[name.toLowerCase()];

    if (Array.isArray(value)) {
      return typeof value[0] === "string" ? value[0] : undefined;
    }

    return typeof value === "string" ? value : undefined;
  }

  return undefined;
};

const getRetryAfterMs = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const record = error as Record<string, unknown>;
  const headers = record.headers ?? record.responseHeaders;
  const retryAfterMs = getHeaderValue(headers, "retry-after-ms");

  if (retryAfterMs) {
    const parsed = Number.parseInt(retryAfterMs, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const retryAfter = getHeaderValue(headers, "retry-after");

  if (!retryAfter) {
    return undefined;
  }

  const retryAfterSeconds = Number.parseInt(retryAfter, 10);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }

  return undefined;
};

const getBackoffMs = (attempts: number, error: unknown) => {
  const retryAfterMs = getRetryAfterMs(error);

  if (retryAfterMs !== undefined) {
    return retryAfterMs;
  }

  const exponential = config.teamsSend.backoffBaseMs * 2 ** Math.max(0, attempts - 1);
  const capped = Math.min(exponential, config.teamsSend.backoffMaxMs);
  const jitter = Math.floor(Math.random() * Math.min(1000, capped));

  return capped + jitter;
};

const processQueue = async (key: string) => {
  if (activeChannels.has(key)) {
    return;
  }

  activeChannels.add(key);

  try {
    while (true) {
      const queue = channelQueues.get(key);
      const item = queue?.shift();

      if (!item) {
        channelQueues.delete(key);
        nextChannelSendAt.delete(key);
        return;
      }

      metrics.setSendQueueDepth(totalQueueDepth());

      while (true) {
        try {
          item.attempts += 1;
          await waitForChannelSendSlot(key);
          await teamsChannelSender(item.target, item.activity);
          metrics.recordQueuedMessageDelivered(Date.now() - item.enqueuedAt);
          break;
        } catch (error) {
          const statusCode = getErrorStatusCode(error);
          const retryable =
            statusCode === 412 ||
            statusCode === 429 ||
            (statusCode !== undefined && statusCode >= 500);

          if (!retryable || item.attempts >= config.teamsSend.maxRetries) {
            metrics.recordQueuedMessageDropped(statusCode === 429 ? "throttled" : "failed");
            console.error("[send-queue] message dropped", {
              id: item.id,
              teamId: item.target.teamId,
              channelId: item.target.channelId,
              attempts: item.attempts,
              statusCode,
              error,
            });
            break;
          }

          const delayMs = getBackoffMs(item.attempts, error);
          metrics.recordQueuedMessageRetry(
            statusCode === 429 ? "429" : statusCode === 412 ? "412" : "5xx",
          );

          if (statusCode === 429) {
            metrics.recordSendThrottled();
          }

          console.warn("[send-queue] send retry scheduled", {
            id: item.id,
            teamId: item.target.teamId,
            channelId: item.target.channelId,
            attempts: item.attempts,
            statusCode,
            delayMs,
          });
          await sleep(delayMs);
        }
      }
    }
  } finally {
    activeChannels.delete(key);
  }
};

const totalQueueDepth = () =>
  Array.from(channelQueues.values()).reduce((total, queue) => total + queue.length, 0);

export const setTeamsChannelSenderForTesting = (sender: typeof sendToTeamsChannel) => {
  teamsChannelSender = sender;
};

export const resetSendQueueForTesting = () => {
  teamsChannelSender = sendToTeamsChannel;
  channelQueues.clear();
  activeChannels.clear();
  nextChannelSendAt.clear();
};

export const enqueueTeamsChannelSend = (target: SendTarget, activity: Activity) => {
  const item: QueueItem = {
    id: randomUUID(),
    target,
    activity,
    attempts: 0,
    enqueuedAt: Date.now(),
  };
  const key = getQueueKey(target);
  const queue = channelQueues.get(key) ?? [];

  queue.push(item);
  channelQueues.set(key, queue);
  metrics.recordQueuedMessage();
  metrics.setSendQueueDepth(totalQueueDepth());
  void processQueue(key);

  return {
    id: item.id,
    queueDepth: queue.length,
  };
};
