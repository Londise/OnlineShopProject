import { createServer } from 'node:http';

// Emulates only the external object-storage HTTP boundary, never DB, image
// validation, upload coordination or application transactions.
export async function startStorage() {
  const objects = new Map(), requests = [];
  let failure = false, hold;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://localhost');
    requests.push({ method: req.method, path: url.pathname, bytes, upsert: req.headers['x-upsert'], contentType: req.headers['content-type'] });
    const prefix = '/storage/v1/object/storefront-images/';
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && url.pathname === '/storage/v1/bucket/storefront-images') {
      res.end(JSON.stringify({ id: 'storefront-images', name: 'storefront-images', public: true, file_size_limit: 5242880, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] }));
    } else if (req.method === 'POST' && url.pathname.startsWith(prefix)) {
      if (hold) { const gate = hold; hold = null; gate.started(); await gate.wait; }
      if (failure) { res.writeHead(503).end(JSON.stringify({ statusCode: '503', error: 'unavailable', message: 'fixture outage' })); return; }
      const path = url.pathname.slice(prefix.length);
      if (objects.has(path) && req.headers['x-upsert'] !== 'true') {
        res.writeHead(409).end(JSON.stringify({ statusCode: '409', error: 'Duplicate', message: 'Object already exists' })); return;
      }
      objects.set(path, bytes);
      res.end(JSON.stringify({ Id: 'fixture-object', Key: `storefront-images/${path}` }));
    } else if (req.method === 'DELETE' && url.pathname === '/storage/v1/object/storefront-images') {
      const { prefixes } = JSON.parse(bytes.toString());
      for (const path of prefixes) objects.delete(path);
      res.end(JSON.stringify(prefixes.map(name => ({ name }))));
    } else if (req.method === 'GET' && url.pathname.startsWith('/storage/v1/object/public/storefront-images/')) {
      const bytes = objects.get(url.pathname.slice('/storage/v1/object/public/storefront-images/'.length));
      if (!bytes) res.writeHead(404).end('{}');
      else { res.setHeader('content-type', 'image/png'); res.end(bytes); }
    } else res.writeHead(404).end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`, objects, requests,
    reset() { objects.clear(); requests.length = 0; failure = false; },
    failUploads(value = true) { failure = value; },
    holdNext() {
      let started, release;
      const ready = new Promise(resolve => { started = resolve; });
      const wait = new Promise(resolve => { release = resolve; });
      hold = { started, wait };
      return { ready, release };
    },
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
