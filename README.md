# Atlas OS — Stage 1: Atlas gets its own home

This folder is a complete, standalone Atlas. Once it's online, Atlas runs at its own web address, with its own passcode and its own Claude brain. It no longer needs the Claude app open. It works on your iPhone, your Windows PC, a tablet, or any screen with a browser, and it installs on your Home Screen with its own icon.

## What's inside

| Part | What it does |
| --- | --- |
| `public/index.html` | The Atlas command center: the core, live feed, agents, timeline, quick commands, voice |
| `public/manifest.json`, `public/sw.js`, `public/icons/` | Makes Atlas installable as an app with its own icon, and loads fast |
| `api/chat.js` | Atlas's brain. Talks to Claude using your API key, kept safely on the server |
| `api/ping.js` | Checks your passcode when you open Atlas |
| `api/history.js` | Optional: syncs your conversations across all your devices |
| `api/_atlas.js` | Atlas's Code (personality, rules, Mount Atlanta policies) and the passcode check |

Your API key never touches the app itself. It only lives on the server.

## What you need (about 30–45 minutes, one time)

1. **A Claude API key.** Go to the Claude developer console at console.anthropic.com, sign up, add a small amount of credit, and create an API key. **Set a monthly spending limit** in the billing settings so there are never surprises.
2. **A free GitHub account** at github.com. This holds Atlas's code.
3. **A free Vercel account** at vercel.com. Sign up with your GitHub account. This hosts Atlas.

## Step by step

### 1. Put Atlas on GitHub
1. On GitHub, click **New repository**. Name it `atlas-os`, set it to **Private**, and create it.
2. Click **uploading an existing file**, then drag in everything inside this `atlas-os` folder (the `api` folder, the `public` folder, `package.json`, and this README).
3. Click **Commit changes**.

### 2. Launch Atlas on Vercel
1. In Vercel, click **Add New → Project**, and import your `atlas-os` repository.
2. Before deploying, open **Environment Variables** and add:

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your Claude API key |
| `ATLAS_PASSCODE` | A long passcode only you know (12+ characters) |
| `ATLAS_MODEL` (optional) | Leave blank for `claude-sonnet-5-5`, or use `claude-haiku-5-5` to cut costs |

3. Click **Deploy**. In about a minute, Vercel gives you Atlas's address, something like `atlas-os.vercel.app`.

### 3. Wake Atlas
Open your Atlas address, enter your passcode, and tap **Wake Atlas**. Say "brief me" to test it.

### 4. Install it like an app
- **iPhone:** open the address in Safari, tap **Share → Add to Home Screen**. Atlas now opens full screen with its own icon.
- **Windows:** open it in Chrome or Edge and click the **install** icon in the address bar. Atlas gets its own window and a spot in your Start menu and taskbar.

### 5. Optional: memory across all your devices
By default each device remembers its own conversations. To sync them everywhere:
1. In your Vercel project, open **Storage**, choose **Upstash for Redis** from the marketplace, and connect it to the `atlas-os` project (the free tier is plenty).
2. Redeploy (Deployments → ⋯ → Redeploy). Atlas detects the storage and starts syncing automatically.

## Changing Atlas later
- **Personality and rules:** edit `api/_atlas.js` on GitHub. Vercel redeploys automatically within a minute.
- **New passcode:** change `ATLAS_PASSCODE` in Vercel, then redeploy. Every device will ask for the new one.
- **Cheaper or smarter brain:** change `ATLAS_MODEL`.

## Costs
- Vercel and GitHub: free for personal use.
- Claude API: pay per message. Personal daily use is usually modest, and your spending limit caps it.
- Upstash (optional): free tier.

## Security notes
- Keep the passcode long and private. Anyone with it can talk to Atlas on your API key.
- Atlas can't send messages, spend money, or touch your accounts at this stage. It can only think and talk. That's by design; new powers come in later stages, each behind ask-first approvals.
- If you ever think the passcode or key leaked: change the passcode in Vercel, delete and recreate the API key in the Claude console, and redeploy.

## Troubleshooting
- **"That passcode didn't work":** check `ATLAS_PASSCODE` in Vercel for typos or extra spaces, then redeploy.
- **"That didn't go through":** in Vercel, open the project's **Logs**. An error about the API key or credit means checking your key and balance in the Claude console.
- **Voice input missing on iPhone:** Safari's speech support varies. Typing always works, and Atlas still speaks its replies.

## What's next
- **Stage 2:** the Windows desktop app (app, volume and media control, wake word).
- **Stage 3:** the native iPhone app (Action Button, notifications, Apple Health).
