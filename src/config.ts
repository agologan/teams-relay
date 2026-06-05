import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  INTERNAL_PORT: z.coerce.number().int().positive().default(3001),
  BOT_APP_ID: z.string().optional(),
  CLIENT_ID: z.string().optional(),
  BOT_APP_PASSWORD: z.string().optional(),
  CLIENT_SECRET: z.string().optional(),
  BOT_TENANT_ID: z.string().optional(),
  TENANT_ID: z.string().optional(),
  BOT_APP_TYPE: z.enum(['SingleTenant', 'MultiTenant', 'UserAssignedMSI']).default('SingleTenant'),
  STORAGE_BACKEND: z.enum(['dynamodb', 'sqlite']).default('dynamodb'),
  DYNAMODB_ENDPOINT: z.string().optional(),
  DYNAMODB_REGION: z.string().default('us-east-1'),
  DYNAMODB_TABLE: z.string().default('teams-relay'),
  SQLITE_FILENAME: z.string().default('teams-relay.sqlite'),
  WEBHOOK_TOKENS: z.string().default(''),
  INTERNAL_WEBHOOK_AUTH_ENABLED: z.stringbool().default(false),
})

const rawEnv = envSchema.parse(process.env)

const botAppId = rawEnv.BOT_APP_ID ?? rawEnv.CLIENT_ID
const botAppPassword = rawEnv.BOT_APP_PASSWORD ?? rawEnv.CLIENT_SECRET
const botTenantId = rawEnv.BOT_TENANT_ID ?? rawEnv.TENANT_ID
const webhookTokens = rawEnv.WEBHOOK_TOKENS.split(',')
  .map((token) => token.trim())
  .filter(Boolean)

if (!botAppId) {
  throw new Error('Missing BOT_APP_ID or CLIENT_ID')
}

if (!botAppPassword) {
  throw new Error('Missing BOT_APP_PASSWORD or CLIENT_SECRET')
}

if (!botTenantId) {
  throw new Error('Missing BOT_TENANT_ID or TENANT_ID')
}

export const config = {
  port: rawEnv.PORT,
  internalPort: rawEnv.INTERNAL_PORT,
  botAppId,
  botAppPassword,
  botTenantId,
  botAppType: rawEnv.BOT_APP_TYPE,
  storageBackend: rawEnv.STORAGE_BACKEND,
  dynamo: {
    endpoint: rawEnv.DYNAMODB_ENDPOINT,
    region: rawEnv.DYNAMODB_REGION,
    tableName: rawEnv.DYNAMODB_TABLE,
  },
  sqlite: {
    filename: rawEnv.SQLITE_FILENAME,
  },
  webhooks: {
    tokens: webhookTokens,
    internalAuthEnabled: rawEnv.INTERNAL_WEBHOOK_AUTH_ENABLED,
  },
} as const
