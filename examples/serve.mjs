/**
 * Minimal SPA static server for examples/frontend-demo.html.
 *
 *   node examples/serve.mjs        # http://localhost:5173
 *
 * Every path returns the same page, so the Google OAuth callback
 * (/auth/callback#access_token=...) is handled client-side like a real SPA.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT ?? 5173);
const page = join(dirname(fileURLToPath(import.meta.url)), 'frontend-demo.html');

createServer(async (_request, response) => {
  try {
    const html = await readFile(page);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain' });
    response.end(String(error));
  }
}).listen(PORT, () => {
  console.log(`Demo frontend on http://localhost:${PORT}`);
});
