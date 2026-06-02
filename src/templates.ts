import fs from 'node:fs/promises'
import path from 'node:path'

import Handlebars from 'handlebars'

const templatesDir = path.resolve(process.cwd(), 'templates')

const isScalar = (value: unknown) =>
  value == null || ['string', 'number', 'boolean'].includes(typeof value)

const stringifyValue = (value: unknown) => {
  if (value == null) {
    return ''
  }

  if (isScalar(value)) {
    return String(value)
  }

  return JSON.stringify(value)
}

Handlebars.registerHelper('default', (value: unknown, fallback: unknown) => {
  if (value == null || value === '') {
    return fallback
  }

  return value
})

Handlebars.registerHelper('escapeJson', (value: unknown) => {
  const encoded = JSON.stringify(stringifyValue(value))
  return new Handlebars.SafeString(encoded.slice(1, -1))
})

Handlebars.registerHelper('json', (value: unknown) => new Handlebars.SafeString(JSON.stringify(value)))

Handlebars.registerHelper('eachFacts', function eachFacts(this: unknown, value: unknown, options: Handlebars.HelperOptions) {
  if (typeof options !== 'object' || options == null || !('fn' in options)) {
    return ''
  }

  const entries = Object.entries((value ?? {}) as Record<string, unknown>)
    .filter(([_key, entryValue]) => isScalar(entryValue))
    .map(([key, entryValue]) => ({ key, value: stringifyValue(entryValue) }))

  return entries
    .map((entry, index) => options.fn({ ...entry, last: index === entries.length - 1 }))
    .join('')
})

export const renderWebhookTemplate = async (keyword: string, payload: Record<string, unknown>) => {
  const safeKeyword = keyword.replace(/[^a-zA-Z0-9_-]/g, '')

  if (!safeKeyword) {
    throw new Error('Invalid webhook template keyword')
  }

  const templatePath = path.join(templatesDir, `${safeKeyword}.json`)
  const defaultTemplatePath = path.join(templatesDir, 'default.json')
  let templateSource: string

  try {
    templateSource = await fs.readFile(templatePath, 'utf8')
  } catch (error) {
    const isMissing = error instanceof Error && 'code' in error && error.code === 'ENOENT'

    if (!isMissing || safeKeyword === 'default') {
      throw error
    }

    templateSource = await fs.readFile(defaultTemplatePath, 'utf8')
  }
  const template = Handlebars.compile(templateSource, { noEscape: true })
  const rendered = template(payload)

  return JSON.parse(rendered) as Record<string, unknown>
}
