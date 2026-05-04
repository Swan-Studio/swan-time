import { app, BrowserWindow, shell } from 'electron';
import keytar from 'keytar';

const SERVICE = 'swan-time';
const ACCOUNT = 'monday-oauth-token';

export const MONDAY_CLIENT_ID = process.env.MONDAY_CLIENT_ID || 'PUT_CLIENT_ID_HERE';
const MONDAY_CLIENT_SECRET = process.env.MONDAY_CLIENT_SECRET || '';
const REDIRECT_URI = 'swan-time://oauth/callback';

let pendingResolver: ((code: string) => void) | null = null;

export function setupProtocolHandler() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('swan-time', process.execPath, [require('path').resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('swan-time');
  }
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleCallback(url);
  });
  app.on('second-instance', (_e, argv) => {
    const url = argv.find(a => a.startsWith('swan-time://'));
    if (url) handleCallback(url);
  });
}

function handleCallback(url: string) {
  try {
    const u = new URL(url);
    const code = u.searchParams.get('code');
    if (code && pendingResolver) {
      pendingResolver(code);
      pendingResolver = null;
    }
  } catch {}
}

export async function getToken(): Promise<string | null> {
  return keytar.getPassword(SERVICE, ACCOUNT);
}

export async function clearToken() {
  await keytar.deletePassword(SERVICE, ACCOUNT);
}

export async function startOAuth(): Promise<string> {
  if (!MONDAY_CLIENT_ID || MONDAY_CLIENT_ID === 'PUT_CLIENT_ID_HERE') {
    throw new Error(
      'Monday OAuth client not configured. Set MONDAY_CLIENT_ID + MONDAY_CLIENT_SECRET env vars.'
    );
  }

  const authUrl = new URL('https://auth.monday.com/oauth2/authorize');
  authUrl.searchParams.set('client_id', MONDAY_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);

  const code = await new Promise<string>((resolve, reject) => {
    pendingResolver = resolve;
    shell.openExternal(authUrl.toString());
    setTimeout(() => {
      if (pendingResolver) {
        pendingResolver = null;
        reject(new Error('OAuth timed out after 5 minutes'));
      }
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
