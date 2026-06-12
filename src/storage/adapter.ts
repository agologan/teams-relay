import { config } from "../config";
import { DynamoTeamsRelayStore } from "./dynamoStore";
import { SqliteTeamsRelayStore } from "./sqliteStore";
import type { StorageAdapter } from "./types";

export const storage: StorageAdapter =
  config.storageBackend === "sqlite" ? new SqliteTeamsRelayStore() : new DynamoTeamsRelayStore();
