// Copy this file to `sharedKey.ts` and paste the Swan Anthropic API key
// before running `npm run package`. The real `sharedKey.ts` is gitignored.
//
// During dev, prefer setting the env var `SWAN_ANTHROPIC_KEY` instead of
// editing this file — keeps the key out of your shell history and out of any
// accidental commits.
//
// Threat model note: this key WILL be extractable from any packaged build by
// anyone who unpacks the .asar. Acceptable only for internal team distribution.
// Cap spend at the Anthropic account level and rotate on any suspected leak.

export const SWAN_SHARED_ANTHROPIC_KEY: string | undefined = undefined;
