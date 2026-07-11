import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.d.ts";
import type { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.d.ts";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.d.ts";

export type Transport =
  | StdioClientTransport
  | SSEClientTransport
  | StreamableHTTPClientTransport;

export type McpTool = {
  name: string,
  title?: string,
  description?: string,
  inputSchema?: unknown,
};

export type McpResource = {
  uri: string,
  name: string,
  description?: string,
  mimeType?: string,
};

export type McpContent = {
  type: "text" | "image" | "audio" | "resource" | "resource_link",
  text?: string,
  data?: string,
  mimeType?: string,
  resource?: {
    uri: string,
    text?: string,
    blob?: string,
  },
  uri?: string,
  name?: string,
  description?: string,
};

export type ServerEntry = {
  command?: string,
  args?: string[],
  env?: Record<string, string>,
  cwd?: string,
  url?: string,
  headers?: Record<string, string>,
  auth?: "oauth" | "bearer",
  bearerToken?: string,
  bearerTokenEnv?: string,
  oauthClientId?: string,
  oauthClientSecret?: string,
  oauthClientMetadataUrl?: string,
  oauthTokenEndpointAuthMethod?: string,
  lifecycle?: "keep-alive" | "lazy" | "eager",
  idleTimeout?: number,
  exposeResources?: boolean,
  debug?: boolean,
};

export type McpSettings = {
  idleTimeout?: number,
};

export type McpConfig = {
  mcpServers: Record<string, ServerEntry>,
  settings?: McpSettings,
};

export type ToolIndexEntry = {
  kind: "tool" | "resource",
  server: string,
  name: string,
  description: string,
  inputSchema?: unknown,
  resourceUri?: string,
};
