#!/usr/bin/env node
// serve.js - Local preview of dist/ that mirrors Vercel's routing
// Usage: node scripts/serve.js [port]
//
// Reproduces the vercel.json behaviour that matters when reviewing pages:
//   cleanUrls: true      -> /reviews/snuuzu-model-y  serves  reviews/snuuzu-model-y.html
//   trailingSlash: false -> /guides/  redirects to  /guides
//   404.html             -> served with a real 404 status
// Without this, a plain static server 404s every internal link and the site
// looks broken for reasons that have nothing to do with the site.

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const PORT = Number(process.argv[2]) || 4173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const contentType = (filePath) =>
  MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

// Keep resolution inside dist/ — a request path is untrusted input.
const safeResolve = (urlPath) => {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const resolved = path.resolve(DIST_DIR, '.' + path.normalize(decoded));
  return resolved.startsWith(DIST_DIR) ? resolved : null;
};

// cleanUrls: try the literal file, then <path>.html, then <path>/index.html
const findFile = (basePath) => {
  const candidates = [basePath, `${basePath}.html`, path.join(basePath, 'index.html')];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
};

const send = (res, status, body, type) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
};

const server = http.createServer((req, res) => {
  try {
    const urlPath = req.url === '/' ? '/index.html' : req.url;

    // trailingSlash: false — mirror the production redirect
    const bare = urlPath.split('?')[0];
    if (bare.length > 1 && bare.endsWith('/')) {
      res.writeHead(308, { Location: bare.slice(0, -1) });
      return res.end();
    }

    const resolved = safeResolve(urlPath);
    if (!resolved) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');

    const file = findFile(resolved);
    if (file) {
      return send(res, 200, fs.readFileSync(file), contentType(file));
    }

    const notFound = path.join(DIST_DIR, '404.html');
    if (fs.existsSync(notFound)) {
      return send(res, 404, fs.readFileSync(notFound), MIME_TYPES['.html']);
    }
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  } catch (error) {
    console.error(`Failed to serve ${req.url}:`, error);
    return send(res, 500, 'Internal server error', 'text/plain; charset=utf-8');
  }
});

if (!fs.existsSync(DIST_DIR)) {
  console.error('dist/ does not exist. Run `npm run build` first.');
  process.exit(1);
}

server.listen(PORT, () => {
  const pageCount = fs
    .readdirSync(DIST_DIR, { recursive: true })
    .filter((f) => String(f).endsWith('.html')).length;
  console.log(`\n  teslamattress preview  →  http://localhost:${PORT}`);
  console.log(`  Serving ${pageCount} pages from dist/ (cleanUrls, 404 fallback)`);
  console.log(`  Route list: dist/sitemap.xml\n`);
});
