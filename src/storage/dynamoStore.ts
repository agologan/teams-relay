import { GetCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { config } from "../config";
import { dynamo } from "./dynamo";
import {
  ChannelRecord,
  installationSk,
  InstallationRecord,
  makeChannelSk,
  makeTeamPk,
} from "./schema";
import type { KnownTeamsResponse, TeamsRelayStore } from "./types";

type RawInstallationItem = {
  PK?: string;
  SK?: string;
  entityType: "Installation";
  tenantId: string;
  teamId: string;
  teamName?: string | null;
  serviceUrl?: string;
  updatedAt?: string;
};

type RawChannelItem = {
  PK?: string;
  SK?: string;
  entityType: "Channel";
  tenantId: string;
  teamId: string;
  channelId: string;
  channelName?: string;
  status?: string;
  updatedAt?: string;
};

type RawKnownItem = RawInstallationItem | RawChannelItem;

type CachedInstallation = {
  tenantId: string;
  teamId: string;
  serviceUrl: string;
  updatedAt?: string;
};

// Assumes teamId is unique for webhook routing; duplicate teamIds across tenants collide here.
const installationsByTeamId = new Map<string, CachedInstallation>();
let installationCacheLoaded = false;

const makeTeamKey = (tenantId: string, teamId: string) => `${tenantId}:${teamId}`;
const fallbackTeamName = (teamId: string) => `Unknown team (${teamId})`;
const fallbackChannelName = (channelId: string) => `Unknown channel (${channelId})`;

export class DynamoTeamsRelayStore implements TeamsRelayStore {
  async upsertInstallation(record: InstallationRecord): Promise<void> {
    const now = new Date().toISOString();

    await dynamo.send(
      new UpdateCommand({
        TableName: config.dynamo.tableName,
        Key: {
          PK: makeTeamPk(record.tenantId, record.teamId),
          SK: installationSk,
        },
        UpdateExpression: [
          "SET #entityType = :entityType",
          "tenantId = :tenantId",
          "teamId = :teamId",
          "teamName = :teamName",
          "serviceUrl = :serviceUrl",
          "updatedAt = :updatedAt",
        ].join(", "),
        ExpressionAttributeNames: {
          "#entityType": "entityType",
        },
        ExpressionAttributeValues: {
          ":entityType": "Installation",
          ":tenantId": record.tenantId,
          ":teamId": record.teamId,
          ":teamName": record.teamName ?? null,
          ":serviceUrl": record.serviceUrl,
          ":updatedAt": now,
        },
      }),
    );

    installationsByTeamId.set(record.teamId, {
      tenantId: record.tenantId,
      teamId: record.teamId,
      serviceUrl: record.serviceUrl,
      updatedAt: now,
    });
  }

  async upsertChannel(record: ChannelRecord): Promise<void> {
    const now = new Date().toISOString();

    await dynamo.send(
      new UpdateCommand({
        TableName: config.dynamo.tableName,
        Key: {
          PK: makeTeamPk(record.tenantId, record.teamId),
          SK: makeChannelSk(record.channelId),
        },
        UpdateExpression: [
          "SET #entityType = :entityType",
          "tenantId = :tenantId",
          "teamId = :teamId",
          "channelId = :channelId",
          "channelName = :channelName",
          "#status = :status",
          "updatedAt = :updatedAt",
        ].join(", "),
        ExpressionAttributeNames: {
          "#entityType": "entityType",
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":entityType": "Channel",
          ":tenantId": record.tenantId,
          ":teamId": record.teamId,
          ":channelId": record.channelId,
          ":channelName": record.channelName,
          ":status": record.status,
          ":updatedAt": now,
        },
      }),
    );
  }

  async markChannelDeleted(input: Omit<ChannelRecord, "status">): Promise<void> {
    await this.upsertChannel({ ...input, status: "deleted" });
  }

  async getTeam(teamId: string): Promise<KnownTeamsResponse["teams"][number] | null> {
    const knownTeams = await this.listKnownTeams();

    return knownTeams.teams.find((team) => team.teamId === teamId) ?? null;
  }

  private async getCachedInstallation(teamId: string): Promise<CachedInstallation | null> {
    const cached = installationsByTeamId.get(teamId);

    if (cached) {
      return cached;
    }

    if (installationCacheLoaded) {
      return null;
    }

    await this.loadInstallationCache();
    return installationsByTeamId.get(teamId) ?? null;
  }

  private async loadInstallationCache(): Promise<void> {
    let ExclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamo.send(
        new ScanCommand({
          TableName: config.dynamo.tableName,
          ExclusiveStartKey,
          FilterExpression: "#entityType = :entityType",
          ExpressionAttributeNames: {
            "#entityType": "entityType",
          },
          ExpressionAttributeValues: {
            ":entityType": "Installation",
          },
        }),
      );

      for (const item of (result.Items ?? []) as RawInstallationItem[]) {
        if (!item.tenantId || !item.teamId || !item.serviceUrl) {
          continue;
        }

        installationsByTeamId.set(item.teamId, {
          tenantId: item.tenantId,
          teamId: item.teamId,
          serviceUrl: item.serviceUrl,
          updatedAt: item.updatedAt,
        });
      }

      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    installationCacheLoaded = true;
  }

  async getChannel(teamId: string, channelId: string) {
    const installation = await this.getCachedInstallation(teamId);

    if (!installation) {
      return null;
    }

    const result = await dynamo.send(
      new GetCommand({
        TableName: config.dynamo.tableName,
        Key: {
          PK: makeTeamPk(installation.tenantId, teamId),
          SK: makeChannelSk(channelId),
        },
      }),
    );
    const channel = result.Item as RawChannelItem | undefined;

    if (!channel || channel.entityType !== "Channel") {
      return null;
    }

    return {
      tenantId: installation.tenantId,
      teamId,
      channelId: channel.channelId,
      channelName: channel.channelName ?? fallbackChannelName(channelId),
      serviceUrl: installation.serviceUrl,
    };
  }

  async listKnownTeams(): Promise<KnownTeamsResponse> {
    const items: RawKnownItem[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const result = await dynamo.send(
        new ScanCommand({
          TableName: config.dynamo.tableName,
          ExclusiveStartKey,
        }),
      );

      items.push(...((result.Items ?? []) as RawKnownItem[]));
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);

    const teams = new Map<string, KnownTeamsResponse["teams"][number]>();

    for (const item of items) {
      if (!item.tenantId || !item.teamId) {
        continue;
      }

      const key = makeTeamKey(item.tenantId, item.teamId);
      const team = teams.get(key) ?? {
        tenantId: item.tenantId,
        teamId: item.teamId,
        teamName: fallbackTeamName(item.teamId),
        channels: [],
      };

      if (item.entityType === "Installation") {
        team.teamName = item.teamName ?? team.teamName;
        team.installation = {
          serviceUrl: item.serviceUrl,
          updatedAt: item.updatedAt,
        };
      }

      if (item.entityType === "Channel") {
        team.channels.push({
          channelId: item.channelId,
          channelName: item.channelName ?? fallbackChannelName(item.channelId),
          status: item.status,
          updatedAt: item.updatedAt,
        });
      }

      teams.set(key, team);
    }

    return {
      teams: [...teams.values()].map((team) => ({
        ...team,
        channels: team.channels.sort((a, b) => a.channelName.localeCompare(b.channelName)),
      })),
    };
  }
}
