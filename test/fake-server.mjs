// Minimal MCP stdio server used by tests: initialize, tools/list, tools/call.
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const tools = [
  {
    name: 'echo',
    description: 'Echo text back',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'sum',
    description: 'Add two numbers',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  },
];

createInterface({ input: process.stdin }).on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  if (request.id === undefined) return; // notification
  const { id, method, params } = request;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2026-07-28',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake', version: '0.0.0' },
      },
    });
    return;
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools } });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name === 'echo') {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `echo:${args.text ?? ''}` }] } });
      return;
    }
    if (name === 'sum') {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String((args.a ?? 0) + (args.b ?? 0)) }] } });
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${name}` } });
    return;
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } });
});
