// Quest Log MCP server: Streamable HTTP transport, stateless JSON-RPC 2.0.
// Runs behind the OAuth provider, so it only sees authenticated requests; ctx.props.userId
// identifies the user.
import { TOOLS, ToolError, callTool } from "./tools.js";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SERVER_INFO = { name: "quest-log", title: "Quest Log", version: "1.1.0" };

export const INSTRUCTIONS = `Quest Log is the user's gamified, ADHD-friendly task tracker. Quests have a name, a "tiny step" (the smallest way to start when frozen), a category, XP, and optional schedule (due date, time, repeat, reminder).
Guidelines: keep quest names short and concrete; always include a tiny step; prefer small quests over big ones; when the user mentions something they finished, offer to mark it complete; mood is a 1-10 scale where 1 and 10 are bookends rarely used. Completing a quest here records it, and loot drops when the user next opens the app.`;

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const jsonResponse = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const rpcResult = (id, result) => jsonResponse({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => jsonResponse({ jsonrpc: "2.0", id, error: { code, message } });
const notAllowed = () => new Response(null, { status: 405, headers: { Allow: "POST" } });

const methods = {
  initialize: (params) => ({
    protocolVersion:
      PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  }),
  ping: () => ({}),
  "tools/list": () => ({ tools: TOOLS }),
  "resources/list": () => ({ resources: [] }),
  "prompts/list": () => ({ prompts: [] }),
};

export async function handleMcp(request, env, ctx) {
  if (request.method !== "POST") return notAllowed(); // no SSE stream, no sessions to DELETE

  let msg;
  try {
    msg = await request.json();
  } catch {
    return rpcError(null, PARSE_ERROR, "Parse error");
  }
  if (Array.isArray(msg)) return rpcError(null, INVALID_REQUEST, "Batch requests are not supported");
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string")
    return rpcError(msg?.id ?? null, INVALID_REQUEST, "Invalid request");
  if (msg.id === undefined || msg.id === null) return new Response(null, { status: 202 }); // notification

  try {
    if (msg.method === "tools/call") {
      const { name, arguments: args = {} } = msg.params || {};
      if (!TOOLS.some((t) => t.name === name)) return rpcError(msg.id, INVALID_PARAMS, `Unknown tool: ${name}`);
      try {
        const text = await callTool(env, ctx.props?.userId, name, args);
        return rpcResult(msg.id, { content: [{ type: "text", text }] });
      } catch (e) {
        if (e instanceof ToolError)
          return rpcResult(msg.id, { content: [{ type: "text", text: e.message }], isError: true });
        throw e;
      }
    }
    const method = methods[msg.method];
    return method ?
        rpcResult(msg.id, method(msg.params))
      : rpcError(msg.id, METHOD_NOT_FOUND, `Method not found: ${msg.method}`);
  } catch (e) {
    console.error(e);
    return rpcError(msg.id, INTERNAL_ERROR, "Internal error");
  }
}
