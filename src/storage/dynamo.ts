import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

import { config } from '../config'

const isLocalEndpoint = config.dynamo.endpoint?.includes('localhost') || config.dynamo.endpoint?.includes('127.0.0.1') || config.dynamo.endpoint?.includes('dynamodb-local')

const baseClient = new DynamoDBClient({
  region: config.dynamo.region,
  ...(config.dynamo.endpoint ? { endpoint: config.dynamo.endpoint } : {}),
  ...(isLocalEndpoint
    ? {
        credentials: {
          accessKeyId: 'local',
          secretAccessKey: 'local',
        },
      }
    : {}),
})

export const dynamo = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
})
