import { config } from '../config'
import { DynamoTeamsRelayStore } from './dynamoStore'
import { SqliteTeamsRelayStore } from './sqliteStore'
import type { TeamsRelayStore } from './types'

const store: TeamsRelayStore = config.storageBackend === 'sqlite'
  ? new SqliteTeamsRelayStore()
  : new DynamoTeamsRelayStore()

export const storage = {
  installations: {
    upsert: (record: Parameters<TeamsRelayStore['upsertInstallation']>[0]) =>
      store.upsertInstallation(record),
  },
  channels: {
    upsert: (record: Parameters<TeamsRelayStore['upsertChannel']>[0]) => store.upsertChannel(record),
    markDeleted: (input: Parameters<TeamsRelayStore['markChannelDeleted']>[0]) =>
      store.markChannelDeleted(input),
  },
  knownTeams: {
    getTeam: (teamId: string) => store.getTeam(teamId),
    getChannel: (teamId: string, channelId: string) => store.getChannel(teamId, channelId),
    list: () => store.listKnownTeams(),
  },
}

export { store }
export type { TeamsRelayStore }
