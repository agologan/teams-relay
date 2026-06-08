import { ActivityTypes, CardFactory, type Activity } from "botbuilder";

import { adapter } from "./adapter";
import { config } from "../config";

type SendTarget = {
  channelId: string;
  serviceUrl: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAdaptiveCard = (value: Record<string, unknown>) =>
  value.type === "AdaptiveCard" ||
  value.$schema === "http://adaptivecards.io/schemas/adaptive-card.json";

const isMessageCard = (value: Record<string, unknown>) =>
  value["@type"] === "MessageCard" ||
  value["@context"] === "https://schema.org/extensions" ||
  Array.isArray(value.potentialAction) ||
  Array.isArray(value.sections);

export const buildActivityFromWebhookPayload = (payload: Record<string, unknown>): Activity => {
  if (payload.type === ActivityTypes.Message || payload.type === "message") {
    return payload as unknown as Activity;
  }

  if (Array.isArray(payload.attachments)) {
    const activity = {
      type: ActivityTypes.Message,
      attachments: payload.attachments as Activity["attachments"],
    } as Partial<Activity>;

    if (typeof payload.text === "string") {
      activity.text = payload.text;
    }

    if (typeof payload.summary === "string") {
      activity.summary = payload.summary;
    }

    return activity as Activity;
  }

  if (isRecord(payload.card)) {
    const activity = {
      type: ActivityTypes.Message,
      attachments: [
        isMessageCard(payload.card)
          ? CardFactory.o365ConnectorCard(payload.card)
          : CardFactory.adaptiveCard(payload.card),
      ],
    } as Partial<Activity>;

    if (typeof payload.summary === "string") {
      activity.summary = payload.summary;
    }

    return activity as Activity;
  }

  if (isRecord(payload.messageCard)) {
    const activity = {
      type: ActivityTypes.Message,
      attachments: [CardFactory.o365ConnectorCard(payload.messageCard)],
    } as Partial<Activity>;

    if (typeof payload.summary === "string") {
      activity.summary = payload.summary;
    }

    return activity as Activity;
  }

  if (isMessageCard(payload)) {
    const activity = {
      type: ActivityTypes.Message,
      attachments: [CardFactory.o365ConnectorCard(payload)],
    } as Partial<Activity>;

    if (typeof payload.summary === "string") {
      activity.summary = payload.summary;
    }

    return activity as Activity;
  }

  if (isAdaptiveCard(payload)) {
    const activity = {
      type: ActivityTypes.Message,
      attachments: [CardFactory.adaptiveCard(payload)],
    } as Partial<Activity>;

    if (typeof payload.summary === "string") {
      activity.summary = payload.summary;
    }

    return activity as Activity;
  }

  if (typeof payload.text === "string") {
    return {
      type: ActivityTypes.Message,
      text: payload.text,
    } as Activity;
  }

  throw new Error(
    "Unsupported webhook payload. Send Activity, { attachments }, { card }, { messageCard }, MessageCard, AdaptiveCard, or { text }.",
  );
};

export const sendToTeamsChannel = async (target: SendTarget, activity: Activity) => {
  const conversationParameters = {
    bot: { id: config.botAppId, name: "Teams Relay" },
    isGroup: true,
    channelData: {
      channel: {
        id: target.channelId,
      },
    },
    activity,
  };

  let conversationId: string | undefined;
  let activityId: string | undefined;

  await adapter.createConversationAsync(
    config.botAppId,
    "msteams",
    target.serviceUrl,
    "",
    conversationParameters,
    async (context) => {
      conversationId = context.activity.conversation.id;
      activityId = context.activity.id;
    },
  );

  return {
    conversationId,
    activityId,
  };
};
