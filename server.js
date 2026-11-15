const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const db = require('./db/database');
const adminAuth = require('./server/admin-auth');
const { ALLOWED_RANGES, Ga4AnalyticsClient, LOCATION_MAP_NOTICE } = require('./server/ga4-analytics');

const app = express();
// Only internal reverse proxies may supply the client address used by rate limits.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');
const ga4Analytics = new Ga4AnalyticsClient();
const requestedPort = Number.parseInt(process.env.PORT || '3000', 10);
const PORT = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 3000;
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads'));
fs.mkdirSync(path.join(uploadsDir, 'properties'), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, 'brochures'), { recursive: true });

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use((req, res, next) => {
  if (/^\/api\/(admin|customer|enquiries|stats)(\/|$)/i.test(req.path)) res.set('Cache-Control', 'no-store');
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    req.body ??= {};
    if (Array.isArray(req.body) || typeof req.body !== 'object') return res.status(400).json({ success: false, message: 'Request body must be an object.' });
  }
  next();
});

function sameOriginMutation(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.get('host')) {
      return res.status(403).json({ success: false, message: 'Cross-origin requests are not allowed.' });
    }
  } catch {
    return res.status(403).json({ success: false, message: 'Invalid request origin.' });
  }
  next();
}

app.use(sameOriginMutation);

app.post('/api/admin/auth/login', async (req, res) => {
  try {
    await adminAuth.login(req, res);
  } catch (error) {
    console.error('Administrator login failed:', error);
    res.status(500).json({ success: false, message: 'Sign in failed.' });
  }
});

app.post('/api/admin/auth/change-password', async (req, res) => {
  try {
    await adminAuth.changePassword(req, res);
  } catch (error) {
    console.error('Administrator password change failed:', error);
    res.status(500).json({ success: false, message: 'Could not change password.' });
  }
});

app.post('/api/admin/auth/logout', (req, res) => adminAuth.logout(req, res));
app.get('/api/admin/session', (req, res) => {
  const admin = adminAuth.currentAdmin(req);
  if (!admin || admin.role !== 'admin') return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    email: admin.email,
    role: admin.role,
    mustChangePassword: Boolean(admin.must_change_password)
  });
});

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) { try { return decodeURIComponent(value.join('=')); } catch { return null; } }
  }
  return null;
}

function currentCustomer(req) {
  const token = cookieValue(req, 'vasati_customer_session');
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return db.db.prepare(`
    SELECT customers.id, customers.email, customers.name
    FROM customer_sessions JOIN customers ON customers.id = customer_sessions.customer_id
    WHERE customer_sessions.token_hash = ? AND customer_sessions.expires_at > ?
  `).get(tokenHash, Date.now()) || null;
}

let googleJwks;
let googleJwksExpiresAt = 0;
async function verifyGoogleIdToken(idToken, expectedNonce) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid Google identity token.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!googleJwks || Date.now() >= googleJwksExpiresAt) {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!response.ok) throw new Error('Google signing keys are unavailable.');
    googleJwks = (await response.json()).keys;
    googleJwksExpiresAt = Date.now() + 60 * 60_000;
  }
  const jwk = googleJwks.find(key => key.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw new Error('Unrecognized Google identity token signature.');
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url')
  );
  if (!verified || claims.aud !== process.env.GOOGLE_CLIENT_ID ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
      Number(claims.exp) * 1000 <= Date.now() ||
      claims.nonce !== expectedNonce || claims.email_verified !== true ||
      typeof claims.sub !== 'string' || typeof claims.email !== 'string') {
    throw new Error('Google identity validation failed.');
  }
  return claims;
}

app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    return res.status(503).send('Google sign-in is unavailable until the owner configures Google OAuth credentials.');
  }
  const rate = db.consumeRateLimit(`google-oauth:${req.ip}`, 20, 15 * 60_000);
  if (!rate.allowed) return res.status(429).send('Too many sign-in requests. Try again later.');
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  db.db.prepare('INSERT INTO oauth_states (state_hash, nonce, expires_at) VALUES (?, ?, ?)')
    .run(crypto.createHash('sha256').update(state).digest('hex'), nonce, Date.now() + 10 * 60_000);
  const cookie = [`vasati_oauth_state=${encodeURIComponent(state)}`, 'HttpOnly', 'SameSite=Lax', 'Path=/auth/google', 'Max-Age=600'];
  if (process.env.NODE_ENV === 'production') cookie.push('Secure');
  res.setHeader('Set-Cookie', cookie.join('; '));
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account'
  }).toString();
  res.redirect(url.toString());
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const state = String(req.query.state || '');
    const storedState = cookieValue(req, 'vasati_oauth_state');
    if (!state || !storedState || state !== storedState) return res.status(400).send('Sign-in request expired or invalid.');
    const stateHash = crypto.createHash('sha256').update(state).digest('hex');
    const oauthState = db.db.prepare('SELECT * FROM oauth_states WHERE state_hash = ? AND expires_at > ?').get(stateHash, Date.now());
    if (!oauthState) return res.status(400).send('Sign-in request expired or invalid.');
    db.db.prepare('DELETE FROM oauth_states WHERE state_hash = ?').run(stateHash);
    if (req.query.error || !req.query.code) return res.redirect('/?google_login=cancelled');

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(req.query.code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });
    const tokenResult = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenResult.id_token) return res.status(401).send('Google sign-in failed.');
    const claims = await verifyGoogleIdToken(tokenResult.id_token, oauthState.nonce);
    db.db.prepare(`
      INSERT INTO customers (google_subject, email, name) VALUES (?, ?, ?)
      ON CONFLICT(google_subject) DO UPDATE SET email = excluded.email, name = excluded.name
    `).run(claims.sub, claims.email.toLowerCase(), String(claims.name || '').slice(0, 120));
    const customer = db.db.prepare('SELECT id FROM customers WHERE google_subject = ?').get(claims.sub);
    const customerToken = crypto.randomBytes(32).toString('base64url');
    const customerTokenHash = crypto.createHash('sha256').update(customerToken).digest('hex');
    const expiresAt = Date.now() + 30 * 24 * 60 * 60_000;
    db.db.prepare('INSERT INTO customer_sessions (token_hash, customer_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(customerTokenHash, customer.id, expiresAt, Date.now());
    const customerCookie = [`vasati_customer_session=${encodeURIComponent(customerToken)}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${30 * 24 * 60 * 60}`];
    if (process.env.NODE_ENV === 'production') customerCookie.push('Secure');
    res.setHeader('Set-Cookie', [
      customerCookie.join('; '),
      'vasati_oauth_state=; HttpOnly; SameSite=Lax; Path=/auth/google; Max-Age=0'
    ]);
    res.redirect('/?google_login=success');
  } catch (error) {
    console.error('Google sign-in failed:', error.message);
    res.status(401).send('Google sign-in could not be completed. Please try again.');
  }
});

app.get('/api/customer/session', (req, res) => {
  const customer = currentCustomer(req);
  if (!customer) return res.json({ authenticated: false });
  res.json({ authenticated: true, name: customer.name, email: customer.email });
});

app.post('/api/customer/logout', (req, res) => {
  const token = cookieValue(req, 'vasati_customer_session');
  if (token) db.db.prepare('DELETE FROM customer_sessions WHERE token_hash = ?')
    .run(crypto.createHash('sha256').update(token).digest('hex'));
  const cookie = ['vasati_customer_session=', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (process.env.NODE_ENV === 'production') cookie.push('Secure');
  res.setHeader('Set-Cookie', cookie.join('; '));
  res.json({ success: true });
});

app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-login.html')));
app.get('/unsubscribe', (req, res) => res.sendFile(path.join(__dirname, 'public', 'unsubscribe.html')));
app.get(['/admin', '/admin.html'], (req, res) => {
  const admin = adminAuth.currentAdmin(req);
  if (!admin || admin.role !== 'admin') return res.redirect('/admin/login');
  if (admin.must_change_password) return res.redirect('/admin/login?change=1');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use('/api/admin', adminAuth.requireAdmin);

// Brochure files are served only through expiring, verified download links.
app.use('/uploads/brochures', (_req, res) => res.sendStatus(404));
app.use('/uploads', express.static(uploadsDir));
app.get('/api/health', (_req, res) => {
  db.db.prepare('SELECT 1').get();
  res.json({ status: 'ok' });
});

// Serve static assets from 'public'
app.use(express.static(path.join(__dirname, 'public')));

// ----------------- SITE SETTINGS APIS -----------------

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await db.getSiteSettings();
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ success: false, message: 'Server error fetching settings' });
  }
});

app.put('/api/settings', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    await db.updateSiteSettings(req.body);
    const updated = await db.getSiteSettings();
    res.json({ success: true, message: 'Settings updated successfully', data: updated });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(error.status || 500).json({ success: false, message: error.status === 400 ? error.message : 'Server error updating settings' });
  }
});

// ----------------- PROPERTY APIS -----------------

// 1. GET /api/properties (Filter, Search, Sort)
app.get('/api/admin/properties', adminAuth.requireAdmin, (req, res) => {
  const properties = db.getAllProperties({}, true);
  res.json({ success: true, count: properties.length, data: properties });
});

app.get('/api/properties', async (req, res) => {
  try {
    const { locality, bhk, status, kind, minPrice, maxPrice, budget, search, sort } = req.query;
    const properties = await db.getAllProperties({
      locality,
      bhk,
      status,
      kind,
      minPrice,
      maxPrice,
      budget,
      search,
      sort
    });

    res.json({ success: true, count: properties.length, data: properties.map(({ admin_note, ...property }) => property) });
  } catch (error) {
    console.error('Error fetching properties:', error);
    res.status(500).json({ success: false, message: 'Server error fetching properties' });
  }
});

// 2. GET /api/properties/:id (Single property)
app.get('/api/properties/:id', async (req, res) => {
  try {
    const property = await db.getPropertyById(req.params.id);
    if (!property) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }
    const { admin_note, ...publicProperty } = property;
    res.json({ success: true, data: publicProperty });
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json({ success: false, message: 'Server error fetching property' });
  }
});

// 3. POST /api/properties (Create new property)
app.post('/api/properties', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    const { title, location, price, bhk, area } = req.body;
    if (!title || !location || !price || !bhk || !area) {
      return res.status(400).json({ success: false, message: 'Missing required property fields' });
    }

    const newId = await db.createProperty(req.body);
    const created = await db.getPropertyById(newId, true);
    db.logAudit(adminAuth.currentAdmin(req).email, 'property.created', newId, { published: created.published });
    res.status(201).json({ success: true, message: 'Property created successfully', data: created });
  } catch (error) {
    console.error('Error creating property:', error);
    res.status(error.status || (error.message.includes('no more than 4 images') ? 400 : 500)).json({ success: false, message: error.status || error.message.includes('no more than 4 images') ? error.message : 'Server error creating property' });
  }
});

// 4. PUT /api/properties/:id (Update property)
app.put('/api/properties/:id', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    const existing = await db.getPropertyById(req.params.id, true);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    await db.updateProperty(req.params.id, req.body);
    const updated = await db.getPropertyById(req.params.id, true);
    if (req.body.published !== undefined) db.logAudit(adminAuth.currentAdmin(req).email, req.body.published ? 'property.published' : 'property.unpublished', req.params.id);
    res.json({ success: true, message: 'Property updated successfully', data: updated });
  } catch (error) {
    console.error('Error updating property:', error);
    res.status(error.status || (error.message.includes('no more than 4 images') ? 400 : 500)).json({ success: false, message: error.status || error.message.includes('no more than 4 images') ? error.message : 'Server error updating property' });
  }
});

// 5. DELETE /api/properties/:id (Delete property)
app.delete('/api/properties/:id', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    const existing = await db.getPropertyById(req.params.id, true);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    await db.deleteProperty(req.params.id);
    db.logAudit(adminAuth.currentAdmin(req).email, 'property.deleted', req.params.id);
    res.json({ success: true, message: 'Property deleted successfully' });
  } catch (error) {
    console.error('Error deleting property:', error);
    res.status(500).json({ success: false, message: 'Server error deleting property' });
  }
});

// ----------------- FEATURED PROJECTS (HERO SLIDES) APIS -----------------

app.get('/api/featured-projects', async (req, res) => {
  try {
    const projects = await db.getFeaturedProjects();
    res.json({ success: true, count: projects.length, data: projects });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ success: false, message: 'Server error fetching projects' });
  }
});

app.post('/api/featured-projects', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    const { name, image } = req.body;
    if (!name || !image) {
      return res.status(400).json({ success: false, message: 'Project name and Image URL are required' });
    }
    const id = await db.createFeaturedProject(req.body);
    res.status(201).json({ success: true, message: 'Slide created successfully', id });
  } catch (error) {
    console.error('Error creating slide:', error);
    res.status(500).json({ success: false, message: 'Server error creating slide' });
  }
});

app.put('/api/featured-projects/:id', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    if (!await db.updateFeaturedProject(req.params.id, req.body)) return res.status(404).json({ success: false, message: 'Slide not found.' });
    res.json({ success: true, message: 'Slide updated successfully' });
  } catch (error) {
    console.error('Error updating slide:', error);
    res.status(500).json({ success: false, message: 'Server error updating slide' });
  }
});

app.delete('/api/featured-projects/:id', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    if (!await db.deleteFeaturedProject(req.params.id)) return res.status(404).json({ success: false, message: 'Slide not found.' });
    res.json({ success: true, message: 'Slide deleted successfully' });
  } catch (error) {
    console.error('Error deleting slide:', error);
    res.status(500).json({ success: false, message: 'Server error deleting slide' });
  }
});

// ----------------- DIRECT IMAGE / PHOTO UPLOAD API -----------------
app.post('/api/upload-image', adminAuth.requireAdmin, async (req, res) => {
  try {
    const { filename, fileData } = req.body;
    if (!fileData) {
      return res.status(400).json({ success: false, message: 'No image file data provided' });
    }

    const base64Content = String(fileData).includes('base64,') ? String(fileData).split('base64,')[1] : String(fileData);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Content)) {
      return res.status(400).json({ success: false, message: 'Invalid image data.' });
    }
    const buffer = Buffer.from(base64Content, 'base64');
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image must be no larger than 8 MB.' });
    }
    const sharp = require('sharp');
    let metadata;
    try { metadata = await sharp(buffer, { failOn: 'error' }).metadata(); }
    catch { return res.status(400).json({ success: false, message: 'Invalid image file.' }); }
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
      return res.status(400).json({ success: false, message: 'Upload a JPEG, PNG, or WebP image.' });
    }
    const optimized = await sharp(buffer)
      .rotate()
      .resize({ width: 2000, height: 1500, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    const uploadDir = path.join(uploadsDir, 'properties');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const baseName = path.basename(String(filename || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_'), path.extname(String(filename || 'photo')));
    const uniqueFilename = `${crypto.randomUUID()}_${baseName.slice(0, 100)}`;
    const filePath = path.join(uploadDir, `${uniqueFilename}.webp`);
    fs.writeFileSync(filePath, optimized);

    const publicUrl = `/uploads/properties/${uniqueFilename}.webp`;
    res.json({ success: true, message: 'Photo uploaded successfully', url: publicUrl });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ success: false, message: 'Failed to upload photo' });
  }
});

// ----------------- BROCHURE PDF UPLOAD API -----------------
async function storeMedia(req, res) {
  try {
    const { filename, fileData, contentType } = req.body;
    if (!fileData) {
      return res.status(400).json({ success: false, message: 'No file data provided.' });
    }
    if (typeof fileData !== 'string') return res.status(400).json({ success: false, message: 'Invalid file data.' });
    const base64Content = fileData.includes('base64,') ? fileData.split('base64,')[1] : fileData;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Content)) {
      return res.status(400).json({ success: false, message: 'Invalid file data.' });
    }
    const buffer = Buffer.from(base64Content, 'base64');
    const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);
    if (!allowedTypes.has(contentType) || buffer.length === 0 || buffer.length > 25 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Use a supported image, MP4/WebM video, or PDF no larger than 25 MB.' });
    }
    if (contentType === 'application/pdf' && buffer.subarray(0, 5).toString() !== '%PDF-') {
      return res.status(400).json({ success: false, message: 'The uploaded file is not a valid PDF.' });
    }
    if (contentType.startsWith('image/')) {
      const sharp = require('sharp');
      let metadata;
      try { metadata = await sharp(buffer, { failOn: 'error' }).metadata(); }
      catch { return res.status(400).json({ success: false, message: 'Invalid image file.' }); }
      if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
        return res.status(400).json({ success: false, message: 'Upload a JPEG, PNG, or WebP image.' });
      }
    }
    const id = await db.createMediaAsset({ filename: (filename || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_'), contentType, data: buffer });
    res.status(201).json({ success: true, url: `/api/media/${id}` });
  } catch (error) {
    console.error('Error storing media:', error);
    res.status(500).json({ success: false, message: 'Failed to store media.' });
  }
}

app.post('/api/media', adminAuth.requireAdmin, storeMedia);
app.post('/api/upload-pdf', adminAuth.requireAdmin, (req, res) => {
  req.body.contentType = req.body.contentType || 'application/pdf';
  return storeMedia(req, res);
});

app.get('/api/media/:id', async (req, res) => {
  try {
    const media = await db.getMediaAsset(req.params.id);
    if (!media) return res.status(404).json({ success: false, message: 'Media not found.' });
    if (media.content_type === 'application/pdf') {
      res.set('Cache-Control', 'private, no-store');
      if (!adminAuth.activeAdmin(req, res)) return;
    }
    res.set({ 'Content-Type': media.content_type, 'Content-Length': media.size_bytes, 'Content-Disposition': `inline; filename="${media.filename.replace(/[\r\n"]/g, '_')}"` });
    res.send(media.data);
  } catch (error) {
    console.error('Error reading media:', error);
    res.status(500).json({ success: false, message: 'Failed to read media.' });
  }
});

// ----------------- ENQUIRIES / LEADS APIS -----------------

// Submit new enquiry (Public)
app.post('/api/enquiries', async (req, res) => {
  try {
    const { message, property_id, property_title } = req.body;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const phone = normalizedPhone(req.body.phone);
    const email = req.body.email ? validEmail(req.body.email) : '';
    if (!name || name.length > 120 || !phone || (req.body.email && !email)) {
      return res.status(400).json({ success: false, message: 'Name and Phone number are required' });
    }
    const requestLimit = db.consumeRateLimit(`enquiry:${req.ip}`, 8, 60 * 60_000);
    if (!requestLimit.allowed) {
      res.setHeader('Retry-After', String(requestLimit.retryAfter));
      return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
    }

    const id = await db.createEnquiry({
      name,
      phone,
      email,
      message,
      property_id,
      property_title
    });
    if (req.body.analytics_consent === true) {
      db.db.prepare('INSERT INTO analytics_events (event_name, property_id) VALUES (?, ?)')
        .run('enquiry', property_id || null);
    }

    res.status(201).json({
      success: true,
      message: 'Thank you! Your viewing request has been recorded. Our agent will contact you shortly.',
      enquiryId: id
    });
  } catch (error) {
    console.error('Error submitting enquiry:', error);
    res.status(500).json({ success: false, message: 'Server error submitting enquiry' });
  }
});

// Get all enquiries (Admin)
app.get('/api/enquiries', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    const { status } = req.query;
    const enquiries = await db.getAllEnquiries(status);
    res.json({ success: true, count: enquiries.length, data: enquiries });
  } catch (error) {
    console.error('Error fetching enquiries:', error);
    res.status(500).json({ success: false, message: 'Server error fetching enquiries' });
  }
});

// Update enquiry status and/or feedback notes (Admin)
app.patch('/api/enquiries/:id', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    const { status, feedback } = req.body;
    if (!db.db.prepare('SELECT 1 FROM enquiries WHERE id = ?').get(req.params.id)) return res.status(404).json({ success: false, message: 'Enquiry not found.' });
    if (status !== undefined && !['New', 'Contacted', 'Closed'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid enquiry status.' });
    if (feedback !== undefined && typeof feedback !== 'string') return res.status(400).json({ success: false, message: 'Feedback must be text.' });
    if (status === undefined && feedback === undefined) {
      return res.status(400).json({ success: false, message: 'Status or feedback is required' });
    }

    if (status !== undefined) {
      await db.updateEnquiryStatus(req.params.id, status);
    }
    if (feedback !== undefined) {
      await db.updateEnquiryFeedback(req.params.id, feedback);
    }

    res.json({ success: true, message: 'Enquiry updated successfully' });
  } catch (error) {
    console.error('Error updating enquiry:', error);
    res.status(500).json({ success: false, message: 'Server error updating enquiry' });
  }
});

// Delete enquiry (Admin)
app.delete('/api/enquiries/:id', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    if (!db.db.prepare('SELECT 1 FROM enquiries WHERE id = ?').get(req.params.id)) return res.status(404).json({ success: false, message: 'Enquiry not found.' });
    await db.deleteEnquiry(req.params.id);
    res.json({ success: true, message: 'Enquiry deleted successfully' });
  } catch (error) {
    console.error('Error deleting enquiry:', error);
    res.status(500).json({ success: false, message: 'Server error deleting enquiry' });
  }
});

function normalizedPhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function twilioVerify(pathname, payload) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) {
    const error = new Error('OTP delivery is not configured. Configure Twilio Verify to enable brochure access.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(payload)
  });
  const result = await response.json();
  if (!response.ok) {
    console.error('Twilio Verify request failed:', response.status, result.code || result.message);
    const error = new Error('Could not send or verify the code. Check the contact information and try again.');
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  return result;
}

app.post('/api/brochures/verification/start', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = validEmail(req.body.email);
    const phone = normalizedPhone(req.body.phone);
    const propertyId = String(req.body.property_id || '').trim();
    const method = req.body.method;
    if (!name || name.length > 120 || !email || !phone || !propertyId || !['email', 'sms'].includes(method) || req.body.privacy_consent !== true) {
      return res.status(400).json({ success: false, message: 'Enter your name, valid email and phone, choose a verification method, and accept the privacy notice.' });
    }

    const property = db.getPropertyById(propertyId);
    if (!property || !property.brochure_url) return res.status(404).json({ success: false, message: 'No brochure is currently available for this property.' });

    const target = method === 'sms' ? phone : email;
    const addressLimit = db.consumeRateLimit(`otp-start:${method}:${target}`, 1, 60_000);
    const ipLimit = db.consumeRateLimit(`otp-ip:${req.ip}`, 10, 60 * 60_000);
    if (!addressLimit.allowed || !ipLimit.allowed) {
      res.setHeader('Retry-After', String(Math.max(addressLimit.retryAfter, ipLimit.retryAfter)));
      return res.status(429).json({ success: false, message: 'A code was recently sent or the request limit was reached. Please wait before trying again.' });
    }

    await twilioVerify('/Verifications', { To: target, Channel: method });
    const id = crypto.randomUUID();
    const now = Date.now();
    const customer = currentCustomer(req);
    db.db.prepare(`
      INSERT INTO otp_verifications (id, property_id, customer_id, name, email, phone, method, consent_at, analytics_consent, last_sent_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, propertyId, customer?.id || null, name, email, phone, method, new Date().toISOString(), Number(req.body.analytics_consent === true), now, now);
    res.status(201).json({ success: true, verificationId: id, expiresInSeconds: 600, resendAfterSeconds: 60 });
  } catch (error) {
    console.error('Could not start brochure verification:', error.message);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not start verification.' });
  }
});

app.post('/api/brochures/verification/resend', async (req, res) => {
  try {
    const id = String(req.body.verification_id || '');
    const record = db.db.prepare('SELECT * FROM otp_verifications WHERE id = ?').get(id);
    if (!record || record.verified_at || Date.now() - record.created_at > 10 * 60_000) {
      return res.status(400).json({ success: false, message: 'This verification has expired. Start again.' });
    }
    if (Date.now() - record.last_sent_at < 60_000) {
      const retryAfter = Math.ceil((60_000 - (Date.now() - record.last_sent_at)) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ success: false, message: `Wait ${retryAfter} seconds before requesting another code.` });
    }
    const resendLimit = db.consumeRateLimit(`otp-resend:${record.id}`, 3, 60 * 60_000);
    if (!resendLimit.allowed) {
      res.setHeader('Retry-After', String(resendLimit.retryAfter));
      return res.status(429).json({ success: false, message: 'Resend limit reached. Start again later.' });
    }
    const target = record.method === 'sms' ? record.phone : record.email;
    await twilioVerify('/Verifications', { To: target, Channel: record.method });
    const now = Date.now();
    db.db.prepare('UPDATE otp_verifications SET created_at = ?, last_sent_at = ?, attempt_count = 0 WHERE id = ?')
      .run(now, now, record.id);
    res.json({ success: true, expiresInSeconds: 600, resendAfterSeconds: 60 });
  } catch (error) {
    console.error('Could not resend brochure verification:', error.message);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not resend the code.' });
  }
});

app.post('/api/brochures/verification/complete', async (req, res) => {
  try {
    const verificationId = String(req.body.verification_id || '');
    const code = String(req.body.code || '').trim();
    if (!/^[0-9]{4,10}$/.test(code)) return res.status(400).json({ success: false, message: 'Enter the verification code.' });
    const record = db.db.prepare('SELECT * FROM otp_verifications WHERE id = ?').get(verificationId);
    if (!record || record.verified_at || Date.now() - record.created_at > 10 * 60_000) {
      return res.status(400).json({ success: false, message: 'This verification has expired. Request a new code.' });
    }
    const attemptLimit = db.consumeRateLimit(`otp-check:${verificationId}`, 5, 10 * 60_000);
    const ipLimit = db.consumeRateLimit(`otp-check-ip:${req.ip}`, 30, 60 * 60_000);
    if (!attemptLimit.allowed || !ipLimit.allowed || record.attempt_count >= 5) {
      res.setHeader('Retry-After', String(Math.max(attemptLimit.retryAfter, ipLimit.retryAfter, 600)));
      return res.status(429).json({ success: false, message: 'Too many verification attempts. Request a new code later.' });
    }
    db.db.prepare('UPDATE otp_verifications SET attempt_count = attempt_count + 1 WHERE id = ?').run(verificationId);

    const property = db.getPropertyById(record.property_id);
    if (!property || !property.brochure_url) return res.status(404).json({ success: false, message: 'The property brochure is no longer available.' });
    const target = record.method === 'sms' ? record.phone : record.email;
    const checked = await twilioVerify('/VerificationCheck', { To: target, Code: code });
    if (checked.status !== 'approved') return res.status(400).json({ success: false, message: 'The code is incorrect or expired.' });

    const now = Date.now();
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const claimed = db.db.prepare('UPDATE otp_verifications SET verified_at = ? WHERE id = ? AND verified_at IS NULL')
      .run(new Date(now).toISOString(), verificationId);
    if (!claimed.changes) return res.status(400).json({ success: false, message: 'This verification has already been used.' });
    db.db.prepare(`
      INSERT INTO brochure_downloads (verification_id, property_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(verificationId, record.property_id, tokenHash, now + 5 * 60_000, now);
    if (record.analytics_consent) {
      db.db.prepare('INSERT INTO analytics_events (event_name, property_id) VALUES (?, ?)')
        .run('verification_completed', record.property_id);
    }
    db.logAudit('customer', 'brochure.verified', record.property_id);
    res.json({
      success: true,
      downloadUrl: `/api/brochures/download/${token}`,
      expiresInSeconds: 300
    });
  } catch (error) {
    console.error('Could not complete brochure verification:', error.message);
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not verify the code.' });
  }
});

app.get('/api/brochures/download/:token', (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(String(req.params.token)).digest('hex');
  const download = db.db.prepare(`
    SELECT brochure_downloads.id, brochure_downloads.property_id, otp_verifications.verified_at, otp_verifications.analytics_consent
    FROM brochure_downloads
    JOIN otp_verifications ON otp_verifications.id = brochure_downloads.verification_id
    WHERE brochure_downloads.token_hash = ? AND brochure_downloads.expires_at > ?
      AND brochure_downloads.downloaded_at IS NULL AND otp_verifications.verified_at IS NOT NULL
  `).get(tokenHash, Date.now());
  if (!download) return res.status(404).json({ success: false, message: 'This download link is invalid, expired, or already used.' });

  const property = db.getPropertyById(download.property_id);
  if (!property) return res.sendStatus(404);
  let bytes;
  let filename = 'property-brochure.pdf';
  if (property.brochure_url.startsWith('/api/media/')) {
    const mediaId = property.brochure_url.slice('/api/media/'.length);
    const media = db.getMediaAsset(mediaId);
    if (!media || media.content_type !== 'application/pdf') return res.sendStatus(404);
    bytes = media.data;
    filename = media.filename;
  } else if (property.brochure_url.startsWith('/uploads/brochures/')) {
    const safeName = path.basename(property.brochure_url.slice('/uploads/brochures/'.length));
    const brochurePath = path.resolve(uploadsDir, 'brochures', safeName);
    const expectedDir = path.resolve(uploadsDir, 'brochures');
    if (path.dirname(brochurePath) !== expectedDir || !fs.existsSync(brochurePath)) return res.sendStatus(404);
    bytes = fs.readFileSync(brochurePath);
    filename = safeName;
  } else {
    return res.status(404).json({ success: false, message: 'Brochure storage is not configured for this listing.' });
  }
  const used = db.db.prepare('UPDATE brochure_downloads SET downloaded_at = ? WHERE id = ? AND downloaded_at IS NULL')
    .run(Date.now(), download.id);
  if (!used.changes) return res.status(404).json({ success: false, message: 'This download link has already been used.' });
  if (download.analytics_consent) {
    db.db.prepare('INSERT INTO analytics_events (event_name, property_id) VALUES (?, ?)')
      .run('brochure_download', download.property_id);
  }
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': bytes.length,
    'Content-Disposition': `attachment; filename="${filename.replace(/[\r\n"]/g, '_')}"`,
    'Cache-Control': 'private, no-store'
  });
  res.send(bytes);
});

app.get('/api/admin/brochure-activity', adminAuth.requireAdmin, (req, res) => {
  const activity = db.db.prepare(`
    SELECT v.id, v.name, v.email, v.phone, v.method, v.consent_at, v.verified_at, v.property_id,
      p.title AS property_title, d.created_at AS download_created_at, d.downloaded_at
    FROM otp_verifications v
    LEFT JOIN properties p ON p.id = v.property_id
    LEFT JOIN brochure_downloads d ON d.verification_id = v.id
    ORDER BY v.created_at DESC LIMIT 500
  `).all();
  res.json({ success: true, data: activity });
});

app.post('/api/subscribers', (req, res) => {
  const email = validEmail(req.body.email);
  const name = String(req.body.name || '').trim().slice(0, 120);
  if (!email || req.body.marketing_consent !== true) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address and consent to property updates.' });
  }
  const rate = db.consumeRateLimit(`subscribe:${req.ip}`, 5, 60 * 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.status(429).json({ success: false, message: 'Too many subscription requests. Try again later.' });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date().toISOString();
  db.db.prepare(`
    INSERT INTO subscribers (email, name, consent_at, unsubscribed_at, unsubscribe_token_hash)
    VALUES (?, ?, ?, NULL, ?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name, consent_at = excluded.consent_at,
      unsubscribed_at = NULL, unsubscribe_token_hash = excluded.unsubscribe_token_hash
  `).run(email, name || null, now, tokenHash);
  if (req.body.analytics_consent === true) db.db.prepare('INSERT INTO analytics_events (event_name) VALUES (?)').run('subscription');
  res.status(201).json({ success: true, message: 'You are subscribed to property updates.', unsubscribeToken: token });
});

app.post('/api/subscribers/unsubscribe', (req, res) => {
  const token = String(req.body.token || '');
  if (token.length < 32 || token.length > 128) return res.status(400).json({ success: false, message: 'Invalid unsubscribe link.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = db.db.prepare(`
    UPDATE subscribers SET unsubscribed_at = CURRENT_TIMESTAMP
    WHERE unsubscribe_token_hash = ? AND unsubscribed_at IS NULL
  `).run(tokenHash);
  if (!result.changes) return res.status(404).json({ success: false, message: 'This link is invalid or has already been used.' });
  res.json({ success: true, message: 'You have been unsubscribed.' });
});

app.get('/api/admin/subscribers', adminAuth.requireAdmin, (req, res) => {
  const search = String(req.query.search || '').slice(0, 100);
  const status = req.query.status === 'unsubscribed' ? 1 : req.query.status === 'active' ? 0 : null;
  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(email LIKE ? OR name LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (status !== null) {
    clauses.push(status ? 'unsubscribed_at IS NOT NULL' : 'unsubscribed_at IS NULL');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.db.prepare(`SELECT email, name, consent_at, unsubscribed_at, created_at FROM subscribers ${where} ORDER BY created_at DESC LIMIT 1000`).all(...params);
  res.json({ success: true, count: rows.length, data: rows });
});

app.post('/api/admin/subscribers/export', adminAuth.requireAdmin, (req, res) => {
  if (req.body.confirm !== true) return res.status(400).json({ success: false, message: 'Explicit export confirmation is required.' });
  const rows = db.db.prepare('SELECT email, name, consent_at, unsubscribed_at, created_at FROM subscribers ORDER BY created_at DESC').all();
  const escapeCsv = value => {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = [
    ['email', 'name', 'consent_at', 'unsubscribed_at', 'created_at'].map(escapeCsv).join(','),
    ...rows.map(row => [row.email, row.name, row.consent_at, row.unsubscribed_at, row.created_at].map(escapeCsv).join(','))
  ].join('\r\n');
  db.logAudit(req.admin.email, 'subscribers.exported', null, { count: rows.length });
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="subscribers.csv"', 'Cache-Control': 'no-store' });
  res.send(csv);
});

const publicAnalyticsEvents = new Set(['property_view', 'enquiry', 'social_click']);
app.post('/api/analytics/events', (req, res) => {
  if (req.body.consent !== true) return res.status(204).end();
  const eventName = String(req.body.event || '');
  if (!publicAnalyticsEvents.has(eventName)) return res.status(400).json({ success: false, message: 'Unsupported analytics event.' });
  const propertyId = req.body.property_id ? String(req.body.property_id).slice(0, 100) : null;
  const source = req.body.source ? String(req.body.source).slice(0, 200) : null;
  const sessionId = String(req.body.session_id || '').slice(0, 100);
  const salt = process.env.IP_HASH_SALT;
  const sessionHash = salt && sessionId
    ? crypto.createHash('sha256').update(`${salt}:${req.ip}:${sessionId}`).digest('hex')
    : null;
  db.db.prepare('INSERT INTO analytics_events (event_name, property_id, source, session_hash) VALUES (?, ?, ?, ?)')
    .run(eventName, propertyId, source, sessionHash);
  res.status(204).end();
});

app.get('/api/public-config', (_req, res) => {
  const measurementId = String(process.env.GA4_MEASUREMENT_ID || '');
  res.json({ analyticsMeasurementId: /^G-[A-Z0-9]+$/.test(measurementId) ? measurementId : '' });
});

app.get('/api/admin/analytics', adminAuth.requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rate = db.consumeRateLimit(`admin-analytics:${req.admin.id}`, 30, 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.status(429).json({ success: false, message: 'Analytics refresh limit reached. Try again shortly.' });
  }

  const range = typeof req.query.range === 'string' ? req.query.range : '30d';
  if (!Object.hasOwn(ALLOWED_RANGES, range)) {
    return res.status(400).json({ success: false, message: 'Choose a supported analytics date range.' });
  }
  const country = typeof req.query.country === 'string' ? req.query.country.trim() : '';
  if (req.query.country !== undefined && (typeof req.query.country !== 'string' || !/^[\p{L}\p{M} .,'’()-]{1,80}$/u.test(country))) {
    return res.status(400).json({ success: false, message: 'Choose a valid country filter.' });
  }

  try {
    const data = await ga4Analytics.getDashboard({ range, country });
    if (data.status === 'setup-required') data.locationMapNotice = LOCATION_MAP_NOTICE;
    res.json({ success: true, data });
  } catch (error) {
    console.error('GA4 analytics request failed:', error.message);
    res.status(502).json({
      success: false,
      message: 'GA4 is temporarily unavailable. Check the service-account configuration, GA4 property access, and Data API availability.'
    });
  }
});

const mcpToolDefinitions = [
  { name: 'properties_list', description: 'List published properties using optional filters.', inputSchema: { type: 'object', properties: { locality: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } } },
  { name: 'property_get', description: 'Read one published property by ID.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'website_content_get', description: 'Read approved public site content such as hero copy and contact details.', inputSchema: { type: 'object', properties: {} } },
  { name: 'property_draft_create', description: 'Create a property draft. Drafts remain unpublished.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, location: { type: 'string' }, price: { type: 'number' }, bhk: { type: 'integer' }, area: { type: 'string' }, images: { type: 'array', maxItems: 4, items: { type: 'string' } }, description: { type: 'string' } }, required: ['title', 'location', 'price', 'bhk', 'area'] } },
  { name: 'property_draft_update', description: 'Update an unpublished property draft; publishing and deletion are unavailable through MCP.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, location: { type: 'string' }, price: { type: 'number' }, bhk: { type: 'integer' }, area: { type: 'string' }, images: { type: 'array', maxItems: 4, items: { type: 'string' } }, description: { type: 'string' } }, required: ['id'] } }
];

app.post('/mcp', (req, res) => {
  const authorization = String(req.get('authorization') || '');
  const readToken = process.env.MCP_READ_TOKEN;
  const writeToken = process.env.MCP_WRITE_TOKEN;
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const isRead = Boolean(readToken) && crypto.timingSafeEqual(
    Buffer.from(crypto.createHash('sha256').update(token).digest()),
    Buffer.from(crypto.createHash('sha256').update(readToken).digest())
  );
  const isWrite = Boolean(writeToken) && crypto.timingSafeEqual(
    Buffer.from(crypto.createHash('sha256').update(token).digest()),
    Buffer.from(crypto.createHash('sha256').update(writeToken).digest())
  );
  const request = req.body || {};
  const reply = (result, error) => res.json({
    jsonrpc: '2.0',
    id: request.id ?? null,
    ...(error ? { error } : { result })
  });
  if (!isRead && !isWrite) return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'Unauthorized' });
  const rate = db.consumeRateLimit(`mcp:${crypto.createHash('sha256').update(token).digest('hex')}:${req.ip}`, 120, 60_000);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfter));
    return res.status(429).json({ error: 'Rate limit exceeded.' });
  }
  if (!request || request.jsonrpc !== '2.0' || !request.method) return reply(undefined, { code: -32600, message: 'Invalid JSON-RPC request.' });
  if (request.method === 'initialize') {
    return reply({
      protocolVersion: request.params?.protocolVersion || '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'vasati-properties', version: '1.0.0' }
    });
  }
  if (request.method === 'notifications/initialized') return res.status(202).end();
  if (request.method === 'ping') return reply({});
  if (request.method === 'tools/list') {
    return reply({ tools: mcpToolDefinitions.filter(tool => isWrite || !tool.name.startsWith('property_draft_')) });
  }
  if (request.method !== 'tools/call') return reply(undefined, { code: -32601, message: 'Method not found.' });
  const toolName = String(request.params?.name || '');
  const args = request.params?.arguments || {};
  try {
    let result;
    if (toolName === 'properties_list') {
      const properties = db.getAllProperties({ locality: String(args.locality || ''), sort: 'recommended' })
        .slice(0, Math.min(Number(args.limit) || 20, 50))
        .map(({ admin_note, ...property }) => property);
      result = properties;
    } else if (toolName === 'property_get') {
      const property = db.getPropertyById(String(args.id || ''));
      if (!property) return reply(undefined, { code: -32004, message: 'Property not found.' });
      const { admin_note, ...publicProperty } = property;
      result = publicProperty;
    } else if (toolName === 'website_content_get') {
      const settings = db.getSiteSettings();
      const allowedKeys = ['hero_tag', 'hero_title', 'hero_subtitle', 'contact_phone', 'contact_email', 'whatsapp_number'];
      result = Object.fromEntries(allowedKeys.filter(key => settings[key] !== undefined).map(key => [key, settings[key]]));
    } else if (toolName === 'property_draft_create' && isWrite) {
      const images = args.images ?? [];
      if (!Array.isArray(images) || images.length > 4 || !String(args.title || '').trim() || !String(args.location || '').trim() || !Number.isFinite(Number(args.price)) || Number(args.price) <= 0 || !Number.isInteger(Number(args.bhk)) || !String(args.area || '').trim()) {
        return reply(undefined, { code: -32602, message: 'Invalid property draft input.' });
      }
      const id = db.createProperty({ ...args, images, published: false });
      db.logAudit('mcp-write-scope', 'property.draft_created', id);
      result = { id, published: false };
    } else if (toolName === 'property_draft_update' && isWrite) {
      const current = db.getPropertyById(String(args.id || ''), true);
      if (!current || current.published) return reply(undefined, { code: -32004, message: 'Unpublished draft not found.' });
      const fields = ['title', 'location', 'price', 'bhk', 'area', 'images', 'description'];
      const patch = Object.fromEntries(fields.filter(key => args[key] !== undefined).map(key => [key, args[key]]));
      if (patch.images && (!Array.isArray(patch.images) || patch.images.length > 4)) return reply(undefined, { code: -32602, message: 'A property draft can contain at most 4 images.' });
      db.updateProperty(current.id, patch);
      db.logAudit('mcp-write-scope', 'property.draft_updated', current.id);
      result = { id: current.id, published: false };
    } else {
      return reply(undefined, { code: -32601, message: 'Tool not found or token scope is insufficient.' });
    }
    return reply({ content: [{ type: 'text', text: JSON.stringify(result) }] });
  } catch (error) {
    console.error('MCP tool failed:', toolName, error.message);
    return reply(undefined, { code: error.status === 400 ? -32602 : -32603, message: error.status === 400 ? error.message : 'Tool execution failed.' });
  }
});

// ----------------- ANALYTICS & STATS APIS -----------------

app.get('/api/stats', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    const stats = await db.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, message: 'Server error fetching stats' });
  }
});

// Fallback to index.html
app.use((req, res) => {
  if (req.path === '/mcp') return res.set('Allow', 'POST').sendStatus(405);
  if (req.path.startsWith('/api/')) return res.status(404).json({ success: false, message: 'API route not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('Request failed:', error.message);
  res.status(error.status >= 400 && error.status < 500 ? error.status : 500)
    .json({ success: false, message: error.status === 413 ? 'Request body is too large.' : error.status === 400 ? 'Invalid request body.' : 'Request could not be completed.' });
});

// Initialize SQLite schema and start the server.
try {
  db.initializeDatabase();
  adminAuth.initializeAdmin().then(() => {
    const server = app.listen(PORT, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : PORT;
      console.log(`🚀 Vasati Properties Server is running at http://localhost:${port}`);
      console.log(`📊 Admin Panel: http://localhost:${port}/admin`);
    });
  }).catch(error => {
    console.error('Unable to initialize administrator account:', error);
    process.exit(1);
  });
} catch (error) {
  console.error('Unable to initialize database:', error);
  process.exit(1);
}
