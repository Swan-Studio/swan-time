import { shell } from 'electron';
import http from 'http';
import keytar from 'keytar';
import {
  MONDAY_OAUTH_CLIENT_ID,
  MONDAY_OAUTH_CLIENT_SECRET
} from './mondayOAuth';

const SERVICE = 'swan-time';
const ACCOUNT = 'monday-oauth-token';

export const MONDAY_CLIENT_ID =
  process.env.MONDAY_CLIENT_ID || MONDAY_OAUTH_CLIENT_ID || '';
const MONDAY_CLIENT_SECRET =
  process.env.MONDAY_CLIENT_SECRET || MONDAY_OAUTH_CLIENT_SECRET || '';

// Loopback redirect (RFC 8252). Port must match what's registered in Monday's
// app config. Pick something unlikely to clash with common dev servers.
const REDIRECT_PORT = 33417;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth/callback`;

export async function getToken(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT);
}

export async function clearToken() {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}

export async function startOAuth(): Promise<string> {
  if (!MONDAY_CLIENT_ID) {
    throw new Error(
      'Monday OAuth client not configured. Set MONDAY_CLIENT_ID + MONDAY_CLIENT_SECRET env vars.'
    );
  }

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', `http://localhost:${REDIRECT_PORT}`);
      if (u.pathname !== '/oauth/callback') {
        res.writeHead(404).end();
        return;
      }
      const codeParam = u.searchParams.get('code');
      const errorParam = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Swan Time</title>` +
        `<style>body{font:14px -apple-system,system-ui,sans-serif;padding:40px;text-align:center;color:#222}</style>` +
        `<h2>${codeParam ? 'Connected' : 'Connection failed'}</h2>` +
        `<p>You can close this window and return to Swan Time.</p>`
      );
      server.close();
      if (codeParam) resolve(codeParam);
      else reject(new Error(errorParam || 'No code in OAuth callback'));
    });

    server.on('error', reject);
    server.listen(REDIRECT_PORT, 'localhost', () => {
      // Scopes the app actually uses: identify the user (me), find their
      // tracker board (boards:read), post time entries (boards:write).
      // Build the URL manually so spaces are encoded as %20 — Monday's OAuth
      // parser rejects the `+` form that URLSearchParams produces.
      const params =
        `client_id=${encodeURIComponent(MONDAY_CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${encodeURIComponent('me:read boards:read boards:write')}`;
      shell.openExternal(`https://auth.monday.com/oauth2/authorize?${params}`);
    });

    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timed out after 5 minutes'));
    }, 5 * 60 * 1000);
  });

  const tokenRes = await fetch('https://auth.monday.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: MONDAY_CLIENT_ID,
      client_secret: MONDAY_CLIENT_SECRET,
      code,
      redirect_uri: REDIRECT_URI
    })
  });
  const json = await tokenRes.json();
  if (!json.access_token) throw new Error('No access_token in OAuth response');
  await keytar.setPassword(SERVICE, ACCOUNT, json.access_token);
  return json.access_token;
}

export async function setManualToken(token: string) {
  await keytar.setPassword(SERVICE, ACCOUNT, token);
}
