import {
  TeamsActivityHandler,
  TeamsInfo,
  TurnContext,
  type ChannelInfo,
  type TeamsChannelData,
} from "botbuilder";

import { storage } from "../storage/adapter";
import type { ChannelStatus } from "../storage/schema";
import { getTeamsContextSnapshot, isBotAddedEvent } from "./events";

const requireValue = <T>(value: T | null | undefined, message: string): T => {
  if (value == null) {
    throw new Error(message);
  }

  return value;
};

const getTeamName = async (context: TurnContext, teamId: string): Promise<string | null> => {
  try {
    const teamDetails = await TeamsInfo.getTeamDetails(context, teamId);

    return teamDetails.name ?? null;
  } catch (error) {
    console.warn("[bot] failed loading team details", { teamId, error });
    return null;
  }
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

export class TeamsRelayBot extends TeamsActivityHandler {
  constructor() {
    super();

    this.onMembersAdded(async (context, next) => {
      if (!isBotAddedEvent(context)) {
        await next();
        return;
      }

      await this.handleInstall(context);
      await next();
    });

    this.onTeamsChannelCreatedEvent(async (channelInfo, _teamInfo, context, next) => {
      await this.upsertChannelFromEvent(context, channelInfo, "active");
      await next();
    });

    this.onTeamsChannelRenamedEvent(async (channelInfo, _teamInfo, context, next) => {
      await this.upsertChannelFromEvent(context, channelInfo, "active");
      await next();
    });

    this.onTeamsChannelDeletedEvent(async (channelInfo, _teamInfo, context, next) => {
      await this.upsertChannelFromEvent(context, channelInfo, "deleted");
      await next();
    });

    this.onTeamsChannelRestoredEvent(async (channelInfo, _teamInfo, context, next) => {
      await this.upsertChannelFromEvent(context, channelInfo, "active");
      await next();
    });
  }

  private async handleInstall(context: TurnContext): Promise<void> {
    const snapshot = getTeamsContextSnapshot(context);

    const teamName = await getTeamName(context, snapshot.teamId);

    await storage.upsertInstallation({
      tenantId: snapshot.tenantId,
      teamId: snapshot.teamId,
      teamName,
      serviceUrl: snapshot.serviceUrl,
    });

    const channels = await TeamsInfo.getTeamChannels(context, snapshot.teamId);

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
  }

  protected override async dispatchConversationUpdateActivity(context: TurnContext): Promise<void> {
    const channelData = context.activity.channelData as TeamsChannelData | undefined;

    if (context.activity.channelId === "msteams" && channelData?.eventType) {
      if (channelData.eventType === "channelArchived" && channelData.channel) {
        await this.upsertChannelFromEvent(context, channelData.channel, "archived");
        return;
      }

      if (channelData.eventType === "channelUnarchived" && channelData.channel) {
        await this.upsertChannelFromEvent(context, channelData.channel, "active");
        return;
      }
    }

    await super.dispatchConversationUpdateActivity(context);
  }

  private async upsertChannelFromEvent(
    context: TurnContext,
    channelInfo: ChannelInfo,
    status: ChannelStatus,
  ): Promise<void> {
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
  }
}

export const bot = new TeamsRelayBot();
