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
    UPLOADS_DIR: path.join(dataDir, 'uploads'),
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
    TWILIO_VERIFY_SERVICE_SID: 'VA00000000000000000000000000000000',
    TURNSTILE_SITE_KEY: 'test-site-key',
    TURNSTILE_SECRET_KEY: 'test-secret-key',
    TRUST_PROXY_HOPS: '0'
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
    let publicSessionCookie = '';
    const request = (url, options = {}) => {
      const headers = { ...(options.headers || {}) };
      if (publicSessionCookie && !Object.keys(headers).some(key => key.toLowerCase() === 'cookie')) {
        headers.cookie = publicSessionCookie;
      }
      return fetch(`${base}${url}`, { ...options, headers }).then(response => {
        const cookieHeader = response.headers.get('set-cookie') || '';
        const sessionCookie = cookieHeader.match(/vasati_form_session=[^;]+/)?.[0];
        if (sessionCookie) publicSessionCookie = sessionCookie;
        return response;
      });
    };
    const json = (body, headers = {}) => ({
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    await t.test('deployment health and persisted uploads use the configured storage', async () => {
      const health = await request('/api/health');
      assert.equal(health.status, 200);
      assert.equal((await health.json()).status, 'ok');
      const persisted = path.join(dataDir, 'uploads', 'properties', 'persisted.txt');
      fs.writeFileSync(persisted, 'existing upload');
      assert.equal(await (await request('/uploads/properties/persisted.txt')).text(), 'existing upload');
      fs.writeFileSync(path.join(dataDir, 'uploads', 'brochures', 'private.pdf'), 'private');
      assert.equal((await request('/uploads/brochures/private.pdf')).status, 404);
    });

    const adminPage = await request('/admin', { redirect: 'manual' });
    assert.equal(adminPage.status, 302);
    assert.equal(adminPage.headers.get('location'), '/admin/login');
    assert.equal((await request('/admin.html', { redirect: 'manual' })).status, 302);
    assert.equal((await request('/api/enquiries')).status, 401);
    assert.equal((await request('/api/stats')).status, 401);
    assert.equal((await request('/api/admin/analytics')).status, 401);
    assert.equal((await request('/auth/google')).status, 404);
    assert.equal((await request('/api/customer/session')).status, 404);
    assert.equal((await request('/api/enquiries', { method: 'POST', ...json({ name: 'Bypass', phone: '+919876543210' }) })).status, 410);
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
    await t.test('search dropdown settings require admin access, persist, validate, and render safely', async () => {
      const original = (await (await request('/api/settings')).json()).data;
      const defaults = ['Electronic City Phase 1', 'Electronic City Phase 2', 'Chandhapura'];
      assert.deepEqual(JSON.parse(original.search_localities), defaults);
      assert.equal((await request('/api/settings', { method: 'PUT', ...json({ search_localities: ['Unauthorized'] }) })).status, 401);
      const save = body => request('/api/settings', { method: 'PUT', ...json(body, { cookie }) });
      try {
        const names = [...defaults, 'Test project <img src=x onerror=alert(1)>'];
        const saved = await save({ search_localities: names });
        assert.equal(saved.status, 200);
        assert.deepEqual(JSON.parse((await saved.json()).data.search_localities), names);
        const html = await (await request('/')).text();
        assert.ok(html.includes('Test project &lt;img src=x onerror=alert(1)&gt;'));
        assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
        for (const invalid of [['Duplicate', ' duplicate '], [''], {}, Array(101).fill('x')]) {
          assert.equal((await save({ search_localities: invalid, seo_title: 'Must not partially save' })).status, 400);
          assert.equal((await (await request('/api/settings')).json()).data.seo_title, original.seo_title);
        }
        assert.equal((await save({ search_localities: [] })).status, 200);
        database.initializeDatabase();
        assert.deepEqual(JSON.parse((await (await request('/api/settings')).json()).data.search_localities), []);
        assert.equal((await save({ search_localities: defaults.slice(1) })).status, 200);
        const afterDelete = await (await request('/')).text();
        assert.ok(!afterDelete.includes('<option value="Electronic City Phase 1">'));
        assert.ok(afterDelete.includes('<option value="Electronic City Phase 2">'));
      } finally {
        assert.equal((await save({ search_localities: original.search_localities })).status, 200);
      }
      const id = database.createProperty({ title: 'Dropdown matching fixture', locality: 'Electronic City Phase 2', location: 'Bengaluru', price: 80, area: '1000 sqft', bhk: 2, published: true });
      database.db.prepare('UPDATE properties SET admin_note = ? WHERE id = ?').run('Private production note', id);
      assert.equal(Object.hasOwn((await (await request(`/api/properties/${id}`)).json()).data, 'admin_note'), false);
      assert.equal((await (await request('/api/properties')).json()).data.some(item => Object.hasOwn(item, 'admin_note')), false);
      try {
        const filtered = await (await request('/api/properties?search=Electronic%20City%20Phase%202')).json();
        assert.ok(filtered.data.some(p => p.id === id));
        assert.ok(filtered.data.every(p => `${p.title} ${p.locality} ${p.location} ${p.description}`.toLowerCase().includes('electronic city phase 2')));
      } finally { database.deleteProperty(id); }
    });
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
    assert.equal((await request('/api/settings', { method: 'PUT', ...json({ search_localities: ['Viewer edit'] }, { cookie: viewerCookie }) })).status, 403);
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
    await t.test('2D floor plans persist through admin create/edit and reject invalid updates', async () => {
      const plans = [{configuration:'2 BHK Apartment',area:'1332 sq.ft.',price:'₹1.5 Cr',image_url:'/images/logo.png',rooms:[{name:'Bedroom 1',dimensions:'14 × 11 ft'}]}, {configuration:'2 BHK Apartment',area:'1347 sq.ft.',price:'₹1.55 Cr',image_url:'/images/logo.png',rooms:[]}];
      const update = data => request(`/api/properties/${property.id}`, {method:'PUT',...json(data,{cookie})});
      const saved = await update({floor_plans:plans});
      assert.equal(saved.status,200);
      assert.deepEqual((await saved.json()).data.floor_plans,plans);
      const partial = await update({price:50});
      assert.deepEqual((await partial.json()).data.floor_plans,plans);
      for (const bad of [[{...plans[0],image_url:'javascript:alert(1)'}],[plans[0],plans[0]],[{...plans[0],rooms:[{name:'Bedroom',dimensions:''}]}]]) {
        assert.equal((await update({floor_plans:bad,price:999})).status,400);
        assert.equal(database.getPropertyById(property.id,true).price,50);
      }
      assert.deepEqual(database.getPropertyById(property.id,true).floor_plans,plans);
      const createdResponse = await request('/api/properties',{method:'POST',...json({title:'2D test property',location:'Bengaluru',price:50,bhk:2,area:'1000 sqft',floor_plans:plans},{cookie})});
      assert.equal(createdResponse.status,201);
      const created = (await createdResponse.json()).data;
      assert.deepEqual(created.floor_plans,plans);
      database.deleteProperty(created.id);
      assert.equal((await update({floor_plans:[]})).status,200);
      assert.deepEqual(database.getPropertyById(property.id,true).floor_plans,[]);
    });
    await t.test('2D uploads preserve readable resolution and reject non-images', async () => {
      const sharp = require('sharp');
      const image = await sharp({create:{width:2500,height:1600,channels:3,background:'#ffffff'}}).png().toBuffer();
      const response = await request('/api/upload-image',{method:'POST',...json({filename:'test-2d-plan.png',fileData:image.toString('base64'),purpose:'floor-plan'},{cookie})});
      assert.equal(response.status,200);
      const result = await response.json();
      assert.match(result.url,/^\/uploads\/properties\/[a-zA-Z0-9_.-]+\.webp$/);
      const uploaded = path.join(dataDir,'uploads',result.url.replace('/uploads/',''));
      try {
        const metadata = await sharp(fs.readFileSync(uploaded)).metadata();
        assert.equal(metadata.width,2500);
        assert.equal(metadata.height,1600);
        assert.equal(metadata.format,'webp');
      } finally { fs.unlinkSync(uploaded); }
      const invalid = await request('/api/upload-image',{method:'POST',...json({filename:'plan.svg',fileData:Buffer.from('<svg></svg>').toString('base64'),purpose:'floor-plan'},{cookie})});
      assert.ok(invalid.status >= 400);
    });
    await t.test('admin can save, reload, preserve and clear project overview details', async () => {
      const overview = { project_units: '15', area_unit: 'sq.ft.', sizes: '990–1320 sq.ft.', project_size: '1 Building – 15 units', launch_date: '2025-09', avg_price: '₹4.5 K/sq.ft.', possession_status: 'Ready to Move', configurations: '2, 3 BHK Apartments', rera_status: 'registered', rera_id: 'TEST-123', rera_url: 'https://example.test/project' };
      const update = data => request(`/api/properties/${property.id}`, { method: 'PUT', ...json(data, { cookie }) });
      const response = await update({project_overview: overview});
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).data.project_overview, overview);
      const partial = await update({price: 51});
      assert.deepEqual((await partial.json()).data.project_overview, overview);
      for (const invalid of [{rera_url:'javascript:alert(1)'}, {project_units:'-2'}, {launch_date:'2025-99'}]) assert.equal((await update({project_overview:invalid})).status, 400);
      assert.deepEqual(database.getPropertyById(property.id, true).project_overview, overview);
      const cleared = await update({project_overview:{}});
      assert.equal((await cleared.json()).data.project_overview.project_units, '');
      assert.equal((await update({project_overview:overview})).status, 200);
    });
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
    uploadedImagePath = path.join(dataDir, 'uploads', imageResult.url.replace('/uploads/', ''));
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

    const verificationBody = (email, method = 'email', phone = '') => ({
      property_id: property.id, name: 'Test Customer', email, phone,
      method, privacy_consent: true, analytics_consent: true,
      captcha_token: 'test-brochure-token'
    });
    const startVerification = (email, method = 'email', phone = '') => request('/api/brochures/verification/start', {
      method: 'POST',
      ...json(verificationBody(email, method, phone))
    });
    const completeBrochureVerification = (verificationId, data, code = '123456') => request('/api/brochures/verification/complete', {
      method: 'POST',
      ...json({ ...data, verification_id: verificationId, code })
    });

    const firstOtp = await startVerification('cooldown@example.test');
    assert.equal(firstOtp.status, 201);
    assert.equal((await firstOtp.json()).expiresInSeconds, 300);
    assert.equal((await startVerification('cooldown@example.test')).status, 429);

    const expiredOtp = await startVerification('expired@example.test');
    const expiredId = (await expiredOtp.json()).verificationId;
    database.db.prepare('UPDATE otp_verifications SET expires_at = ? WHERE id = ?').run(Date.now() - 1, expiredId);
    const expiredCheck = await completeBrochureVerification(expiredId, verificationBody('expired@example.test'), '654321');
    assert.equal(expiredCheck.status, 400);

    const limitedOtp = await startVerification('limited@example.test');
    const limitedId = (await limitedOtp.json()).verificationId;
    database.db.prepare('UPDATE otp_verifications SET attempt_count = 5 WHERE id = ?').run(limitedId);
    const limitedCheck = await completeBrochureVerification(limitedId, verificationBody('limited@example.test'));
    assert.equal(limitedCheck.status, 429);

    const validOtp = await startVerification('verified@example.test');
    const validId = (await validOtp.json()).verificationId;
    const verifiedRecord = database.db.prepare('SELECT * FROM otp_verifications WHERE id = ?').get(validId);
    assert.equal(verifiedRecord.phone, '');
    assert.equal(verifiedRecord.method, 'email');
    const verified = await completeBrochureVerification(validId, verificationBody('verified@example.test'), '123456');
    assert.equal(verified.status, 200);
    const verifiedResult = await verified.json();
    assert.equal(verifiedResult.verifiedMethod, 'email');
    const downloadUrl = verifiedResult.downloadUrl;
    const reusedCode = await completeBrochureVerification(validId, verificationBody('verified@example.test'), '123456');
    assert.equal(reusedCode.status, 400);
    assert.equal((await fetch(`${base}${downloadUrl}`)).status, 404);
    const download = await request(downloadUrl);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await download.arrayBuffer()).toString(), pdf.toString());
    assert.equal((await request(downloadUrl)).status, 404);

    const changedContactOtp = await startVerification('original@example.test');
    const changedContactId = (await changedContactOtp.json()).verificationId;
    const changedContact = await completeBrochureVerification(changedContactId, verificationBody('changed@example.test'));
    assert.equal(changedContact.status, 400);
    const sessionBoundOtp = await startVerification('session-bound@example.test');
    const sessionBoundId = (await sessionBoundOtp.json()).verificationId;
    const wrongSession = await fetch(`${base}/api/brochures/verification/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...verificationBody('session-bound@example.test'),
        verification_id: sessionBoundId,
        code: '123456'
      })
    });
    assert.equal(wrongSession.status, 400);

    const smsOtp = await startVerification('', 'sms', '+919876543210');
    assert.equal(smsOtp.status, 201);
    const smsId = (await smsOtp.json()).verificationId;
    const smsVerified = await completeBrochureVerification(smsId, verificationBody('', 'sms', '+919876543210'), '123456');
    assert.equal(smsVerified.status, 200);
    assert.equal((await smsVerified.json()).verifiedMethod, 'sms');

    const captchaFailure = await request('/api/brochures/verification/start', {
      method: 'POST',
      ...json({ ...verificationBody('captcha@example.test'), captcha_token: 'invalid-token' })
    });
    assert.equal(captchaFailure.status, 403);

    const futureDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(Date.now() + 2 * 24 * 60 * 60_000));
    const siteVisitBody = (overrides = {}) => ({
      property_id: property.id,
      name: 'Site Visit Customer',
      phone: '+919812345678',
      preferred_date: futureDate,
      preferred_time: '10:30',
      captcha_token: 'test-site_visit-token',
      ...overrides
    });
    const pastVisit = await request('/api/site-visits/verification/start', {
      method: 'POST', ...json(siteVisitBody({ preferred_date: '2000-01-01' }))
    });
    assert.equal(pastVisit.status, 400);
    const todayIST = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const pastTimeIST = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date(Date.now() - 60_000));
    const pastVisitTime = await request('/api/site-visits/verification/start', {
      method: 'POST', ...json(siteVisitBody({ preferred_date: todayIST, preferred_time: pastTimeIST }))
    });
    assert.equal(pastVisitTime.status, 400);
    const wrongCodeStart = await request('/api/site-visits/verification/start', {
      method: 'POST', ...json(siteVisitBody({ phone: '+919812345677' }))
    });
    const wrongCodeId = (await wrongCodeStart.json()).verificationId;
    const wrongCode = await request('/api/site-visits/verification/complete', {
      method: 'POST', ...json({ ...siteVisitBody({ phone: '+919812345677' }), verification_id: wrongCodeId, code: '000000' })
    });
    assert.equal(wrongCode.status, 400);

    const changedPhoneStart = await request('/api/site-visits/verification/start', {
      method: 'POST',
      ...json(siteVisitBody({ phone: '+919812345679' }))
    });
    const changedPhoneId = (await changedPhoneStart.json()).verificationId;
    const changedPhone = await request('/api/site-visits/verification/complete', {
      method: 'POST',
      ...json({ ...siteVisitBody({ phone: '+919812345680' }), verification_id: changedPhoneId, code: '123456' })
    });
    assert.equal(changedPhone.status, 400);

    const siteVisitStart = await request('/api/site-visits/verification/start', {
      method: 'POST', ...json(siteVisitBody({ phone: '+919812345681' }))
    });
    assert.equal(siteVisitStart.status, 201);
    const siteVisitId = (await siteVisitStart.json()).verificationId;
    const visitRequest = { ...siteVisitBody({ phone: '+919812345681' }), verification_id: siteVisitId, code: '123456' };
    const beforeSiteVisits = database.db.prepare("SELECT COUNT(*) AS count FROM enquiries WHERE verification_id IS NOT NULL").get().count;
    const booked = await request('/api/site-visits/verification/complete', { method: 'POST', ...json(visitRequest) });
    assert.equal(booked.status, 201);
    const bookingReceipt = await booked.json();
    const retriedBooking = await request('/api/site-visits/verification/complete', { method: 'POST', ...json(visitRequest) });
    assert.equal(retriedBooking.status, 200);
    assert.equal((await retriedBooking.json()).referenceId, bookingReceipt.referenceId);
    const afterSiteVisits = database.db.prepare("SELECT COUNT(*) AS count FROM enquiries WHERE verification_id IS NOT NULL").get().count;
    assert.equal(afterSiteVisits, beforeSiteVisits + 1);
    const savedBooking = database.db.prepare('SELECT preferred_date, preferred_time, verified_contact_method FROM enquiries WHERE verification_id = ?')
      .get(siteVisitId);
    assert.deepEqual({ ...savedBooking }, {
      preferred_date: futureDate,
      preferred_time: '10:30',
      verified_contact_method: 'sms'
    });

    const resendStart = await startVerification('resend@example.test');
    const resendId = (await resendStart.json()).verificationId;
    const immediateResend = await request('/api/brochures/verification/resend', {
      method: 'POST', ...json({ verification_id: resendId })
    });
    assert.equal(immediateResend.status, 429);
    database.db.prepare('UPDATE otp_verifications SET last_sent_at = ? WHERE id = ?').run(Date.now() - 61_000, resendId);
    const resent = await request('/api/brochures/verification/resend', {
      method: 'POST', ...json({ verification_id: resendId })
    });
    assert.equal(resent.status, 200);
    const oldResentCode = await completeBrochureVerification(resendId, verificationBody('resend@example.test'), '123456');
    assert.equal(oldResentCode.status, 400);
    const newResentCode = await completeBrochureVerification(resendId, verificationBody('resend@example.test'), '654321');
    assert.equal(newResentCode.status, 200);

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
