/** Test helpers: an in-memory MCP client bound to a server instance. */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/client';
import { NikkeServer, type ServerOptions } from './server.ts';
import { sdkServer } from './transport.ts';

export interface ToolResult {
  isError: boolean;
  text: string;
  structured: Record<string, any>;
}

export class TestClient {
  constructor(readonly client: Client, readonly nikke: NikkeServer) {}

  async listTools() {
    return (await this.client.listTools()).tools;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const result = await this.client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
    return { isError: Boolean(result.isError), text, structured: (result.structuredContent ?? {}) as Record<string, any> };
  }

  close(): Promise<void> {
    return this.client.close();
  }
}

export async function connect(options: ServerOptions | NikkeServer = {}): Promise<TestClient> {
  const nikke = options instanceof NikkeServer ? options : new NikkeServer(options);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await sdkServer(nikke).connect(serverSide);
  const client = new Client({ name: 'nikke-mcp-test', version: '1.0.0' });
  await client.connect(clientSide);
  return new TestClient(client, nikke);
}

/** Decode an NK3/NK5 share code body. */
export function unpack(code: string): any {
  return JSON.parse(Buffer.from(code.slice(4), 'base64url').toString('utf8'));
}
