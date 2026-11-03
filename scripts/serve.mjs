import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const assetsRoot = resolve(root, '../assets');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function outside(root, file) {
  const part = relative(root, file);
  return part === '..' || part.startsWith('..' + sep) || isAbsolute(part);
}
export function resolveServerConfig(env = process.env) {
  return { port: Number(env.PORT ?? 8080), host: env.HOST ?? 'localhost' };
}
export function createStaticServer({ readFile: read = readFile, realpath: canonicalPath = realpath } = {}) {
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(request.url.split('?')[0]);
      if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..')) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      if (pathname === '/health/ready') {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(request.method === 'HEAD' ? undefined : 'ok');
        return;
      }
      const isAsset = pathname.startsWith('/assets/');
      const servingRoot = isAsset ? assetsRoot : root;
      const localPath = isAsset ? pathname.slice('/assets'.length) : pathname === '/' ? '/index.html' : pathname;
      const file = resolve(servingRoot, '.' + localPath);
      if (outside(servingRoot, file) || outside(servingRoot, await canonicalPath(file))) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const body = await read(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) {
      const status = error instanceof URIError ? 400 : ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 500;
      response.writeHead(status).end('Request failed');
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port, host } = resolveServerConfig();
  const server = createStaticServer();
  server.listen(port, host, () => console.log(`Lypsync: http://${host}:${server.address().port}`));
}
