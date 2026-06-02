import { CloudAdapter, ConfigurationBotFrameworkAuthentication, TurnContext } from 'botbuilder'

import { config } from '../config'

const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppType: config.botAppType,
  MicrosoftAppId: config.botAppId,
  MicrosoftAppPassword: config.botAppPassword,
  MicrosoftAppTenantId: config.botTenantId,
})

export const adapter = new CloudAdapter(botFrameworkAuthentication)

adapter.onTurnError = async (context: TurnContext, error: Error) => {
  console.error('[bot] unhandled error', error)

  try {
    await context.sendActivity('Teams Relay hit error. Check server logs.')
  } catch (sendError) {
    console.error('[bot] failed sending error activity', sendError)
  }
}
