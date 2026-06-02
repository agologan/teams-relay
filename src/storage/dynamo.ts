import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

import { config } from '../config'

const baseClient = new DynamoDBClient({
  region: config.dynamo.region,
  endpoint: config.dynamo.endpoint,
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  },
})

export const dynamo = DynamoDBDocumentClient.from(baseClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
})
