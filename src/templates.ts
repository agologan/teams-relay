import fs from "node:fs/promises";
import path from "node:path";

import Handlebars from "handlebars";

const templatesDir = path.resolve(process.cwd(), "templates");

const isScalar = (value: unknown) =>
  value == null || ["string", "number", "boolean"].includes(typeof value);

const stringifyValue = (value: unknown) => {
  if (value == null) {
    return "";
  }

  if (isScalar(value)) {
    return String(value);
  }

  return JSON.stringify(value);
};

Handlebars.registerHelper("default", (value: unknown, fallback: unknown) => {
  if (value == null || value === "") {
    return fallback;
  }

  return value;
});

Handlebars.registerHelper("escapeJson", (value: unknown) => {
  const encoded = JSON.stringify(stringifyValue(value));
  return new Handlebars.SafeString(encoded.slice(1, -1));
});

Handlebars.registerHelper("eq", (left: unknown, right: unknown) => left === right);

Handlebars.registerHelper("and", (...values: unknown[]) => values.slice(0, -1).every(Boolean));

Handlebars.registerHelper("or", (...values: unknown[]) => values.slice(0, -1).some(Boolean));

Handlebars.registerHelper("not", (value: unknown) => !value);

Handlebars.registerHelper("when", (condition: unknown, truthy: unknown, falsy: unknown) =>
  condition ? truthy : falsy,
);

Handlebars.registerHelper("concat", (...values: unknown[]) =>
  values.slice(0, -1).map(stringifyValue).join(""),
);

Handlebars.registerHelper("object", (options: Handlebars.HelperOptions) => options.hash);

Handlebars.registerHelper("title", (value: unknown) => {
  const text = stringifyValue(value);
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
});

Handlebars.registerHelper("omit", (value: unknown, ...args: unknown[]) => {
  const keys = args.slice(0, -1).map(String);
  const source = (value ?? {}) as Record<string, unknown>;

  return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
});

export const renderWebhookTemplate = async (
  templateName: string,
  payload: Record<string, unknown>,
) => {
  const safeTemplateName = templateName.replace(/[^a-zA-Z0-9_-]/g, "");

  if (!safeTemplateName) {
    throw new Error("Invalid webhook template name");
  }

  const templatePath = path.join(templatesDir, `${safeTemplateName}.json`);
  const defaultTemplatePath = path.join(templatesDir, "default.json");
  let templateSource: string;

  try {
    templateSource = await fs.readFile(templatePath, "utf8");
  } catch (error) {
    const isMissing = error instanceof Error && "code" in error && error.code === "ENOENT";

    if (!isMissing || safeTemplateName === "default") {
      throw error;
    }

    templateSource = await fs.readFile(defaultTemplatePath, "utf8");
  }
  const template = Handlebars.compile(templateSource, { noEscape: true });
  const rendered = template(payload);

  return JSON.parse(rendered) as Record<string, unknown>;
};
