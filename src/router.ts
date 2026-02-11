import type { AppConfig } from "./config.js";
import { getAiMappingByXUserId, getAllEnabledMappings } from "./config.js";
import { MisskeyClient } from "./misskey-client.js";
import type { StreamMessage } from "./x-client.js";

export class TweetRouter {
  private config: AppConfig;
  private misskeyClients: Map<string, MisskeyClient>;

  constructor(config: AppConfig) {
    this.config = config;
    this.misskeyClients = new Map();

    // 有効なマッピング用にMisskeyクライアントを初期化
    const enabledMappings = getAllEnabledMappings(config);
    for (const mapping of enabledMappings) {
      const client = new MisskeyClient(mapping);
      this.misskeyClients.set(mapping.xUserId, client);
    }

    console.log(`✓ Initialized ${this.misskeyClients.size} Misskey clients`);
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
        Boolean(tweet.attachments),
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
    urls?: Array<{ url: string; expanded_url?: string; display_url?: string }>,
    hasAttachments?: boolean,
  ): string {
    let tweetText = text || "";

    if (hasAttachments) {
      tweetText = tweetText.replace(/\s?https:\/\/t\.co\/[a-zA-Z0-9]+$/, "");
    }

    if (urls?.length) {
      for (const url of urls) {
        const displayUrl = url.display_url || url.expanded_url || url.url;
        const expandedUrl = url.expanded_url || url.url;
        tweetText = tweetText.replaceAll(
          url.url,
          `[${displayUrl}](${expandedUrl})`,
        );
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
    const photoItems = mediaItems.filter(
      (media) => media.type === "photo" && media.url,
    );

    if (photoItems.length === 0) {
      return [];
    }

    const fileIds: string[] = [];
    for (const media of photoItems) {
      const uploadOptions = {
        isSensitive,
        ...(media.alt_text ? { altText: media.alt_text } : {}),
      };

      const fileId = await misskeyClient.uploadMediaFromUrl(
        media.url!,
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
        console.log(`✓ Connected to ${client.getServerUrl()}`);
      } else {
        console.error(`✗ Failed to connect to Misskey for X user ${xUserId}`);
      }
    }
  }
}
