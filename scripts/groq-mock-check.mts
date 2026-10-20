// Exercises the Groq agent loop against a local mock of Groq's
// OpenAI-compatible API: a 429 wait, a 413 model fallback, a tool call
// round trip and a plain-text finish.
//   npx tsx scripts/groq-mock-check.mts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const requests: { model: string; messages: { role: string }[]; tools: unknown[] }[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = JSON.parse(body);
    requests.push(json);
    const n = requests.length;
    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(payload));
    };
    if (n === 1) return send(429, { error: { message: "rate limited" } }, { "retry-after": "1" });
    if (n === 2) return send(413, { error: { message: "Request too large for model" } });
    if (n === 3)
      return send(200, {
        choices: [{ message: { content: "Checking pledges first.", tool_calls: [{ id: "call_1", type: "function", function: { name: "fan_pledges", arguments: "{}" } }] } }],
      });
    return send(200, { choices: [{ message: { content: "Done: no pledges yet, so routing on Qloo demand alone." } }] });
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.GROQ_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
process.env.GROQ_API_KEY = "test";

const { runGroqAgent, GROQ_MODEL } = await import("../src/lib/agent/groq.ts");
const events: { type: string }[] = [];
const messages: Parameters<typeof runGroqAgent>[0]["messages"] = [{ role: "user", content: "Plan a tour" }];
await runGroqAgent({ messages, state: { artists: [], scouts: {} }, emit: (e) => events.push(e) });
await new Promise((r) => server.close(r));

const checks: [string, boolean][] = [
  ["tools sent in OpenAI function format", (requests[0].tools[0] as { type: string }).type === "function"],
  ["429 waited and retried same model", requests[1].model === GROQ_MODEL],
  ["413 switched to fallback model", requests[2].model !== GROQ_MODEL],
  ["tool call ran and emitted start/end", events.some((e) => e.type === "tool_start") && events.some((e) => e.type === "tool_end")],
  ["tool result appended as role=tool", messages.some((m) => m.role === "tool")],
  ["final text streamed to UI", events.some((e) => e.type === "text")],
  ["system prompt sent first", requests[3].messages[0].role === "system"],
];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
