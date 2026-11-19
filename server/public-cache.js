const { gzipSync } = require('node:zlib');
// Cache only anonymous catalogue responses, never sessions, leads or downloads.
function publicCache({ ttlMs = 15_000, maxEntries = 128, maxBytes = 32 * 1024 * 1024, now = Date.now } = {}) {
  const entries = new Map();
  let bytes = 0;
  const clear = () => { entries.clear(); bytes = 0; };
  const remove = key => { const entry = entries.get(key); if (entry) bytes -= entry.size; entries.delete(key); };
  const representation = (req, res, entry) => {
    res.vary('Accept-Encoding');
    if (entry.gzip && req.acceptsEncodings('gzip')) {
      res.set('Content-Encoding', 'gzip');
      return entry.gzip;
    }
    return entry.body;
  };
  return function cache(req, res, next) {
    const path = req.path;
    const catalogue = path === '/' || path === '/sitemap.xml' || path === '/robots.txt'
      || /^\/properties\/[^/]+(?:\/[^/]+)?$/.test(path)
      || /^\/api\/(?:settings|featured-projects|properties(?:\/[^/]+)?)$/.test(path);
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && (/^\/api\/(?:settings|featured-projects|properties)(?:\/|$)/.test(path) || path === '/mcp');
    if (mutation) {
      // Clear before dispatch and after completion, including writes made by MCP.
      clear();
      res.once('finish', clear);
    }
    if (!catalogue || !['GET', 'HEAD'].includes(req.method)) return next();
    // Remove the application's private default only for these anonymous routes.
    // A handler may still opt out by setting private/no-store itself.
    res.removeHeader('Cache-Control');
    const key = req.originalUrl;
    if (key.length > 512) return next();
    const hit = entries.get(key);
    if (hit && hit.expires > now()) {
      entries.delete(key); entries.set(key, hit);
      res.set('Content-Type', hit.type);
      if (hit.robots) res.set('X-Robots-Tag', hit.robots);
      res.set('Cache-Control', 'public, max-age=0, must-revalidate');
      res.set('X-Public-Cache', 'HIT');
      return res.send(representation(req, res, hit));
    }
    remove(key);
    const send = res.send;
    res.send = function (body) {
      if (res.statusCode === 200 && !res.getHeader('Set-Cookie')
        && !/private|no-store/i.test(String(res.getHeader('Cache-Control') || ''))
        && (typeof body === 'string' || Buffer.isBuffer(body))) {
        res.set('Cache-Control', 'public, max-age=0, must-revalidate');
        res.set('X-Public-Cache', 'MISS');
        const buffer = Buffer.from(body);
        if (req.method === 'GET' && buffer.length <= maxBytes) {
          const gzip = buffer.length >= 1024 ? gzipSync(buffer, {level:4}) : null;
          const size = buffer.length + (gzip?.length || 0);
          if (size > maxBytes) return send.call(this, body);
          remove(key);
          while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) remove(entries.keys().next().value);
          const entry = { body: buffer, gzip, size, type: res.getHeader('Content-Type') || 'text/html; charset=utf-8', robots: res.getHeader('X-Robots-Tag'), expires: now() + ttlMs };
          entries.set(key, entry);
          bytes += size;
          return send.call(this, representation(req, res, entry));
        }
      }
      return send.call(this, body);
    };
    next();
  };
}

module.exports = { publicCache };
