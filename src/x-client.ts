import axios from "axios";
import type { AxiosInstance } from "axios";
import type { AppConfig } from "./config.js";

export interface TweetEntityUrl {
  url: string;
  expanded_url?: string;
  display_url?: string;
  media_key?: string;
  start: number;
  end: number;
}

export interface TweetMention {
  id: string;
  username: string;
  start: number;
  end: number;
}

export interface TweetAnnotation {
  start: number;
  end: number;
  probability: number;
  type: string;
  normalized_text: string;
}

export interface TweetEntities {
  urls?: TweetEntityUrl[];
  mentions?: TweetMention[];
  annotations?: TweetAnnotation[];
}

export interface TweetAttachments {
  media_keys?: string[];
}

export interface ReferencedTweet {
  type: string;
  id: string;
}

export interface Tweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  conversation_id?: string;
  referenced_tweets?: ReferencedTweet[];
  entities?: TweetEntities;
  attachments?: TweetAttachments;
  possibly_sensitive?: boolean;
  edit_history_tweet_ids?: string[];
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    quote_count: number;
    bookmark_count?: number;
    impression_count?: number;
  };
}

export interface MediaVariant {
  bit_rate?: number;
  content_type: string;
  url: string;
}

export interface MediaItem {
  media_key: string;
  type: string;
  url?: string;
  alt_text?: string;
  variants?: MediaVariant[];
  preview_image_url?: string;
  duration_ms?: number;
}

export interface StreamMessage {
  data: Tweet;
  includes?: {
    users?: Array<{
      id: string;
      name: string;
      username: string;
    }>;
    media?: MediaItem[];
  };
}

export class XStreamClient {
  private client: AxiosInstance;
  private config: AppConfig;
  private stream?: any;
  private shouldStop = false;
  private retryCount = 0;

  // API パラメータ（固定値）
  private readonly EXPANSIONS = [
    "author_id",
    "attachments.media_keys",
    "referenced_tweets.id",
  ];
  private readonly USER_FIELDS = ["id", "name", "username"];
  private readonly TWEET_FIELDS = [
    "created_at",
    "public_metrics",
    "entities",
    "possibly_sensitive",
    "conversation_id",
    "referenced_tweets",
  ];
  private readonly MEDIA_FIELDS = [
    "url",
    "type",
    "alt_text",
    "variants",
    "preview_image_url",
    "duration_ms",
  ];

  constructor(config: AppConfig) {
    this.config = config;
    this.client = axios.create({
      baseURL: "https://api.x.com",
      timeout: 30000,
      headers: {
        Authorization: `Bearer ${config.xapi.bearerToken}`,
      },
    });
  }

  async startStream(
    onMessage: (message: StreamMessage) => Promise<void>,
  ): Promise<void> {
    const reconnectConfig = this.config.stream.reconnect || {};
    const isReconnectEnabled = reconnectConfig.enabled !== false;
    const maxRetries = reconnectConfig.maxRetries ?? 10;
    const initialDelayMs = reconnectConfig.initialDelayMs ?? 1000;
    const maxDelayMs = reconnectConfig.maxDelayMs ?? 60000;
    const backoffMultiplier = reconnectConfig.backoffMultiplier ?? 2;

    this.shouldStop = false;
    this.retryCount = 0;

    console.log("Starting X API stream...");
    if (isReconnectEnabled) {
      console.log(
        `Auto-reconnect: enabled (max retries: ${maxRetries === -1 ? "unlimited" : maxRetries})`,
      );
    }

    while (!this.shouldStop) {
      try {
        await this._connectStream(onMessage);
        // ストリームが正常にクローズした場合
        if (!isReconnectEnabled) {
          console.log("Ending stream");
          break;
        }
      } catch (error) {
        if (this.shouldStop) {
          console.log("Stream stopped");
          break;
        }

        if (this._isRateLimitError(error)) {
          await this._killAllConnections();
        }

        const shouldRetry = maxRetries === -1 || this.retryCount < maxRetries;
        if (!shouldRetry) {
          console.error(`Max retries reached (${maxRetries})`);
          throw error;
        }

        const delayMs = this._calculateBackoffDelay(
          this.retryCount,
          initialDelayMs,
          maxDelayMs,
          backoffMultiplier,
        );

        console.log(
          `Attempting reconnection ${this.retryCount + 1} after ${delayMs}ms...`,
        );
        await this._sleep(delayMs);
        this.retryCount++;
      }
    }
  }

  private async _connectStream(
    onMessage: (message: StreamMessage) => Promise<void>,
  ): Promise<void> {
    const params = new URLSearchParams({
      expansions: this.EXPANSIONS.join(","),
      "user.fields": this.USER_FIELDS.join(","),
      "tweet.fields": this.TWEET_FIELDS.join(","),
      "media.fields": this.MEDIA_FIELDS.join(","),
    });

    console.log(
      `Connecting...${this.retryCount > 0 ? `(retry: ${this.retryCount})` : ""}`,
    );

    try {
      const response = await this.client.get(
        `/2/tweets/search/stream?${params}`,
        {
          responseType: "stream",
        },
      );

      this.stream = response.data;
      this.retryCount = 0; // 接続成功時にリセット
      console.log("Stream connected successfully");

      await new Promise<void>((resolve, reject) => {
        this.stream!.on("data", async (chunk: Buffer) => {
          const lines = chunk
            .toString()
            .split("\n")
            .filter((line: string) => line.trim());

          for (const line of lines) {
            try {
              const message = JSON.parse(line) as StreamMessage;
              if (message.data) {
                await onMessage(message);
              }
            } catch (error) {
              if (error instanceof SyntaxError) {
                // JSONパースエラー、スキップ
                continue;
              }
              console.error("Error processing stream message:", error);
            }
          }
        });

        this.stream!.on("error", (error: any) => {
          console.error("Stream error:", error.message || error);
          reject(error);
        });

        this.stream!.on("close", () => {
          console.log("Stream connection closed");
          resolve();
        });

        this.stream!.on("end", () => {
          console.log("Stream connection ended");
          resolve();
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`X API stream connection error: ${message}`);
      throw error;
    }
  }

  private _isRateLimitError(error: unknown): boolean {
    const err = error as { response?: { status?: number } };
    return err?.response?.status === 429;
  }

  private async _killAllConnections(): Promise<void> {
    try {
      console.warn(
        "Rate limit (429) detected. Killing connections and retrying...",
      );
      await this.client.delete("/2/connections/all");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to kill connections: ${message}`);
    }
  }

  private _calculateBackoffDelay(
    retryCount: number,
    initialDelayMs: number,
    maxDelayMs: number,
    multiplier: number,
  ): number {
    const delay = initialDelayMs * Math.pow(multiplier, retryCount);
    return Math.min(delay, maxDelayMs);
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stop(): void {
    console.log("Stop streaming request received...");
    this.shouldStop = true;
    if (this.stream) {
      this.stream.destroy();
      this.stream = undefined;
    }
  }

  async getTweet(tweetId: string): Promise<Tweet> {
    const response = await this.client.get(`/2/tweets/${tweetId}`, {
      params: {
        expansions: this.EXPANSIONS.join(","),
        "user.fields": this.USER_FIELDS.join(","),
        "tweet.fields": this.TWEET_FIELDS.join(","),
        "media.fields": this.MEDIA_FIELDS.join(","),
      },
    });
    return response.data.data;
  }

  async getConversationTweets(conversationId: string): Promise<Tweet[]> {
    const allTweets: Tweet[] = [];

    try {
      const query = `conversation_id:${conversationId} -is:retweet`;
      let nextToken: string | undefined;
      let hasMore = true;

      while (hasMore) {
        const response = await this.client.get("/2/tweets/search/recent", {
          params: {
            query,
            max_results: 100,
            ...(nextToken ? { next_token: nextToken } : {}),
            expansions: this.EXPANSIONS.join(","),
            "user.fields": this.USER_FIELDS.join(","),
            "tweet.fields": this.TWEET_FIELDS.join(","),
            "media.fields": this.MEDIA_FIELDS.join(","),
          },
        });

        const tweets = response.data.data || [];
        allTweets.push(...tweets);

        nextToken = response.data.meta?.next_token;
        hasMore = !!nextToken;
      }
    } catch (error) {
      console.error("Error fetching conversation tweets:", error);
    }

    return allTweets;
  }
}
