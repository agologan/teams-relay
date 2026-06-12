export const makeTestingStore = ({ teams = [], sendableChannels = new Map() } = {}) => ({
  async upsertInstallation() {},
  async upsertChannel() {},
  async markChannelDeleted() {},
  async getTeam(teamId) {
    return teams.find((team) => team.teamId === teamId) ?? null;
  },
  async getChannel(teamId, channelId) {
    return sendableChannels.get(`${teamId}:${channelId}`) ?? null;
  },
  async listKnownTeams() {
    return { teams };
  },
});

export const makeSendableChannel = ({
  tenantId = "tenant",
  teamId = "team",
  channelId = "channel",
  channelName = "Alerts",
  serviceUrl = "https://service",
} = {}) => ({
  tenantId,
  teamId,
  channelId,
  channelName,
  serviceUrl,
});
