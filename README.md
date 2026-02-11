# x2misskey

X (Twitter) のストリーミング API からリアルタイムに投稿を取得して、複数の Misskey インスタンスに投稿するツール。

## 機能

- 🐦 X API のストリーミングエンドポイント (`/2/tweets/search/stream`) でリアルタイム投稿を監視
- 🎯 ユーザーID ごとに異なる Misskey サーバー・API トークン・ユーザーに振り分け
- 📝 ツイートの内容、メトリクス、作成日時を含めて Misskey に投稿
- 🔗 元のツイートへのリンクを自動的に追加
- ⚙️ `config.json` で柔軟な設定が可能

## セットアップ

### 1. config.json を作成

[config_example.json](config_example.json) をコピーして `config.json` を作成します：

```bash
cp config_example.json config.json
```

### 2. config.json を編集

作成した `config.json` で以下を設定します：

```json
{
  "xapi": {
    "bearerToken": "YOUR_X_BEARER_TOKEN"
  },
  "userMappings": [
    {
      "xUserId": "123456789",
      "misskeyServer": "https://misskey.example.com",
      "misskeyToken": "YOUR_MISSKEY_TOKEN",
      "misskeyUserId": "user1@example.com",
      "enabled": true
    }
  ],
  "stream": {
    "reconnect": {
      "enabled": true,
      "maxRetries": -1,
      "initialDelayMs": 1000,
      "maxDelayMs": 60000,
      "backoffMultiplier": 2
    }
  }
}
```

#### 設定項目

| 項目            | 説明                                            |
| --------------- | ----------------------------------------------- |
| `xUserId`       | X のユーザーID（数字）。投稿者の ID です        |
| `misskeyServer` | Misskey サーバーの URL（`https://` から始まる） |
| `misskeyToken`  | Misskey の API トークン                         |
| `bearerToken`   | X API の Bearer Token                           |

#### 再接続設定の説明

| オプション          | デフォルト | 説明                                  |
| ------------------- | ---------- | ------------------------------------- |
| `enabled`           | `true`     | 自動再接続を有効にするか              |
| `maxRetries`        | `-1`       | 最大リトライ回数（`-1` で無制限）     |
| `initialDelayMs`    | `1000`     | 最初の再接続待機時間（ミリ秒）        |
| `maxDelayMs`        | `60000`    | 最大再接続待機時間（ミリ秒）          |
| `backoffMultiplier` | `2`        | 待機時間の乗数（Exponential backoff） |

### 3. 依存関係をインストール

```bash
yarn install
```

### 4. ビルド

```bash
yarn build
```

## 使用方法

### 開発モード（tsx で TypeScript を直接実行）

```bash
yarn dev
```

### 本番モード（ビルド済みコードを実行）

```bash
yarn start
```

## アーキテクチャ

```
src/
├── index.ts          # メインエントリーポイント
├── config.ts         # 設定読み込みと検証
├── x-client.ts       # X API ストリーミングクライアント
├── misskey-client.ts # Misskey API クライアント
└── router.ts         # ツイート → Misskey へのルーティングロジック
```

### 処理フロー

1. **X API ストリーミング開始**
   - `XStreamClient` が X API に接続
   - クエリに一致する投稿をリアルタイムで受信

2. **自動再接続**
   - ストリーム接続が切れた場合、自動的に再接続します
   - Exponential backoff アルゴリズムで待機時間を段階的に増加させます
   - `config.json` で再接続ポリシーをカスタマイズ可能

3. **ツイート処理**
   - 投稿の作成者 ID （`author_id`）を確認
   - `config.json` で該当のマッピングを検索

4. **Misskey に投稿**
   - マッピングが見つかれば、該当する `MisskeyClient` を使用
   - 投稿内容、メトリクス、リンクを含めて Misskey に投稿

5. **エラーハンドリング**
   - マッピングなしのユーザーはスキップ
   - Misskey への投稿失敗はログに記録し、処理を継続

## トラブルシューティング

### X API エラー

```
401 Unauthorized
```

- `X_BEARER_TOKEN` が正しく設定されているか確認
- トークンの有効期限を確認

### Misskey 接続エラー

```
✗ Failed to connect to Misskey for X user ...
```

- `misskeyServer` の URL が正しいか確認
- `misskeyToken` が有効か確認

### ツイートが投稿されない

- ツイートの作成者の X ユーザーID が `config.json` に登録されているか確認
- `userMappings` で `enabled: true` になっているか確認
- ストリーミング クエリ条件に一致しているか確認

## ライセンス

MIT
