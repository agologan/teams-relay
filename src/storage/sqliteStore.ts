import { DatabaseSync } from 'node:sqlite'

import { config } from '../config'
import type { ChannelRecord, InstallationRecord } from './schema'
import type { KnownTeamsResponse, TeamsRelayStore } from './types'

type InstallationRow = {
  tenant_id: string
  team_id: string
  team_name: string | null
  service_url: string
  updated_at: string
}

type ChannelRow = {
  tenant_id: string
  team_id: string
  channel_id: string
  channel_name: string
  status: string
  updated_at: string
}

const fallbackTeamName = (teamId: string) => `Unknown team (${teamId})`

export class SqliteTeamsRelayStore implements TeamsRelayStore {
  private readonly db: DatabaseSync

  constructor(filename = config.sqlite.filename) {
    this.db = new DatabaseSync(filename)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS installations (
        tenant_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        team_name TEXT,
        service_url TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, team_id)
      );

      CREATE TABLE IF NOT EXISTS channels (
        tenant_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, team_id, channel_id)
      );

      CREATE INDEX IF NOT EXISTS idx_installations_team_id ON installations (team_id);
      CREATE INDEX IF NOT EXISTS idx_channels_team_channel ON channels (team_id, channel_id);
    `)
  }

  async upsertInstallation(record: InstallationRecord): Promise<void> {
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO installations (tenant_id, team_id, team_name, service_url, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, team_id) DO UPDATE SET
        team_name = excluded.team_name,
        service_url = excluded.service_url,
        updated_at = excluded.updated_at
    `).run(record.tenantId, record.teamId, record.teamName ?? null, record.serviceUrl, now)
  }

  async upsertChannel(record: ChannelRecord): Promise<void> {
    const now = new Date().toISOString()

    this.db.prepare(`
      INSERT INTO channels (tenant_id, team_id, channel_id, channel_name, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, team_id, channel_id) DO UPDATE SET
        channel_name = excluded.channel_name,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      record.tenantId,
      record.teamId,
      record.channelId,
      record.channelName,
      record.status,
      now,
    )
  }

  async markChannelDeleted(input: Omit<ChannelRecord, 'status'>): Promise<void> {
    await this.upsertChannel({ ...input, status: 'deleted' })
  }

  async getTeam(teamId: string): Promise<KnownTeamsResponse['teams'][number] | null> {
    const knownTeams = await this.listKnownTeams()

    return knownTeams.teams.find((team) => team.teamId === teamId) ?? null
  }

  async getChannel(teamId: string, channelId: string) {
    const row = this.db.prepare(`
      SELECT
        c.tenant_id,
        c.team_id,
        c.channel_id,
        c.channel_name,
        i.service_url
      FROM channels c
      JOIN installations i ON i.tenant_id = c.tenant_id AND i.team_id = c.team_id
      WHERE c.team_id = ? AND c.channel_id = ?
      LIMIT 1
    `).get(teamId, channelId) as
      | {
          tenant_id: string
          team_id: string
          channel_id: string
          channel_name: string
          service_url: string
        }
      | undefined

    if (!row) {
      return null
    }

    return {
      tenantId: row.tenant_id,
      teamId: row.team_id,
      channelId: row.channel_id,
      channelName: row.channel_name,
      serviceUrl: row.service_url,
    }
  }

  async listKnownTeams(): Promise<KnownTeamsResponse> {
    const installations = this.db.prepare(`
      SELECT tenant_id, team_id, team_name, service_url, updated_at
      FROM installations
      ORDER BY team_name, team_id
    `).all() as InstallationRow[]

    const channels = this.db.prepare(`
      SELECT tenant_id, team_id, channel_id, channel_name, status, updated_at
      FROM channels
      ORDER BY channel_name, channel_id
    `).all() as ChannelRow[]

    const teams = new Map<string, KnownTeamsResponse['teams'][number]>()

    for (const installation of installations) {
      teams.set(`${installation.tenant_id}:${installation.team_id}`, {
        tenantId: installation.tenant_id,
        teamId: installation.team_id,
        teamName: installation.team_name ?? fallbackTeamName(installation.team_id),
        installation: {
          serviceUrl: installation.service_url,
          updatedAt: installation.updated_at,
        },
        channels: [],
      })
    }

    for (const channel of channels) {
      const key = `${channel.tenant_id}:${channel.team_id}`
      const team = teams.get(key) ?? {
        tenantId: channel.tenant_id,
        teamId: channel.team_id,
        teamName: fallbackTeamName(channel.team_id),
        channels: [],
      }

      team.channels.push({
        channelId: channel.channel_id,
        channelName: channel.channel_name,
        status: channel.status,
        updatedAt: channel.updated_at,
      })
      teams.set(key, team)
    }

    return {
      teams: [...teams.values()].map((team) => ({
        ...team,
        channels: team.channels.sort((a, b) => a.channelName.localeCompare(b.channelName)),
      })),
    }
  }
}
