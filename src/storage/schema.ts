export type ChannelStatus = 'active' | 'deleted'

export type InstallationRecord = {
  tenantId: string
  teamId: string
  teamName?: string | null
  serviceUrl: string
}

export type ChannelRecord = {
  tenantId: string
  teamId: string
  channelId: string
  channelName: string
  status: ChannelStatus
}

export const makeTeamPk = (tenantId: string, teamId: string) => `TENANT#${tenantId}#TEAM#${teamId}`
export const installationSk = 'INSTALLATION'
export const makeChannelSk = (channelId: string) => `CHANNEL#${channelId}`
