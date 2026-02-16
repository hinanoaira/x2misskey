import axios from "axios";
import type { AxiosInstance } from "axios";
import FormData from "form-data";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import type { UserMapping } from "./config.js";

export class MisskeyClient {
  private client: AxiosInstance;
  private mapping: UserMapping;

  constructor(mapping: UserMapping) {
    this.mapping = mapping;
    this.client = axios.create({
      baseURL: mapping.misskeyServer,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mapping.misskeyToken}`,
      },
      timeout: 10000,
    });
  }

  async postNote(content: string, options?: Record<string, any>) {
    try {
      const payload = {
        i: this.mapping.misskeyToken,
        text: content,
        ...options,
      };

      const response = await this.client.post("/api/notes/create", payload);
      console.log(
        `Posted to ${this.mapping.misskeyServer} for user ${this.mapping.misskeyUserId}`,
      );
      return response.data;
    } catch (error) {
      console.error(
        `Failed to post to ${this.mapping.misskeyServer}:`,
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
  }

  async uploadMediaFromUrl(
    mediaUrl: string,
    options?: { altText?: string; isSensitive?: boolean },
  ): Promise<string | null> {
    let tempPath: string | null = null;

    try {
      const imageRes = await fetch(mediaUrl);
      if (!imageRes.ok) {
        throw new Error(`Failed to fetch media: ${imageRes.status}`);
      }

      if (!imageRes.body) {
        throw new Error("Failed to fetch media: empty response body");
      }

      const fileName = (mediaUrl.split("/").pop() || "media").split("?")[0];
      tempPath = join(tmpdir(), `x2misskey-${randomUUID()}-${fileName}`);
      const webStream = imageRes.body as unknown as WebReadableStream;
      await pipeline(Readable.fromWeb(webStream), createWriteStream(tempPath));

      const formData = new FormData();
      formData.append("i", this.mapping.misskeyToken);
      formData.append("force", "true");
      formData.append("file", createReadStream(tempPath), fileName);
      formData.append("name", fileName);
      formData.append("isSensitive", options?.isSensitive ? "true" : "false");

      if (options?.altText) {
        const trimmedAltText = options.altText.slice(0, 255);
        formData.append("comment", trimmedAltText);
      }

      const uploadRes = await this.client.post(
        "/api/drive/files/create",
        formData,
        {
          headers: formData.getHeaders(),
        },
      );

      return uploadRes.data?.id || null;
    } catch (error) {
      console.error(
        `Failed to upload media to ${this.mapping.misskeyServer}:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    } finally {
      if (tempPath) {
        try {
          await unlink(tempPath);
        } catch (cleanupError) {
          console.warn(
            `Failed to remove temp file ${tempPath}:`,
            cleanupError instanceof Error ? cleanupError.message : cleanupError,
          );
        }
      }
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.post("/api/ping", {});
      return true;
    } catch (error) {
      console.error("Misskey ping failed:", error);
      return false;
    }
  }

  getServerUrl(): string {
    return this.mapping.misskeyServer;
  }

  getXUserId(): string {
    return this.mapping.xUserId;
  }

  getUserInfo(): UserMapping {
    return this.mapping;
  }
}
