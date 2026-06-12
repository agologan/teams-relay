import { sendToTeamsChannel } from "../bot/send";
import { metrics } from "../metrics";
import { store } from "../storage";
import type { TeamsRelayStore } from "../storage/types";
import { renderWebhookTemplate } from "../templates";

export type ServerRuntimeDeps = {
  storage: TeamsRelayStore;
  sendToTeamsChannel: typeof sendToTeamsChannel;
  renderWebhookTemplate: typeof renderWebhookTemplate;
  metrics: typeof metrics;
};

const defaultRuntimeDeps: ServerRuntimeDeps = {
  storage: store,
  sendToTeamsChannel,
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
