# omi-jp-bridge

A Cloudflare Worker that sends unfinished action items from Omi memories to Todoist and Japanese summaries, checklists, and transcripts to Notion. It does not call an AI model on the server.

**Demo video**: https://omi-jp-bridge.pages.dev/ (running against real Todoist and Notion accounts)

```text
Omi Memory creation webhook
             │
             ▼
     Cloudflare Worker ── KV (memory id)
        │         │
        ▼         ▼
     Todoist    Notion
```

## Setup

```sh
npm install
npm test
npx tsc --noEmit
npx wrangler kv namespace create SEEN
```

Replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml` with the returned namespace ID. Set secrets:

```sh
npx wrangler secret put SHARED_KEY
npx wrangler secret put TODOIST_TOKEN
npx wrangler secret put NOTION_TOKEN
```

`TODOIST_PROJECT_ID` and `NOTION_DATABASE_ID` are optional environment variables. The Notion integration needs `NOTION_DATABASE_ID`, access to that database, and a title property named `Name`. Unconfigured integrations are skipped. Deploy from this repository with `npx wrangler deploy`.

In Omi, go to **Explore → Create an App → Integration** and set the **Memory creation trigger** URL to `https://<worker-url>/omi/memory?uid=<omi-uid>&key=<SHARED_KEY>`. `GET /health` returns `ok`.

## Privacy and retries

The Worker does not store transcripts. KV stores only processed memory IDs (the ID is claimed before processing, so a resend that arrives mid-processing is also treated as a duplicate); logs contain only the ID and counts. API failures appear in the HTTP 200 response's `errors` array. Failed deliveries remain retryable, though a retry after partial success may create duplicate items. The shared key is in the URL, so take care when sharing URLs or retaining access logs.

MIT License. Japanese documentation: [README.md](README.md).
