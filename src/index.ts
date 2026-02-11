import { loadConfig } from "./config.js";
import { XStreamClient } from "./x-client.js";
import type { StreamMessage } from "./x-client.js";
import { TweetRouter } from "./router.js";

async function main() {
  try {
    console.log("🚀 X2Misskey ストリーミングサーバーを起動中...\n");

    // 設定を読み込み
    const config = loadConfig();

    // X APIクライアントを初期化
    const xClient = new XStreamClient(config);

    // ツイートルーターを初期化
    const router = new TweetRouter(config);

    // Misskeyサーバーへの接続をテスト
    await router.testAllConnections();
    console.log("");

    // ストリーミングを開始
    console.log("📡 X APIのストリーミングを開始します...\n");

    // グレースフルシャットダウンハンドラ
    const shutdown = () => {
      console.log("\n⚠️ シャットダウンシグナルを受け取りました...");
      xClient.stop();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await xClient.startStream(async (message: StreamMessage) => {
      const tweet = message.data;
      const author = message.includes?.users?.[0]?.username || "unknown";

      console.log(`\n📝 新しいツイート (@${author}): ${tweet.id}`);
      console.log(`   テキスト: ${tweet.text.substring(0, 50)}...`);

      await router.routeTweet(message);
    });
  } catch (error) {
    console.error(
      "❌ エラーが発生しました:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

// 起動
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
