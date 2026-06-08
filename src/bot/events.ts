import type { TurnContext } from "botbuilder";

export type TeamsContextSnapshot = {
  tenantId: string;
  teamId: string;
  serviceUrl: string;
};

export const getTeamsContextSnapshot = (context: TurnContext): TeamsContextSnapshot => {
  const activity = context.activity as typeof context.activity & {
    channelData?: {
      team?: {
        id?: string;
      };
      tenant?: {
        id?: string;
      };
    };
    conversation?: {
      tenantId?: string;
    };
  };

  const tenantId = activity.conversation?.tenantId ?? activity.channelData?.tenant?.id;

  const teamId = activity.channelData?.team?.id;

  if (!tenantId) {
    throw new Error("Missing tenant id in Teams activity");
  }

  if (!teamId) {
    throw new Error("Missing team id in Teams activity");
  }

  return {
    tenantId,
    teamId,
    serviceUrl: context.activity.serviceUrl,
  };
};

export const isBotAddedEvent = (context: TurnContext): boolean => {
  const botId = context.activity.recipient?.id;
  const membersAdded = context.activity.membersAdded ?? [];

  return membersAdded.some((member) => member.id === botId);
};
