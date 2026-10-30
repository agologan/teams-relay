import {
  AgentApplication,
  AuthType,
  CloudAdapter,
  OutboundHostValidator,
  type TurnContext,
} from "@microsoft/agents-hosting";

import { config } from "../config";

const hosts = new OutboundHostValidator({
  enabled: true,
  includeDefaultMicrosoftHosts: false,
  hosts: config.botServiceUrlHosts,
});

export const serviceUrlPolicy = {
  enabled: true,
  isAllowed(value: string | URL | null | undefined): boolean {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && hosts.isAllowed(url);
    } catch {
      return false;
    }
  },
};

export const adapter = new CloudAdapter(
  {
    clientId: config.botAppId,
    clientSecret: config.botAppPassword,
    tenantId: config.botTenantId,
    authType: AuthType.ClientSecret,
    validateIssuer: true,
  },
  undefined,
  undefined,
  undefined,
  serviceUrlPolicy,
);

export const agent = new AgentApplication({ adapter, agentAppId: config.botAppId });

agent.onError(async (context: TurnContext, error: Error) => {
  console.error("[bot] unhandled error", error);

  try {
    await context.sendActivity("Teams Relay hit error. Check server logs.");
  } catch (sendError) {
    console.error("[bot] failed sending error activity", sendError);
  }
});
