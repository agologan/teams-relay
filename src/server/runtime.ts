import { sendToTeamsChannel } from "../bot/send";
import { enqueueTeamsChannelSend } from "../bot/sendQueue";
import { metrics } from "../metrics";
import { storage } from "../storage/adapter";
import type { StorageAdapter } from "../storage/types";
import { renderWebhookTemplate } from "../templates";

export type ServerRuntimeDeps = {
  storage: StorageAdapter;
  sendToTeamsChannel: typeof sendToTeamsChannel;
  enqueueTeamsChannelSend: typeof enqueueTeamsChannelSend;
  renderWebhookTemplate: typeof renderWebhookTemplate;
  metrics: typeof metrics;
};

const defaultRuntimeDeps: ServerRuntimeDeps = {
  storage,
  sendToTeamsChannel,
  enqueueTeamsChannelSend,
  renderWebhookTemplate,
  metrics,
};

let runtimeDeps = defaultRuntimeDeps;

export const getServerRuntimeDeps = () => runtimeDeps;

export const setServerRuntimeDeps = (deps: Partial<ServerRuntimeDeps>) => {
  runtimeDeps = {
    ...runtimeDeps,
    ...deps,
  };
};

export const resetServerRuntimeDeps = () => {
  runtimeDeps = defaultRuntimeDeps;
};
