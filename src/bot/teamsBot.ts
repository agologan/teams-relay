import { ActivityTypes } from "@microsoft/agents-activity";
import { TurnState, type TurnContext } from "@microsoft/agents-hosting";
import {
  TeamsAgentExtension,
  TeamsTurnContext,
} from "@microsoft/agents-hosting-extensions-msteams";

import { storage } from "../storage/adapter";
import type { ChannelStatus } from "../storage/schema";
import { agent } from "./adapter";
import { getTeamsContextSnapshot, isBotAddedEvent } from "./events";

const requireValue = <T>(value: T | null | undefined, message: string): T => {
  if (value == null) {
    throw new Error(message);
  }

  return value;
};

type ChannelInfo = {
  id?: string;
  name?: string | null;
};

const getChannelName = (channel: ChannelInfo, teamId: string): string => {
  if (channel.name?.trim()) {
    return channel.name;
  }

  if (channel.id === teamId) {
    return "General";
  }

  return channel.id ?? "Unknown channel";
};

const upsertChannelFromEvent = async (
  context: TurnContext,
  channelInfo: ChannelInfo,
  status: ChannelStatus,
): Promise<void> => {
  const snapshot = getTeamsContextSnapshot(context);
  const channelId = requireValue(channelInfo.id, "Teams channel event missing id");

  await storage.upsertChannel({
    tenantId: snapshot.tenantId,
    teamId: snapshot.teamId,
    channelId,
    channelName: getChannelName(channelInfo, snapshot.teamId),
    status,
  });

  console.log("[bot] channel event stored", {
    teamId: snapshot.teamId,
    channelId,
    channelName: channelInfo.name,
    status,
  });
};

const handleInstall = async (context: TurnContext): Promise<void> => {
  const snapshot = getTeamsContextSnapshot(context);
  const teamsContext = new TeamsTurnContext(context);

  let teamName: string | null = null;
  try {
    teamName = (await teamsContext.client.teams.getById(snapshot.teamId)).name ?? null;
  } catch (error) {
    console.warn("[bot] failed loading team details", { teamId: snapshot.teamId, error });
  }

  await storage.upsertInstallation({
    tenantId: snapshot.tenantId,
    teamId: snapshot.teamId,
    teamName,
    serviceUrl: snapshot.serviceUrl,
  });

  const channels = await teamsContext.client.teams.getConversations(snapshot.teamId);

  for (const channel of channels) {
    const channelId = requireValue(channel.id, "Teams channel missing id during install sync");

    await storage.upsertChannel({
      tenantId: snapshot.tenantId,
      teamId: snapshot.teamId,
      channelId,
      channelName: getChannelName(channel, snapshot.teamId),
      status: "active",
    });
  }

  console.log("[bot] install complete", {
    teamId: snapshot.teamId,
    channelCount: channels.length,
  });
};

// Teams SDK appends paths without removing the service URL's trailing slash.
agent.onTurn("beforeTurn", async (context) => {
  if (context.activity.channelId === "msteams" && context.activity.serviceUrl) {
    context.activity.serviceUrl = context.activity.serviceUrl.replace(/\/+$/, "");
  }
  return true;
});

const teamsExtension = new TeamsAgentExtension(agent);
agent.registerExtension<TeamsAgentExtension>(teamsExtension, (extension) => {
  extension.channels
    .onCreated((context, _state, channelInfo) =>
      upsertChannelFromEvent(context, channelInfo, "active"),
    )
    .onRenamed((context, _state, channelInfo) =>
      upsertChannelFromEvent(context, channelInfo, "active"),
    )
    .onDeleted((context, _state, channelInfo) =>
      upsertChannelFromEvent(context, channelInfo, "deleted"),
    )
    .onRestored((context, _state, channelInfo) =>
      upsertChannelFromEvent(context, channelInfo, "active"),
    );
});

agent.onConversationUpdate("membersAdded", async (context, _state: TurnState) => {
  if (isBotAddedEvent(context)) {
    await handleInstall(context);
  }
});

agent.onActivity(
  async (context) => {
    const channelData = context.activity.channelData as { eventType?: string } | undefined;
    return (
      context.activity.type === ActivityTypes.ConversationUpdate &&
      context.activity.channelId === "msteams" &&
      (channelData?.eventType === "channelArchived" ||
        channelData?.eventType === "channelUnarchived")
    );
  },
  async (context) => {
    const channelData = context.activity.channelData as
      | { eventType?: string; channel?: ChannelInfo }
      | undefined;
    if (!channelData?.channel) {
      console.warn("[bot] channel archive event missing channel", {
        eventType: channelData?.eventType,
      });
      return;
    }

    await upsertChannelFromEvent(
      context,
      channelData.channel,
      channelData.eventType === "channelArchived" ? "archived" : "active",
    );
  },
);

export { agent };
