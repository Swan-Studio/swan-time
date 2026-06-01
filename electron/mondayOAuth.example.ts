// Copy this file to `mondayOAuth.ts` and paste the Monday OAuth app credentials
// before running `npm run package`. The real `mondayOAuth.ts` is gitignored.
//
// Register the app at https://monday.com/developers and add this exact redirect
// URI: http://localhost:33417/oauth/callback
//
// During dev, prefer setting env vars `MONDAY_CLIENT_ID` / `MONDAY_CLIENT_SECRET`
// instead of editing this file.
//
// Threat model note: both values will be extractable from any packaged build by
// anyone who unpacks the .asar. This is a known compromise for OAuth in desktop
// apps — treat the "secret" as a public app identifier. Use Monday's app-level
// scopes/quotas to limit blast radius.

export const MONDAY_OAUTH_CLIENT_ID: string | undefined = undefined;
export const MONDAY_OAUTH_CLIENT_SECRET: string | undefined = undefined;
