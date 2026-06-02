import type { ChannelRecord, ChannelStatus, InstallationRecord } from './schema'

export type KnownChannel = {
  channelId: string
  channelName: string
  status?: string
  updatedAt?: string
}

export type KnownInstallation = {
  serviceUrl?: string
  updatedAt?: string
}

export type KnownTeam = {
  tenantId: string
  teamId: string
  teamName: string
  installation?: KnownInstallation
  channels: KnownChannel[]
}

export type KnownTeamsResponse = {
  teams: KnownTeam[]
}

export type SendableChannel = {
  tenantId: string
  teamId: string
  channelId: string
  channelName: string
  serviceUrl: string
}

export type TeamsRelayStore = {
  upsertInstallation(record: InstallationRecord): Promise<void>
  upsertChannel(record: ChannelRecord): Promise<void>
  markChannelDeleted(input: Omit<ChannelRecord, 'status'>): Promise<void>
  getTeam(teamId: string): Promise<KnownTeam | null>
  getChannel(teamId: string, channelId: string): Promise<SendableChannel | null>
  listKnownTeams(): Promise<KnownTeamsResponse>
}

export type StoredChannelStatus = ChannelStatus | string
