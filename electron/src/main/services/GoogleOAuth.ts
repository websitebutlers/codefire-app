import crypto from 'node:crypto'
import http from 'node:http'
import { URL, URLSearchParams } from 'node:url'
import { shell } from 'electron'

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp in milliseconds
}

/**
 * Handles Google OAuth 2.0 authorization code flow.
 *
 * Opens the user's default system browser for sign-in (Google blocks embedded
 * browsers like Electron's BrowserWindow), then receives the callback on a
 * local HTTP server and exchanges the authorization code for tokens.
 */
export class GoogleOAuth {
  private redirectUri = 'http://localhost:8912/oauth/callback'
  private scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ]

  constructor(
    private clientId: string,
    private clientSecret: string
  ) {}

  /**
   * Start the OAuth flow: open the system browser for Google login, receive
   * the callback on a local HTTP server, exchange the code for tokens.
   */
  async authenticate(): Promise<OAuthTokens> {
    return new Promise<OAuthTokens>((resolve, reject) => {
      let server: http.Server | null = null

      // Generate a random state parameter for CSRF protection
      const oauthState = crypto.randomBytes(32).toString('hex')

      // Timeout after 5 minutes — user may have closed the browser tab
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error('OAuth timed out — no response received within 5 minutes'))
      }, 5 * 60 * 1000)

      const cleanup = () => {
        clearTimeout(timeout)
        if (server) {
          server.close()
          server = null
        }
      }

      // 1. Start local HTTP server to receive the callback
      server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', `http://localhost:8912`)

          if (url.pathname !== '/oauth/callback') {
            res.writeHead(404)
            res.end('Not found')
            return
          }

          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')
          const returnedState = url.searchParams.get('state')

          // Verify state parameter to prevent CSRF
          if (returnedState !== oauthState) {
            res.writeHead(403, { 'Content-Type': 'text/html' })
            res.end(
              '<html><body><h2>Invalid state parameter.</h2><p>This may be a CSRF attack. Please try again.</p></body></html>'
            )
            cleanup()
            reject(new Error('OAuth state mismatch — possible CSRF'))
            return
          }

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(
              '<html><body><h2>Authorization denied.</h2><p>You can close this tab.</p></body></html>'
            )
            cleanup()
            reject(new Error(`OAuth error: ${error}`))
            return
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end(
              '<html><body><h2>Missing authorization code.</h2></body></html>'
            )
            cleanup()
            reject(new Error('No authorization code received'))
            return
          }

          // 4. Exchange code for tokens
          const tokens = await this.exchangeCode(code)

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body style="font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#111;color:#fff">' +
            '<div style="text-align:center"><h2>Authorization successful!</h2><p>You can close this tab and return to CodeFire.</p></div></body></html>'
          )

          cleanup()
          resolve(tokens)
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body><h2>An error occurred.</h2></body></html>'
          )
          cleanup()
          reject(err)
        }
      })

      // Bind to localhost only — not 0.0.0.0
      server.listen(8912, '127.0.0.1', () => {
        // 2. Build the Google OAuth URL
        const params = new URLSearchParams({
          client_id: this.clientId,
          redirect_uri: this.redirectUri,
          response_type: 'code',
          scope: this.scopes.join(' '),
          access_type: 'offline',
          prompt: 'consent',
          state: oauthState,
        })

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

        // 3. Open in the user's default system browser
        shell.openExternal(authUrl)
      })

      server.on('error', (err) => {
        cleanup()
        reject(
          new Error(`Failed to start OAuth callback server: ${err.message}`)
        )
      })
    })
  }

  /**
   * Exchange an authorization code for access and refresh tokens.
   */
  private async exchangeCode(code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    })

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Token exchange failed (${response.status}): ${text}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    if (!data.access_token) {
      throw new Error('No access token in response')
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      expiresAt: Date.now() + data.expires_in * 1000,
    }
  }

  /**
   * Refresh an expired access token using a refresh token.
   */
  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
    })

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Token refresh failed (${response.status}): ${text}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    return {
      accessToken: data.access_token,
      // Google may or may not return a new refresh token
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    }
  }

  /**
   * Fetch the email address of the authenticated user.
   */
  async getUserEmail(accessToken: string): Promise<string> {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    if (!response.ok) {
      throw new Error(
        `Failed to fetch user info (${response.status}): ${await response.text()}`
      )
    }

    const data = (await response.json()) as { email: string }
    return data.email
  }
}
