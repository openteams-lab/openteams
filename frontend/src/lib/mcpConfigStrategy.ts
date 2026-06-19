import type { JsonValue, McpConfig } from "@/types";

type JsonObject = Record<string, JsonValue>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const cloneJson = (value: JsonValue): JsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as JsonValue;

export class McpConfigStrategyGeneral {
  private static assertKnownPreconfiguredServer(
    config: McpConfig,
    serverKey: string,
  ): JsonObject {
    const preconfigured = config.preconfigured;
    if (!isJsonObject(preconfigured) || !(serverKey in preconfigured)) {
      throw new Error(`Unknown preconfigured server '${serverKey}'`);
    }
    return preconfigured;
  }

  static createFullConfig(config: McpConfig): JsonObject {
    const cloned = cloneJson(config.template);
    const fullConfig: JsonObject = isJsonObject(cloned) ? cloned : {};
    let current = fullConfig;

    for (let index = 0; index < config.servers_path.length - 1; index += 1) {
      const key = config.servers_path[index];
      if (!isJsonObject(current[key])) current[key] = {};
      current = current[key] as JsonObject;
    }

    if (config.servers_path.length > 0) {
      const lastKey = config.servers_path[config.servers_path.length - 1];
      current[lastKey] = config.servers as JsonValue;
    }

    return fullConfig;
  }

  static validateFullConfig(config: McpConfig, fullConfig: JsonValue): void {
    let current = fullConfig;
    for (const key of config.servers_path) {
      if (!isJsonObject(current)) {
        throw new Error(
          `Expected object at path: ${config.servers_path.join(".")}`,
        );
      }
      current = current[key];
      if (current === undefined) {
        throw new Error(
          `Missing required field at path: ${config.servers_path.join(".")}`,
        );
      }
    }
    if (!isJsonObject(current)) {
      throw new Error("Servers configuration must be an object");
    }
  }

  static extractServersForApi(
    config: McpConfig,
    fullConfig: JsonValue,
  ): JsonObject {
    let current = fullConfig;
    for (const key of config.servers_path) {
      if (!isJsonObject(current)) {
        throw new Error(
          `Expected object at path: ${config.servers_path.join(".")}`,
        );
      }
      current = current[key];
      if (current === undefined) {
        throw new Error(
          `Missing required field at path: ${config.servers_path.join(".")}`,
        );
      }
    }
    if (!isJsonObject(current)) {
      throw new Error("Servers configuration must be an object");
    }
    return current;
  }

  static addPreconfiguredToConfig(
    config: McpConfig,
    existingConfig: JsonValue,
    serverKey: string,
  ): JsonObject {
    const preconfigured = this.assertKnownPreconfiguredServer(
      config,
      serverKey,
    );

    const cloned = cloneJson(existingConfig);
    const updated: JsonObject = isJsonObject(cloned) ? cloned : {};
    let current = updated;

    for (let index = 0; index < config.servers_path.length - 1; index += 1) {
      const key = config.servers_path[index];
      if (!isJsonObject(current[key])) current[key] = {};
      current = current[key] as JsonObject;
    }

    if (config.servers_path.length === 0) {
      current[serverKey] = preconfigured[serverKey];
      return updated;
    }

    const lastKey = config.servers_path[config.servers_path.length - 1];
    if (!isJsonObject(current[lastKey])) current[lastKey] = {};
    (current[lastKey] as JsonObject)[serverKey] = preconfigured[
      serverKey
    ] as JsonValue;

    return updated;
  }

  static configuredServerKeys(
    config: McpConfig,
    fullConfig: JsonValue,
  ): string[] {
    let current = fullConfig;

    for (const key of config.servers_path) {
      if (!isJsonObject(current)) return [];
      current = current[key];
      if (current === undefined) return [];
    }

    return isJsonObject(current) ? Object.keys(current) : [];
  }

  static hasPreconfiguredInConfig(
    config: McpConfig,
    fullConfig: JsonValue,
    serverKey: string,
  ): boolean {
    this.assertKnownPreconfiguredServer(config, serverKey);
    return this.configuredServerKeys(config, fullConfig).includes(serverKey);
  }

  static removePreconfiguredFromConfig(
    config: McpConfig,
    existingConfig: JsonValue,
    serverKey: string,
  ): JsonObject {
    this.assertKnownPreconfiguredServer(config, serverKey);

    const cloned = cloneJson(existingConfig);
    const updated: JsonObject = isJsonObject(cloned) ? cloned : {};
    let current: JsonValue = updated;

    for (const key of config.servers_path) {
      if (!isJsonObject(current)) return updated;
      current = current[key];
      if (current === undefined) return updated;
    }

    if (isJsonObject(current)) {
      delete current[serverKey];
    }

    return updated;
  }
}
