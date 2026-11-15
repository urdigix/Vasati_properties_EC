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
    ADMIN_DEFAULT_EMAIL: 'admin@example.com',
    ADMIN_DEFAULT_PASSWORD: 'Admin@12345',
    MCP_READ_TOKEN: 'test-read-token',
    MCP_WRITE_TOKEN: 'test-write-token',
    IP_HASH_SALT: 'test-analytics-salt',
    GA4_PROPERTY_ID: '',
    GA4_SERVICE_ACCOUNT_EMAIL: '',
    GA4_SERVICE_ACCOUNT_PRIVATE_KEY: '',
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
    uploadedImagePath = path.join(root, 'public', imageResult.url.slice(1));
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
