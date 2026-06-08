import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";

import { config } from "../config";

const isLocalEndpoint =
  config.dynamo.endpoint?.includes("localhost") ||
  config.dynamo.endpoint?.includes("127.0.0.1") ||
  config.dynamo.endpoint?.includes("dynamodb-local");

const client = new DynamoDBClient({
  region: config.dynamo.region,
  ...(config.dynamo.endpoint ? { endpoint: config.dynamo.endpoint } : {}),
  ...(isLocalEndpoint
    ? {
        credentials: {
          accessKeyId: "local",
          secretAccessKey: "local",
        },
      }
    : {}),
});

const tableName = config.dynamo.tableName;

const main = async () => {
  try {
    const existing = await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`[dynamodb] table exists: ${existing.Table?.TableName}`);
    return;
  } catch (error) {
    const isMissing = error instanceof Error && error.name === "ResourceNotFoundException";

    if (!isMissing) {
      throw error;
    }
  }

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
    }),
  );

  console.log(`[dynamodb] table created: ${tableName}`);
};

main().catch((error) => {
  console.error("[dynamodb] create-table failed", error);
  process.exitCode = 1;
});
