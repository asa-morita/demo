# 体育祭 2026｜管理画面で更新する4チーム総当たり

Cloudflare Workers で公開する体育祭の予定・総合順位・対戦表です。
**Google スプレッドシートは使用しません。** 運営はサイトの `/admin` から大会データを編集し、Cloudflare Durable Objects（SQLite ストレージ）へ保存します。

## 画面

公開サイトの下部には **予定／総合順位／対戦表** の3タブがあります。
競技ごとに4チーム・3節・全6試合（1回総当たり）。対戦表はスマートフォンでも横スクロール不要の5×5表で、自己対戦の交点を斜線で表示します。勝者のみ表示し、試合スコアは公開しません。

初期登録データ：
- チーム：Aチーム、Bチーム、Cチーム、Dチーム
- 競技：フットサル、バレーボール、バスケットボール、ドッチボール、綱引き、借人競争
- 試合：各競技6試合（計36試合）、**すべて「未開始」**で開始
- 開催枠：12:30〜18:00（開始・終了時刻や会場は各競技で別途設定）

### 管理画面（/admin）

管理者ログイン後に以下を編集できます。

1. **チーム名**：4チームの名称を変更。固定ID（A/B/C/D）と対戦組み合わせは保持します。
2. **競技情報**：競技名、表示順、開始／終了時刻、会場を編集。競技IDと6競技の枠は固定です。
3. **試合**：試合状態（未開始／試合中／終了）、勝者、コート、開始予定を編集。終了時だけ勝者が必要です。

変更内容はそれぞれ保存ボタンを押すと永続化されます。別端末との編集競合は409エラーで通知し、再読込を求めます。観客の公開サイトは5秒ごとに情報を再取得します。ログインしていない利用者は公開情報の閲覧のみ可能です。

**注意：** Google Sheetsとの同期や旧シートからの自動移行はありません。以前のGoogleシートにのみ残っているデータは、必要なら切り替え前に確認し、管理画面から再入力してください。新しい保存先への切り替え直後、試合はすべて未開始です。

## 総当たりの組み合わせ

| 節 | 試合ID | 対戦 |
|---|---|---|
| 1 | R1M1 | A vs D |
| 1 | R1M2 | B vs C |
| 2 | R2M1 | A vs C |
| 2 | R2M2 | D vs B |
| 3 | R3M1 | A vs B |
| 3 | R3M2 | C vs D |

勝数が多いチームを上位とし、2チーム同勝数なら直接対決で順位を決めます。3チーム以上が同勝数の場合は同順位です。6試合すべての結果が確定した競技のみ総合点に加算します。

| 競技内順位 | 総合ポイント |
|---|---:|
| 1位 | 30 |
| 2位 | 20 |
| 3位 | 10 |
| 4位 | 0 |

## Cloudflare デプロイ

1. GitHub リポジトリ `asa-morita/demo` を Cloudflare Workers Builds に接続します。
2. ビルド／デプロイコマンドに `npx wrangler deploy` を設定します（既に接続済みなら通常のGitHub連動デプロイで更新できます）。
3. `wrangler.jsonc` で `TOURNAMENT_STORE` Durable Object を宣言しています。SQLite-backed namespace は初回デプロイ時のマイグレーションで作られるため、D1 IDやGoogle Cloudの設定は不要です。
4. Cloudflare の Worker → Settings → Variables and Secrets で **2つのSecret** を追加します。

| Secret | 用途 |
|---|---|
| `ADMIN_PASSWORD` | 管理者ログイン用パスワード（十分に長いもの） |
| `ADMIN_SESSION_SECRET` | Cookie署名用の別のランダムな秘密文字列（32文字以上を推奨） |

`SHEETS_SPREADSHEET_ID`、`SHEETS_CLIENT_EMAIL`、`SHEETS_PRIVATE_KEY`、`SHEETS_API_KEY` は不要です。Cloudflareに古い設定が残っている場合は削除できます。秘密情報をGitHubへコミットしないでください。

管理者セッションは署名付きHttpOnly Cookie（SameSite=Strict、HTTPS時Secure）で、8時間後に期限切れになります。管理APIでは認証・Origin確認・入力検証を実施します。ログイン失敗回数の制限はWorkerインスタンス単位のため、本番ではCloudflare WAF側でも `/api/admin/login` のレート制限を推奨します。

保存先は固定名 `festival-main` のDurable Objectです。値はデプロイやWorker再起動をまたいで保持されます。データを初期化したい場合は、ストレージを削除するのではなく運営画面で各試合を未開始に戻してください。

## ローカル実行・確認

```bash
npm install
cp .dev.vars.example .dev.vars
# .dev.vars に管理者用の2つの秘密を設定
npm test
npm run deploy:check
npm run dev
```

`http://localhost:8787/` が公開サイト、`http://localhost:8787/admin` が管理画面です。開発用Durable Objectはローカルに保存され、本番データとは独立しています。公開環境でストレージが利用できない場合は、誤ったデモ結果を見せないため `/api/results` が503エラーになります。
