#!/usr/bin/env node
// Tiny stdlib HTTP server in front of the pipeline. No deps.
//
//   POST /process    body: { imo, lat?, lon?, verifierHandle? }
//   GET  /health
//
// Run: pnpm --filter orbital-orchestrator dev

import { createServer } from 'node:http';
import { runPipeline } from './pipeline.mjs';

const PORT = Number(process.env.PORT ?? 4011);

const server = createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('content-type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/process') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let payload;
    try { payload = body ? JSON.parse(body) : {}; }
    catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: `invalid JSON: ${err.message}` }));
      return;
    }

    if (!payload.imo) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'imo required' }));
      return;
    }

    try {
      const result = await runPipeline(payload);
      res.writeHead(200);
      res.end(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error('[server] pipeline error:', err);
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  console.log(`orbital-orchestrator listening on http://localhost:${PORT}`);
  console.log(`  POST /process { imo, lat?, lon?, verifierHandle? }`);
  console.log(`  GET  /health`);
});
