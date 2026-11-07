# omi-jp-bridge 仕様（2026-11-07）
Omi（AIウェアラブル）の Integration app。会話（memory）が作られた時の webhook を受け、Omi が作った構造化データを日本語のまま Todoist と Notion に振り分ける。**サーバー側でLLMは呼ばない**。

## エンドポイント（Cloudflare Workers・TypeScript・Hono 可）
- `POST /omi/memory?uid=<omi uid>&key=<SHARED_KEY>` — body は Omi memory JSON:
  `{id, created_at, started_at, finished_at, transcript_segments:[{text,speaker,speakerId,speaker_name,is_user,start,end}], structured:{title, overview, emoji, category, action_items:[{description, completed}], events:[]}, apps_response:[], discarded, folder_id, folder_name}`
  - key 不一致は 401。`discarded:true` は 200 で何もしない。
  - 冪等: KV（binding `SEEN`）に memory id を保存し、2回目は 200 `{status:"duplicate"}`（Omi は再送することがある）。
  - Todoist: `completed:false` の action_items を1件ずつタスク化（REST v2 `POST https://api.todoist.com/rest/v2/tasks`、content=description、description に「Omi: <title>（<started_at をJSTで YYYY-MM-DD HH:mm>）」、project_id は env `TODOIST_PROJECT_ID` があれば）。
  - Notion: env `NOTION_DATABASE_ID` があれば1ページ作成（`POST https://api.notion.com/v1/pages`、Notion-Version 2022-06-28）。プロパティ Name=emoji+title、本文=overview・やること一覧（チェックボックス）・文字起こし（話者名つき、2000字ごとに paragraph を分割＝Notion の rich_text 上限）。
  - どちらかが失敗しても他方は続ける。結果 `{status:"ok", todoist:n, notion:bool, errors:[...]}` を 200 で返す（Omi は速い200を期待）。
- `GET /health` → `ok`。
- secrets: `SHARED_KEY`（必須）, `TODOIST_TOKEN`, `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `TODOIST_PROJECT_ID`。未設定の連携はスキップ。ログにトークンや本文を出さない（id と件数だけ）。

## 品質
- vitest のテスト: 日本語のサンプル memory（fixtures/memory.ja.json）で Todoist/Notion の fetch をモックし、件数・本文・JST 変換・2000字分割・冪等・401・discarded を確認。`npm test` が通ること。
- `wrangler.toml`（name=omi-jp-bridge、KV binding SEEN の id はプレースホルダ）。デプロイはしない。
- README.md（日本語）＋ README.en.md: 何ができるか・図・セットアップ（wrangler secret put…・KV作成・deploy）・Omi アプリでの登録手順（Explore → Create an App → Integration → Memory creation trigger に URL）・プライバシー（サーバーでAIを使わない・本文は保存しない・KVはidだけ）。
- MIT LICENSE。
