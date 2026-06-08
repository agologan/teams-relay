import fs from "node:fs/promises";
import Ajv from "ajv-draft-04";

const manifestPath = new URL("../manifest/manifest.json", import.meta.url);

const manifestJson = await fs.readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestJson);

if (!manifest.manifestVersion || typeof manifest.manifestVersion !== "string") {
  throw new Error("Manifest must include string manifestVersion");
}

const schemaUrl = `https://developer.microsoft.com/json-schemas/teams/v${manifest.manifestVersion}/MicrosoftTeams.schema.json`;
const schemaResponse = await fetch(schemaUrl);

if (!schemaResponse.ok) {
  throw new Error(`Failed fetching Teams manifest schema ${schemaUrl}: ${schemaResponse.status}`);
}

const schema = await schemaResponse.json();
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

if (!validate(manifest)) {
  console.error(JSON.stringify(validate.errors, null, 2));
  process.exit(1);
}

console.log("Teams manifest valid");
