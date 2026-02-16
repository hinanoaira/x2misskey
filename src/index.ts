import { loadConfig } from "./config.js";
import { XStreamClient } from "./x-client.js";
import type { StreamMessage } from "./x-client.js";
import { TweetRouter } from "./router.js";

async function main() {
  try {
    console.log("Starting X2Misskey streaming server...\n");

    // 設定を読み込み
    const config = loadConfig();

    // X APIクライアントを初期化
    const xClient = new XStreamClient(config);

    // ツイートルーターを初期化
    const router = new TweetRouter(config, xClient);

    // Misskeyサーバーへの接続をテスト
    await router.testAllConnections();
    console.log("");

    // ストリーミングを開始
    console.log("Starting X API stream...\n");

    // グレースフルシャットダウンハンドラ
    const shutdown = () => {
      console.log("\nShutdown signal received...");
      xClient.stop();
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await xClient.startStream(async (message: StreamMessage) => {
      const tweet = message.data;
      const author = message.includes?.users?.[0]?.username || "unknown";

      console.log(`\nNew tweet from @${author}: ${tweet.id}`);
      console.log(`   Text: ${tweet.text.substring(0, 50)}...`);

      await router.routeTweet(message);
    });
  } catch (error) {
    console.error(
      "An error occurred:",
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
