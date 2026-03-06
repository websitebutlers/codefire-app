import { ipcMain } from 'electron'
import type { GmailService } from '../services/GmailService'

const GMAIL_CHANNELS = [
  'gmail:listAccounts',
  'gmail:authenticate',
  'gmail:removeAccount',
  'gmail:listRules',
  'gmail:addRule',
  'gmail:removeRule',
  'gmail:pollEmails',
  'gmail:listRecentEmails',
  'gmail:getEmailByMessageId',
] as const

export function registerGmailHandlers(gmailService: GmailService) {
  // Remove existing handlers if re-registering (e.g. after settings change)
  for (const ch of GMAIL_CHANNELS) {
    ipcMain.removeHandler(ch)
  }

  ipcMain.handle('gmail:listAccounts', () => {
    return gmailService.listAccounts()
  })

  ipcMain.handle('gmail:authenticate', async () => {
    return gmailService.authenticate()
  })

  ipcMain.handle('gmail:removeAccount', (_e, accountId: string) => {
    gmailService.removeAccount(accountId)
    return { success: true }
  })

  ipcMain.handle('gmail:listRules', () => {
    return gmailService.listWhitelistRules()
  })

  ipcMain.handle(
    'gmail:addRule',
    (
      _e,
      data: {
        pattern: string
        clientId?: string
        priority?: number
        note?: string
      }
    ) => {
      return gmailService.addWhitelistRule(data)
    }
  )

  ipcMain.handle('gmail:removeRule', (_e, ruleId: string) => {
    gmailService.removeWhitelistRule(ruleId)
    return { success: true }
  })

  ipcMain.handle('gmail:pollEmails', async (_e, accountId: string) => {
    return gmailService.pollEmails(accountId)
  })

  ipcMain.handle('gmail:listRecentEmails', () => {
    // Get all accounts and merge their emails
    const accounts = gmailService.listAccounts()
    const dao = (gmailService as any).gmailDAO
    const allEmails: any[] = []
    for (const account of accounts) {
      allEmails.push(...dao.listProcessedEmails(account.id))
    }
    allEmails.sort(
      (a: any, b: any) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    )
    return allEmails.slice(0, 100)
  })

  ipcMain.handle('gmail:getEmailByMessageId', (_e, messageId: string) => {
    const dao = (gmailService as any).gmailDAO
    return dao.getProcessedEmailByMessageId(messageId) ?? null
  })
}
