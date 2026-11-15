const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasati-security-'));
process.env.DATA_DIR = dataDir;
const database = require('../db/database');
database.initializeDatabase();

function findPort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

test('admin, image, OTP, brochure, and MCP authorization controls', { timeout: 60_000 }, async t => {
  const port = await findPort();
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    DATA_DIR: dataDir,
    UPLOADS_DIR: path.join(dataDir, 'isolated-uploads'),
    ADMIN_DEFAULT_EMAIL: 'admin@example.com',
    ADMIN_DEFAULT_PASSWORD: 'Admin@12345',
    MCP_READ_TOKEN: 'test-read-token',
    MCP_WRITE_TOKEN: 'test-write-token',
    IP_HASH_SALT: 'test-analytics-salt',
    GA4_PROPERTY_ID: '',
    GA4_SERVICE_ACCOUNT_EMAIL: '',
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REDIRECT_URI: '',
    TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000',
    TWILIO_AUTH_TOKEN: 'test-auth-token',
    TWILIO_VERIFY_SERVICE_SID: 'VA00000000000000000000000000000000'
  };
  const child = spawn(process.execPath, [
    '--require', path.join(root, 'tests', 'fixtures', 'mock-twilio.js'),
    path.join(root, 'server.js')
  ], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  let childError = '';
  child.stdout.on('data', chunk => { logs += chunk.toString(); });
  child.stderr.on('data', chunk => { childError += chunk.toString(); });
  let uploadedImagePath;

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server did not start. ${logs} ${childError}`)), 20_000);
      child.stdout.on('data', chunk => {
        if (chunk.toString().includes(`http://localhost:${port}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('exit', code => {
        clearTimeout(timeout);
        reject(new Error(`Server exited with ${code}. ${logs} ${childError}`));
      });
    });

    const base = `http://127.0.0.1:${port}`;
    const request = (url, options = {}) => fetch(`${base}${url}`, options);
    assert.deepEqual(await (await request('/api/health')).json(), { status: 'ok' });
    const json = (body, headers = {}) => ({
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });

    const adminPage = await request('/admin', { redirect: 'manual' });
    assert.equal(adminPage.status, 302);
    assert.equal(adminPage.headers.get('location'), '/admin/login');
    assert.equal((await request('/admin.html', { redirect: 'manual' })).status, 302);
    assert.equal((await request('/api/enquiries')).status, 401);
    assert.equal((await request('/api/stats')).status, 401);
    assert.equal((await request('/api/admin/analytics')).status, 401);
    assert.equal((await request('/api/properties', { method: 'POST', ...json({ title: 'No', location: 'No', price: 1, bhk: 1, area: '1' }) })).status, 401);
    assert.equal((await request('/api/upload-image', { method: 'POST', ...json({ filename: 'x.jpg', fileData: 'aGVsbG8=' }) })).status, 401);
    assert.equal((await request('/mcp', { method: 'POST', ...json({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status, 401);

    const login = await request('/api/admin/auth/login', {
      method: 'POST',
      ...json({ email: 'admin@example.com', password: 'Admin@12345' })
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).mustChangePassword, true);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/admin/properties', { headers: { cookie } })).status, 403);
    const passwordChange = await request('/api/admin/auth/change-password', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Changed-Admin-Password-123!' })
    });
    assert.equal(passwordChange.status, 200);
    assert.equal((await request('/api/admin/properties', { headers: { cookie } })).status, 200);
    const analyticsResponse = await request('/api/admin/analytics', { headers: { cookie } });
    assert.equal(analyticsResponse.status, 200);
    const analyticsBody = await analyticsResponse.json();
    assert.equal(analyticsBody.success, true);
    assert.equal(analyticsBody.data.status, 'setup-required');
    assert.ok(analyticsBody.data.locationMapNotice.includes('Location is approximate when supported, never exact.'));
    assert.equal((await request('/api/admin/analytics?range=all-time', { headers: { cookie } })).status, 400);

    const adminRequest = (url, method = 'GET', body) => request(url, {
      method, ...(body === undefined ? { headers: { cookie } } : json(body, { cookie }))
    });
    await t.test('property CRUD preserves prices and private notes, validates edits, and filters ready homes', async () => {
      const payload = { title: 'Audit home', location: 'Audit locality', price: 50, bhk: 2, area: '1000 sqft',
        admin_note: 'Private negotiation', published: true, description: 'Original',
        amenities: ['Pool'], proximity: [{ title: 'Metro', time: '5 min' }], possession: 'Ready to move' };
      for (const patch of [{ price: -1 }, { price: 'invalid' }, { bhk: 0 }, { published: 'false' }, { title: ' ' }]) {
        assert.equal((await adminRequest('/api/properties', 'POST', { ...payload, ...patch })).status, 400);
      }
      const created = await adminRequest('/api/properties', 'POST', payload);
      assert.equal(created.status, 201);
      const home = (await created.json()).data;
      assert.equal(home.priceLabel, '₹50 L');
      assert.equal(home.admin_note, payload.admin_note);
      const publicHome = (await (await request(`/api/properties/${home.id}`)).json()).data;
      assert.equal(Object.hasOwn(publicHome, 'admin_note'), false);
      const ready = (await (await request('/api/properties?status=Ready%20to%20Move&search=Audit%20home')).json()).data;
      assert.equal(ready.length, 1);
      assert.equal(Object.hasOwn(ready[0], 'admin_note'), false);
      const edited = await adminRequest(`/api/properties/${home.id}`, 'PUT', { price: 120, description: '', admin_note: '', amenities: null, proximity: [] });
      assert.equal(edited.status, 200);
      const saved = (await edited.json()).data;
      assert.equal(saved.priceLabel, '₹1.20 Cr');
      assert.equal(saved.description, '');
      assert.equal(saved.admin_note, '');
      assert.equal(saved.amenities, null);
      assert.equal(saved.proximity, null);
      assert.equal((await adminRequest(`/api/properties/${home.id}`, 'PUT', { price: -2 })).status, 400);
      assert.equal((await adminRequest(`/api/properties/${home.id}`, 'PUT', { published: false })).status, 200);
      assert.equal((await request(`/api/properties/${home.id}`)).status, 404);
      assert.equal((await adminRequest(`/api/properties/${home.id}`, 'DELETE')).status, 200);
      assert.equal((await adminRequest(`/api/properties/${home.id}`, 'DELETE')).status, 404);
    });

    await t.test('slide CRUD handles partial updates and missing records', async () => {
      const created = await adminRequest('/api/featured-projects', 'POST', { name: 'Audit slide', image: '/images/home.jpg', builder_name: 'Builder' });
      assert.equal(created.status, 201);
      const { id } = await created.json();
      assert.equal((await adminRequest(`/api/featured-projects/${id}`, 'PUT', { offer_text: 'Updated' })).status, 200);
      const slide = (await (await request('/api/featured-projects')).json()).data.find(row => row.id === id);
      assert.equal(slide.name, 'Audit slide');
      assert.equal(slide.builder_name, 'Builder');
      assert.equal(slide.offer_text, 'Updated');
      assert.equal((await adminRequest(`/api/featured-projects/${id}`, 'DELETE')).status, 200);
      assert.equal((await adminRequest(`/api/featured-projects/${id}`, 'DELETE')).status, 404);
      assert.equal((await adminRequest(`/api/featured-projects/${id}`, 'PUT', {})).status, 404);
    });

    await t.test('enquiry validation, status, feedback, filtering and deletion', async () => {
      assert.equal((await request('/api/enquiries', { method: 'POST', ...json({ name: ' ', phone: 'abc' }) })).status, 400);
      const created = await request('/api/enquiries', { method: 'POST', ...json({ name: 'Audit lead', phone: '9876543210', email: 'lead@example.test', message: 'Visit please' }) });
      assert.equal(created.status, 201);
      const id = (await created.json()).enquiryId;
      assert.equal((await adminRequest(`/api/enquiries/${id}`, 'PATCH', { status: 'invalid' })).status, 400);
      assert.equal((await adminRequest(`/api/enquiries/${id}`, 'PATCH', { status: 'Contacted', feedback: 'Visit scheduled' })).status, 200);
      const lead = (await (await adminRequest('/api/enquiries?status=Contacted')).json()).data.find(row => row.id === id);
      assert.equal(lead.feedback, 'Visit scheduled');
      assert.equal(lead.phone, '+919876543210');
      assert.equal((await adminRequest(`/api/enquiries/${id}`, 'DELETE')).status, 200);
      assert.equal((await adminRequest(`/api/enquiries/${id}`, 'DELETE')).status, 404);
      assert.equal((await adminRequest(`/api/enquiries/${id}`, 'PATCH', { status: 'Closed' })).status, 404);
    });

    await t.test('settings, statistics, subscribers, consent, export and unsubscribe', async () => {
      assert.equal((await adminRequest('/api/settings', 'PUT', { hero_title: {} })).status, 400);
      assert.equal((await adminRequest('/api/settings', 'PUT', { hero_title: 'Audit title' })).status, 200);
      assert.equal((await (await request('/api/settings')).json()).data.hero_title, 'Audit title');
      assert.equal(typeof (await (await adminRequest('/api/stats')).json()).data.totalProperties, 'number');
      assert.equal((await request('/api/subscribers', { method: 'POST', ...json({ email: 'subscriber@example.test' }) })).status, 400);
      const subscribed = await request('/api/subscribers', { method: 'POST', ...json({ email: 'subscriber@example.test', name: '=formula', marketing_consent: true }) });
      assert.equal(subscribed.status, 201);
      const { unsubscribeToken } = await subscribed.json();
      assert.equal((await (await adminRequest('/api/admin/subscribers?status=active&search=subscriber')).json()).count, 1);
      assert.equal((await adminRequest('/api/admin/subscribers/export', 'POST', {})).status, 400);
      const exported = await adminRequest('/api/admin/subscribers/export', 'POST', { confirm: true });
      assert.equal(exported.status, 200);
      assert.match(await exported.text(), /'=formula/);
      assert.equal((await request('/api/subscribers/unsubscribe', { method: 'POST', ...json({ token: unsubscribeToken }) })).status, 200);
      assert.equal((await (await adminRequest('/api/admin/subscribers?status=unsubscribed')).json()).count, 1);
      assert.equal((await request('/api/subscribers/unsubscribe', { method: 'POST', ...json({ token: unsubscribeToken }) })).status, 404);
      const before = database.db.prepare('SELECT COUNT(*) AS count FROM analytics_events').get().count;
      assert.equal((await request('/api/analytics/events', { method: 'POST', ...json({ event: 'property_view', consent: false }) })).status, 204);
      assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM analytics_events').get().count, before);
      assert.equal((await request('/api/analytics/events', { method: 'POST', ...json({ event: 'property_view', consent: true }) })).status, 204);
      assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM analytics_events').get().count, before + 1);
    });

    await t.test('invalid uploads, malformed cookies, JSON and unknown API routes fail cleanly', async () => {
      assert.equal((await adminRequest('/api/upload-image', 'POST', { fileData: 'aGVsbG8=' })).status, 400);
      assert.equal((await adminRequest('/api/media', 'POST', { fileData: {}, contentType: 'application/pdf' })).status, 400);
      assert.equal((await adminRequest('/api/media', 'POST', { fileData: 'aGVsbG8=', contentType: 'image/png' })).status, 400);
      assert.equal((await request('/api/customer/session', { headers: { cookie: 'vasati_customer_session=%' } })).status, 200);
      assert.equal((await request('/api/admin/session', { headers: { cookie: 'vasati_admin_session=%' } })).status, 200);
      const malformed = await request('/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
      assert.equal(malformed.status, 400);
      assert.equal((await malformed.json()).success, false);
      assert.equal((await request('/api/does-not-exist')).status, 404);
      assert.equal((await request('/api/enquiries', { method: 'POST' })).status, 400);
      assert.equal((await request('/auth/google')).status, 503);
      assert.equal((await request('/auth/google/callback?state=invalid&code=invalid')).status, 400);
      assert.equal((await (await request('/api/customer/session')).json()).authenticated, false);
      assert.equal((await request('/api/customer/logout', { method: 'POST' })).status, 200);
      assert.match((await adminRequest('/api/admin/session')).headers.get('cache-control'), /no-store/);
      assert.equal((await request('/api/settings', { method: 'PUT', ...json({}, { cookie, origin: 'https://attacker.example' }) })).status, 403);
    });

    const viewerPassword = 'Viewer-Only-Password-123!';
    database.db.prepare(`INSERT INTO admin_users (email, password_hash, role, must_change_password)
      VALUES (?, ?, 'viewer', 0)`).run('viewer@example.test', await bcrypt.hash(viewerPassword, 4));
    const viewerLogin = await request('/api/admin/auth/login', {
      method: 'POST',
      ...json({ email: 'viewer@example.test', password: viewerPassword })
    });
    const viewerCookie = viewerLogin.headers.get('set-cookie').split(';')[0];
    assert.equal(viewerLogin.status, 200);
    assert.equal((await request('/api/admin/properties', { headers: { cookie: viewerCookie } })).status, 403);
    assert.equal((await request('/api/admin/analytics', { headers: { cookie: viewerCookie } })).status, 403);
    const viewerPage = await request('/admin', { headers: { cookie: viewerCookie }, redirect: 'manual' });
    assert.equal(viewerPage.status, 302);

    const uploadUnauthorized = await request('/api/upload-image', {
      method: 'POST',
      ...json({ filename: 'x.jpg', fileData: 'aGVsbG8=' })
    });
    assert.equal(uploadUnauthorized.status, 401);

    const invalidImages = ['https://example.test/1.jpg', 'https://example.test/2.jpg', 'https://example.test/3.jpg', 'https://example.test/4.jpg', 'https://example.test/5.jpg'];
    const overLimit = await request('/api/properties', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Rejected', location: 'Bengaluru', price: 50, bhk: 2, area: '1000 sqft', images: invalidImages })
    });
    assert.equal(overLimit.status, 400);

    const propertyResponse = await request('/api/properties', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Integration Test Property',
        location: 'Bengaluru',
        price: 50,
        bhk: 2,
        area: '1000 sqft',
        images: invalidImages.slice(0, 4)
      })
    });
    assert.equal(propertyResponse.status, 201);
    const property = (await propertyResponse.json()).data;
    assert.equal(property.images.length, 4);
    assert.equal(property.published, false);
    assert.equal((await request(`/api/properties/${property.id}`)).status, 404);
    const updateOverLimit = await request(`/api/properties/${property.id}`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: invalidImages })
    });
    assert.equal(updateOverLimit.status, 400);

    const sharp = require('sharp');
    const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const imageUpload = await request('/api/upload-image', {
      method: 'POST',
      ...json({ filename: 'optimized.jpg', fileData: `data:image/jpeg;base64,${jpeg.toString('base64')}` }, { cookie })
    });
    assert.equal(imageUpload.status, 200);
    const imageResult = await imageUpload.json();
    assert.match(imageResult.url, /\.webp$/);
    uploadedImagePath = path.join(env.UPLOADS_DIR, imageResult.url.replace(/^\/uploads\//, ''));
    assert.ok(fs.existsSync(uploadedImagePath), 'admin image uses the configured persistent upload directory');
    assert.equal((await request(imageResult.url)).status, 200);
    const optimizedImage = Buffer.from(await (await request(imageResult.url)).arrayBuffer());
    assert.equal((await sharp(optimizedImage).metadata()).format, 'webp');

    const pdf = Buffer.from('%PDF-1.4\n%%EOF', 'ascii');
    const mediaResponse = await request('/api/media', {
      method: 'POST',
      ...json({ filename: 'floor-plan.pdf', contentType: 'application/pdf', fileData: pdf.toString('base64') }, { cookie })
    });
    assert.equal(mediaResponse.status, 201);
    const mediaUrl = (await mediaResponse.json()).url;
    assert.equal((await request(mediaUrl)).status, 401);

    const published = await request(`/api/properties/${property.id}`, {
      method: 'PUT',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ published: true, brochure_url: mediaUrl })
    });
    assert.equal(published.status, 200);
    assert.equal((await request(`/api/properties/${property.id}`)).status, 200);

    const verificationBody = email => ({
      property_id: property.id, name: 'Test Customer', email, phone: '+919876543210',
      method: 'email', privacy_consent: true, analytics_consent: true
    });
    const startVerification = email => request('/api/brochures/verification/start', {
      method: 'POST',
      ...json(verificationBody(email))
    });

    const firstOtp = await startVerification('cooldown@example.test');
    assert.equal(firstOtp.status, 201);
    assert.equal((await startVerification('cooldown@example.test')).status, 429);

    const expiredOtp = await startVerification('expired@example.test');
    const expiredId = (await expiredOtp.json()).verificationId;
    database.db.prepare('UPDATE otp_verifications SET created_at = ? WHERE id = ?').run(Date.now() - 11 * 60_000, expiredId);
    const expiredCheck = await request('/api/brochures/verification/complete', {
      method: 'POST', ...json({ verification_id: expiredId, code: '123456' })
    });
    assert.equal(expiredCheck.status, 400);

    const limitedOtp = await startVerification('limited@example.test');
    const limitedId = (await limitedOtp.json()).verificationId;
    database.db.prepare('UPDATE otp_verifications SET attempt_count = 5 WHERE id = ?').run(limitedId);
    const limitedCheck = await request('/api/brochures/verification/complete', {
      method: 'POST', ...json({ verification_id: limitedId, code: '123456' })
    });
    assert.equal(limitedCheck.status, 429);

    const validOtp = await startVerification('verified@example.test');
    const validId = (await validOtp.json()).verificationId;
    const verified = await request('/api/brochures/verification/complete', {
      method: 'POST', ...json({ verification_id: validId, code: '123456' })
    });
    assert.equal(verified.status, 200);
    const downloadUrl = (await verified.json()).downloadUrl;
    const download = await request(downloadUrl);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await download.arrayBuffer()).toString(), pdf.toString());
    assert.equal((await request(downloadUrl)).status, 404);

    const readTools = await request('/mcp', {
      method: 'POST',
      ...json({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { Authorization: 'Bearer test-read-token' })
    });
    assert.equal(readTools.status, 200);
    assert.equal((await readTools.json()).result.tools.some(tool => tool.name === 'property_draft_create'), false);

    const unauthorizedWrite = await request('/mcp', {
      method: 'POST',
      ...json({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'property_draft_create', arguments: { title: 'Draft', location: 'Bengaluru', price: 30, bhk: 1, area: '700 sqft' } }
      }, { Authorization: 'Bearer test-read-token' })
    });
    assert.equal((await unauthorizedWrite.json()).error.code, -32601);

    const writeTools = await request('/mcp', {
      method: 'POST',
      ...json({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { Authorization: 'Bearer test-write-token' })
    });
    assert.equal((await writeTools.json()).result.tools.some(tool => tool.name === 'property_draft_create'), true);

    const mcpDraft = await request('/mcp', {
      method: 'POST',
      ...json({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'property_draft_create', arguments: { title: 'MCP Draft', location: 'Bengaluru', price: 30, bhk: 1, area: '700 sqft', images: invalidImages.slice(0, 4) } }
      }, { Authorization: 'Bearer test-write-token' })
    });
    assert.equal((await mcpDraft.json()).result.content.length, 1);
    const mcpOverLimit = await request('/mcp', {
      method: 'POST',
      ...json({
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: { name: 'property_draft_create', arguments: { title: 'MCP Too Many', location: 'Bengaluru', price: 30, bhk: 1, area: '700 sqft', images: invalidImages } }
      }, { Authorization: 'Bearer test-write-token' })
    });
    assert.equal((await mcpOverLimit.json()).error.code, -32602);

    const downloadActivity = await request('/api/admin/brochure-activity', { headers: { cookie } });
    assert.equal(downloadActivity.status, 200);
    assert.equal((await downloadActivity.json()).data.some(row => row.email === 'verified@example.test' && row.downloaded_at), true);

    const raceOtp = await startVerification('concurrent@example.test');
    const raceId = (await raceOtp.json()).verificationId;
    const raceResults = await Promise.all([1, 2].map(() => request('/api/brochures/verification/complete', {
      method: 'POST', ...json({ verification_id: raceId, code: '123456' })
    })));
    assert.deepEqual(raceResults.map(response => response.status).sort(), [200, 400]);
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM brochure_downloads WHERE verification_id = ?').get(raceId).count, 1);

    const logout = await request('/api/admin/auth/logout', { method: 'POST', headers: { cookie } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /vasati_admin_session=;.*Max-Age=0/);
    assert.equal((await (await request('/api/admin/session', { headers: { cookie } })).json()).authenticated, false);
    assert.equal((await request('/api/admin/properties', { headers: { cookie } })).status, 401);
    assert.equal((await request('/api/admin/auth/logout', { method: 'POST', headers: { cookie } })).status, 200);

    const productionDefault = spawnSync(process.execPath, [path.join(root, 'server.js')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        ...env,
        NODE_ENV: 'production',
        PORT: String(await findPort()),
        DATA_DIR: path.join(dataDir, 'production-check')
      }
    });
    assert.equal(productionDefault.status, 1);
    assert.match(productionDefault.stderr, /non-default ADMIN_DEFAULT_PASSWORD/);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once('exit', resolve);
    });
    database.db.close();
    if (uploadedImagePath && fs.existsSync(uploadedImagePath)) fs.rmSync(uploadedImagePath);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
