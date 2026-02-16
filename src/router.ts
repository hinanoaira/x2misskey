import type { AppConfig } from "./config.js";
import { getAiMappingByXUserId, getAllEnabledMappings } from "./config.js";
import { MisskeyClient } from "./misskey-client.js";
import {
  type StreamMessage,
  type TweetEntityUrl,
  type TweetMention,
  type Tweet,
  XStreamClient,
} from "./x-client.js";

export class TweetRouter {
  private config: AppConfig;
  private misskeyClients: Map<string, MisskeyClient>;
  private xClient: XStreamClient;

  constructor(config: AppConfig, xClient: XStreamClient) {
    this.config = config;
    this.xClient = xClient;
    this.misskeyClients = new Map();

    // 有効なマッピング用にMisskeyクライアントを初期化
    const enabledMappings = getAllEnabledMappings(config);
    for (const mapping of enabledMappings) {
      const client = new MisskeyClient(mapping);
      this.misskeyClients.set(mapping.xUserId, client);
    }

    console.log(`Initialized ${this.misskeyClients.size} Misskey clients`);
  }

  async routeTweet(message: StreamMessage): Promise<void> {
    const tweet = message.data;
    const authorId = tweet.author_id;

    if (!authorId) {
      console.warn("Received tweet without author_id, skipping:", tweet.id);
      return;
    }

    const mapping = getAiMappingByXUserId(this.config, authorId);

    if (!mapping) {
      // マッピングされていないユーザーのツイートはスキップ
      console.debug(`Tweet from unmapped user ${authorId} skipped`);
      return;
    }

    // リプライチェック
    if (tweet.conversation_id) {
      // リプライツイート：直系の親をたどってチェック
      const conversationTweets = await this.xClient.getConversationTweets(
        tweet.conversation_id,
      );
      const isMixedReplyChain = await this._hasOtherUsersInParentChain(
        tweet,
        conversationTweets,
      );
      if (isMixedReplyChain) {
        console.debug(
          `Tweet ${tweet.id} is part of a mixed reply chain, skipping`,
        );
        return;
      }
    }

    const misskeyClient = this.misskeyClients.get(authorId);
    if (!misskeyClient) {
      console.error(`No Misskey client found for user ${authorId}`);
      return;
    }

    try {
      const authorName = message.includes?.users?.[0]?.name || "Unknown";
      const authorHandle = message.includes?.users?.[0]?.username || "unknown";
      const tweetUrl = `https://x.com/${authorHandle}/status/${tweet.id}`;

      const cleanedText = this.buildCleanTweetText(
        tweet.text,
        tweet.entities?.urls,
        tweet.entities?.mentions,
      );

      const noteContent = `${cleanedText}\n\nOriginal: ?[${tweetUrl}](${tweetUrl})`;

      const fileIds = await this.uploadMediaFiles(
        misskeyClient,
        message,
        Boolean(tweet.possibly_sensitive),
      );

      await misskeyClient.postNote(noteContent, {
        visibility: "public",
        fileIds: fileIds.length > 0 ? fileIds : undefined,
      });
    } catch (error) {
      console.error(`Failed to route tweet ${tweet.id}:`, error);
      // エラーが発生してもストリーム処理を継続
    }
  }

  private buildCleanTweetText(
    text: string,
    urls?: TweetEntityUrl[],
    mentions?: TweetMention[],
  ): string {
    let tweetText = text || "";

    // URL エンティティの置換
    if (urls?.length) {
      for (const url of urls) {
        if (url.media_key) {
          // メディアURLはテキストから削除（添付ファイルとして処理するため）
          tweetText = tweetText.replaceAll(url.url, "");
          continue;
        }
        const displayUrl = url.display_url || url.expanded_url || url.url;
        const expandedUrl = url.expanded_url || url.url;
        tweetText = tweetText.replaceAll(
          url.url,
          `[${displayUrl}](${expandedUrl})`,
        );
      }
    }

    // メンション エンティティの置換
    if (mentions?.length) {
      for (const mention of mentions) {
        const placeholder = `?[@${mention.username}](https://x.com/${mention.username})`;
        tweetText = tweetText.replaceAll(`@${mention.username}`, placeholder);
      }
    }

    return tweetText
      .trim()
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  private async uploadMediaFiles(
    misskeyClient: MisskeyClient,
    message: StreamMessage,
    isSensitive: boolean,
  ): Promise<string[]> {
    const mediaItems = message.includes?.media || [];

    const fileIds: string[] = [];

    for (const media of mediaItems) {
      let mediaUrl: string | undefined;

      if (media.type === "photo") {
        mediaUrl = media.url;
      } else if (media.type === "video" && media.variants) {
        // 動画の場合、variantsから最高品質のmp4を選択
        const mp4Variants = media.variants.filter(
          (v) => v.content_type === "video/mp4" && v.url,
        );

        if (mp4Variants.length > 0) {
          // bit_rateが最も高いものを選択
          const bestVariant = mp4Variants.reduce((best, current) => {
            const bestBitRate = best.bit_rate || 0;
            const currentBitRate = current.bit_rate || 0;
            return currentBitRate > bestBitRate ? current : best;
          });
          mediaUrl = bestVariant.url;
        }
      }
      if (!mediaUrl) {
        console.warn(
          `No URL found for media ${media.media_key} (type: ${media.type})`,
        );
        continue;
      }

      const uploadOptions = {
        isSensitive,
        ...(media.alt_text ? { altText: media.alt_text } : {}),
      };

      const fileId = await misskeyClient.uploadMediaFromUrl(
        mediaUrl,
        uploadOptions,
      );

      if (fileId) {
        fileIds.push(fileId);
      }
    }

    return fileIds;
  }

  getAllMisskeyClients(): MisskeyClient[] {
    return Array.from(this.misskeyClients.values());
  }

  getMisskeyClient(xUserId: string): MisskeyClient | undefined {
    return this.misskeyClients.get(xUserId);
  }

  async testAllConnections(): Promise<void> {
    console.log("Testing Misskey connections...");

    for (const [xUserId, client] of this.misskeyClients.entries()) {
      const ok = await client.ping();
      if (ok) {
        console.log(`Connected to ${client.getServerUrl()}`);
      } else {
        console.error(`Failed to connect to Misskey for X user ${xUserId}`);
      }
    }
  }

  private async _hasOtherUsersInParentChain(
    tweet: Tweet,
    conversationTweets: Tweet[],
  ): Promise<boolean> {
    // ツイートIDtoTweetのマップを作成
    const tweetMap = new Map<string, Tweet>();
    for (const tweet of conversationTweets) {
      tweetMap.set(tweet.id, tweet);
    }

    // 現在のツイートから直系の親をたどる
    let currentTweet: Tweet | undefined = tweet;

    while (true) {
      // referenced_tweetsから親ツイートのIDを取得
      const replyToId = currentTweet.referenced_tweets?.find(
        (ref) => ref.type === "replied_to",
      )?.id;

      if (replyToId) {
        const parentTweet = tweetMap.get(replyToId);
        if (parentTweet) {
          currentTweet = parentTweet;
        } else {
          // 親ツイートが見つからない
          break;
        }
      } else {
        // これ以上親がいない
        break;
      }

      // 親ツイートの著者が現在のツイートの著者と異なる場合、混在チェーンと判断
      if (currentTweet.author_id !== tweet.author_id) {
        return true;
      }
    }

    return false;
  }
}
