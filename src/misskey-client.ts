import axios from "axios";
import type { AxiosInstance } from "axios";
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
        `✓ Posted to ${this.mapping.misskeyServer} for user ${this.mapping.misskeyUserId}`,
      );
      return response.data;
    } catch (error) {
      console.error(
        `✗ Failed to post to ${this.mapping.misskeyServer}:`,
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
  }

  async uploadMediaFromUrl(
    mediaUrl: string,
    options?: { altText?: string; isSensitive?: boolean },
  ): Promise<string | null> {
    try {
      const imageRes = await fetch(mediaUrl);
      if (!imageRes.ok) {
        throw new Error(`Failed to fetch media: ${imageRes.status}`);
      }

      const arrayBuffer = await imageRes.arrayBuffer();
      const blob = new Blob([arrayBuffer]);
      const fileName = mediaUrl.split("/").pop() || "media";

      const formData = new FormData();
      formData.append("i", this.mapping.misskeyToken);
      formData.append("force", "true");
      formData.append("file", blob, fileName);
      formData.append("name", fileName);
      formData.append("isSensitive", options?.isSensitive ? "true" : "false");

      if (options?.altText) {
        const trimmedAltText = options.altText.slice(0, 255);
        formData.append("comment", trimmedAltText);
      }

      const uploadRes = await fetch(
        `${this.mapping.misskeyServer}/api/drive/files/create`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (!uploadRes.ok) {
        const bodyText = await uploadRes.text();
        throw new Error(
          `Misskey upload failed: ${uploadRes.status} ${bodyText}`,
        );
      }

      const fileData = await uploadRes.json();
      return fileData.id || null;
    } catch (error) {
      console.error(
        `✗ Failed to upload media to ${this.mapping.misskeyServer}:`,
        error instanceof Error ? error.message : error,
      );
      return null;
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
