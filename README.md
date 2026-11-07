# omi-jp-bridge

Omi の会話メモリから、未完了のやることを Todoist に、日本語の概要・やること・文字起こしを Notion に送る Cloudflare Worker です。サーバー側で AI は使いません。

```text
Omi Memory creation webhook
             │
             ▼
     Cloudflare Worker ── KV（memory id）
        │         │
        ▼         ▼
     Todoist    Notion
```

## セットアップ

```sh
npm install
npm test
npx tsc --noEmit
npx wrangler kv namespace create SEEN
```

作成された KV namespace ID を `wrangler.toml` の `REPLACE_WITH_KV_NAMESPACE_ID` に設定します。続けて secret を登録します。

```sh
npx wrangler secret put SHARED_KEY
npx wrangler secret put TODOIST_TOKEN
npx wrangler secret put NOTION_TOKEN
```

`TODOIST_PROJECT_ID` と `NOTION_DATABASE_ID` は任意の環境変数です。Notion 連携には `NOTION_DATABASE_ID` が必要で、接続先データベースに `Name` という title プロパティが必要です。Notion integration にデータベースへのアクセス権を付けてください。設定しない連携はスキップされます。設定後、リポジトリ内で `npx wrangler deploy` を実行します。

Omi の **Explore → Create an App → Integration** でアプリを作り、**Memory creation trigger** に `https://<worker-url>/omi/memory?uid=<omi-uid>&key=<SHARED_KEY>` を登録します。`GET /health` は `ok` を返します。

## プライバシーと再送

会話本文は保存せず、KV には処理済み memory id だけを保存します（処理を始める時点で id を押さえるので、処理中に届いた再送も二重に登録しません）。ログは id と件数だけです。外部 API の失敗は HTTP 200 の `errors` に載せます。失敗時は id を処理済みにしないため再送で再試行できますが、一部の送信だけ成功した後の再送では重複する可能性があります。`SHARED_KEY` は URL に含まれるため、URL の共有やアクセスログの扱いに注意してください。

MIT License。英語版は [README.en.md](README.en.md)。
