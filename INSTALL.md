# Installing Swan Time

A menubar time tracker that posts to Monday.com.

## ⚠️ Read this first

When you open Swan Time you will see a macOS dialog that says **"Swan Time Not Opened — Apple could not verify…"** with two buttons: **Done** and **Move to Bin**.

**Click "Done". Do NOT click "Move to Bin" — that deletes the app.**

This dialog is expected. Step 3 below clears it permanently. Swan Time isn't malware — it's an internal Swan Studio tool that we haven't paid Apple $99/year to formally sign. The `xattr` command below tells your Mac to trust it.

## Install (one-time, ~2 minutes)

1. Download **Swan-Time-1.0.0-universal.dmg** from the link in #swan-time (or wherever Jake shared it).
2. Open the DMG and drag **Swan Time** to your **Applications** folder.
3. Open **Terminal** (⌘-Space, type "Terminal", hit return). Paste this single command and hit return:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Swan\ Time.app
   ```

4. Open **Swan Time** from Applications.

   - If you already saw the "Not Opened" dialog and clicked Done: just open it again now, and it'll launch.
   - If you haven't tried opening yet: it'll just launch.

The icon appears in your menubar (top-right of the screen, near the clock). There's no Dock icon — that's intentional.

## First run

1. Click the menubar icon → **Connect to Monday**.
2. Your browser will open to a Monday.com authorization page. Approve access.
3. The browser tab will say "Connected — you can close this window."
4. You're done. Click the menubar icon to start tracking time.

## Troubleshooting

- **"Swan Time Not Opened" dialog keeps appearing** → you skipped step 3, or the `xattr` command didn't run. Open Terminal and try again. If it still won't open, fallback: **System Settings → Privacy & Security**, scroll to "Swan Time was blocked from use", click **Open Anyway**, enter your password.
- **OAuth never finishes** → make sure nothing else is using port 33417, then retry.
- **Icon doesn't appear in menubar** → it's there, just hidden behind other icons. Cmd-drag menubar icons to reorder. Or check if your menubar is full (Bartender / hidden overflow).

Questions: ping Jake.
