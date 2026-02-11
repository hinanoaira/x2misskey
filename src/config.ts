import fs from "fs";
import path from "path";

export interface UserMapping {
  xUserId: string;
  misskeyServer: string;
  misskeyToken: string;
  misskeyUserId: string;
  enabled: boolean;
}

export interface StreamConfig {
  expansions: string[];
  userFields: string[];
  tweetFields: string[];
  mediaFields?: string[];
  reconnect?: {
    enabled?: boolean;
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
  };
}

export interface AppConfig {
  xapi: {
    bearerToken: string;
  };
  userMappings: UserMapping[];
  stream: StreamConfig;
}

export function loadConfig(): AppConfig {
  const configPath = path.join(process.cwd(), "config.json");

  if (!fs.existsSync(configPath)) {
    throw new Error(`config.json not found at ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as AppConfig;

  // バリデーション
  if (!config.xapi.bearerToken) {
    throw new Error("X API bearerToken is required");
  }

  if (config.userMappings.length === 0) {
    throw new Error("At least one user mapping is required");
  }

  // 有効なマッピングを確認
  const enabledMappings = config.userMappings.filter((m) => m.enabled);
  if (enabledMappings.length === 0) {
    throw new Error("No enabled user mappings found");
  }

  console.log(
    `Loaded config with ${enabledMappings.length} enabled Misskey mappings`,
  );

  return config;
}

export function getAiMappingByXUserId(
  config: AppConfig,
  xUserId: string,
): UserMapping | undefined {
  return config.userMappings.find((m) => m.xUserId === xUserId && m.enabled);
}

export function getAllEnabledMappings(config: AppConfig): UserMapping[] {
  return config.userMappings.filter((m) => m.enabled);
}
