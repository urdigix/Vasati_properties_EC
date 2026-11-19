const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const db = require('./db/database');
const adminAuth = require('./server/admin-auth');
const { installSeo, notFound } = require('./server/seo');
const { validateSearchLocalities } = require('./server/search-localities');
const { ALLOWED_RANGES, Ga4AnalyticsClient, LOCATION_MAP_NOTICE } = require('./server/ga4-analytics');

const app = express();
const ga4Analytics = new Ga4AnalyticsClient();
const requestedPort = Number.parseInt(process.env.PORT || '3000', 10);
const PORT = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 3000;
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads'));
fs.mkdirSync(path.join(uploadsDir, 'properties'), { recursive: true });
fs.mkdirSync(path.join(uploadsDir, 'brochures'), { recursive: true });
installSeo(app, db);

// Middlewares
const trustedProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS || '0', 10);
app.set('trust proxy', Number.isInteger(trustedProxyHops) && trustedProxyHops >= 0 ? trustedProxyHops : 0);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

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
  if (req.body && Object.hasOwn(req.body, 'search_localities')) {
    try { validateSearchLocalities(req.body.search_localities); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
  }
  try {
    await db.updateSiteSettings(req.body);
    const updated = await db.getSiteSettings();
    res.json({ success: true, message: 'Settings updated successfully', data: updated });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ success: false, message: 'Server error updating settings' });
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

    const newId = await db.createProperty({ ...req.body, published: Boolean(req.body.published) });
    const created = await db.getPropertyById(newId, true);
    db.logAudit(adminAuth.currentAdmin(req).email, 'property.created', newId, { published: false });
    res.status(201).json({ success: true, message: 'Property created successfully', data: created });
  } catch (error) {
    console.error('Error creating property:', error);
    res.status(['INVALID_PROJECT_OVERVIEW', 'INVALID_FLOOR_PLANS'].includes(error.code) || error.message.includes('no more than 4 images') ? 400 : 500).json({ success: false, message: error.message || 'Server error creating property' });
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
    res.status(['INVALID_PROJECT_OVERVIEW', 'INVALID_FLOOR_PLANS'].includes(error.code) || error.message.includes('no more than 4 images') ? 400 : 500).json({ success: false, message: error.message || 'Server error updating property' });
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
    await db.updateFeaturedProject(req.params.id, req.body);
    res.json({ success: true, message: 'Slide updated successfully' });
  } catch (error) {
    console.error('Error updating slide:', error);
    res.status(500).json({ success: false, message: 'Server error updating slide' });
  }
});

app.delete('/api/featured-projects/:id', async (req, res) => {
  if (!adminAuth.activeAdmin(req, res)) return;
  try {
    await db.deleteFeaturedProject(req.params.id);
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
    const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
      return res.status(400).json({ success: false, message: 'Upload a JPEG, PNG, or WebP image.' });
    }
    const optimized = await sharp(buffer)
      .rotate()
      .resize({ width: req.body.purpose === 'floor-plan' ? 4000 : 2000, height: req.body.purpose === 'floor-plan' ? 4000 : 1500, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: req.body.purpose === 'floor-plan' ? 95 : 82, effort: 4 })
      .toBuffer();

    const uploadDir = path.join(uploadsDir, 'properties');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const baseName = path.basename(String(filename || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_'), path.extname(String(filename || 'photo')));
    const uniqueFilename = `${Date.now()}_${baseName}`;
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
      const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
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
    if (media.content_type === 'application/pdf' && !adminAuth.activeAdmin(req, res)) {
      return;
    }
    res.set({ 'Content-Type': media.content_type, 'Content-Length': media.size_bytes, 'Content-Disposition': `inline; filename="${media.filename.replace(/[\r\n"]/g, '_')}"` });
    res.send(media.data);
  } catch (error) {
    console.error('Error reading media:', error);
    res.status(500).json({ success: false, message: 'Failed to read media.' });
  }
});

// ----------------- ENQUIRIES / LEADS APIS -----------------

// Public leads are created only after the SMS verification flow completes.
app.post('/api/enquiries', (_req, res) => {
  res.status(410).json({
    success: false,
    message: 'Phone verification is required before a site visit can be scheduled.'
  });
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
    await db.deleteEnquiry(req.params.id);
    res.json({ success: true, message: 'Enquiry deleted successfully' });
  } catch (error) {
    console.error('Error deleting enquiry:', error);
    res.status(500).json({ success: false, message: 'Server error deleting enquiry' });
  }
});

function normalizedPhone(value) {
  const phone = String(value || '').trim();
  const compact = phone.replace(/[\s()-]/g, '');
  if (/^\d{10}$/.test(compact)) return `+91${compact}`;
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  return null;
}

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

const OTP_LIFETIME_MS = 5 * 60_000;
const OTP_RESEND_COOLDOWN_MS = 60_000;
const rateLimitSalt = process.env.IP_HASH_SALT || crypto.randomBytes(32).toString('hex');
const publicSessionCookie = 'vasati_form_session';

function hashRateLimitValue(value) {
  return crypto.createHmac('sha256', rateLimitSalt).update(String(value || '')).digest('hex');
}

function getPublicSession(req, res, create = true) {
  const token = cookieValue(req, publicSessionCookie);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    return { token, hash: crypto.createHash('sha256').update(token).digest('hex') };
  }
  if (!create) return null;

  const newToken = crypto.randomBytes(32).toString('hex');
  const cookie = [
    `${publicSessionCookie}=${newToken}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=86400'
  ];
  if (process.env.NODE_ENV === 'production') cookie.push('Secure');
  res.append('Set-Cookie', cookie.join('; '));
  return { token: newToken, hash: crypto.createHash('sha256').update(newToken).digest('hex') };
}

function rateLimitResponse(res, result, message) {
  if (result.allowed) return false;
  res.setHeader('Retry-After', String(result.retryAfter));
  res.status(429).json({ success: false, message });
  return true;
}

function consumePublicLimit(res, key, limit, windowMs, message) {
  return rateLimitResponse(res, db.consumeRateLimit(key, limit, windowMs), message);
}

function currentClientIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

async function verifyTurnstile(token, req, expectedAction) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    return { success: false, status: 503, message: 'Bot protection is not configured. Please contact the site administrator.' };
  }
  if (typeof token !== 'string' || token.length < 1 || token.length > 2048) {
    return { success: false, status: 403, message: 'Complete the security check and try again.' };
  }

  try {
    const body = new URLSearchParams({ secret: secretKey, response: token });
    const ip = currentClientIp(req);
    if (ip) body.set('remoteip', ip);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) {
      return { success: false, status: 503, message: 'Security verification is temporarily unavailable. Please try again.' };
    }

    const result = await response.json();
    const expectedHost = process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).hostname : '';
    const hostMatches = process.env.NODE_ENV !== 'production' ||
      !expectedHost || result.hostname === expectedHost;
    if (result.success && result.action === expectedAction && hostMatches) {
      return { success: true };
    }
    return { success: false, status: 403, message: 'Security check expired or invalid. Please try again.' };
  } catch {
    return { success: false, status: 503, message: 'Security verification is temporarily unavailable. Please try again.' };
  }
}

function maskContact(method, target) {
  if (method === 'email') {
    const [local, domain] = target.split('@');
    return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, local.length - 1))}@${domain}`;
  }
  return `${target.slice(0, -4).replace(/\d/g, '*')}${target.slice(-4)}`;
}

function currentIndiaDateTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function validVisitDateTime(date, time, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year || parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day || hour > 23 || minute > 59) return false;
  const current = currentIndiaDateTime(now);
  return date > current.date || (date === current.date && time > current.time);
}

function getVerification(id, purpose, sessionHash) {
  return db.db.prepare(`
    SELECT * FROM otp_verifications
    WHERE id = ? AND purpose = ? AND session_hash = ?
  `).get(id, purpose, sessionHash);
}

async function twilioVerify(pathname, payload) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) {
    const error = new Error('OTP delivery is not configured. Configure Twilio Verify to enable contact verification.');
    error.status = 503;
    throw error;
  }
  try {
    const response = await fetch(`https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}${pathname}`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(payload),
      signal: AbortSignal.timeout(10_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Twilio Verify request failed:', response.status, result.code || 'provider_error');
      const error = new Error('Could not send or verify the code. Check the contact information and try again.');
      error.status = response.status === 429 ? 429 : 502;
      throw error;
    }
    return result;
  } catch (error) {
    if (error.status) throw error;
    const unavailable = new Error('OTP delivery is temporarily unavailable. Please try again.');
    unavailable.status = 502;
    throw unavailable;
  }
}

async function startOtpVerification(req, res, options) {
  try {
    const { purpose, action, method, target, property, name, email, phone, preferredDate, preferredTime, privacyAcknowledged } = options;
    const session = getPublicSession(req, res);
    const ipHash = hashRateLimitValue(currentClientIp(req));
    if (consumePublicLimit(res, `otp-start-ip:${ipHash}`, 20, 60 * 60_000, 'Too many verification requests from this connection. Try again later.')) return;
    if (consumePublicLimit(res, `otp-start-session:${session.hash}`, 20, 60 * 60_000, 'Too many verification requests in this session. Try again later.')) return;

    const captcha = await verifyTurnstile(req.body.captcha_token, req, action);
    if (!captcha.success) return res.status(captcha.status).json({ success: false, message: captcha.message });

    const contactHash = hashRateLimitValue(`${method}:${target}`);
    if (consumePublicLimit(res, `otp-start-contact:${contactHash}`, 5, 60 * 60_000, 'Too many codes have been sent to this contact. Try again later.')) return;
    if (consumePublicLimit(res, `otp-start-cooldown:${contactHash}`, 1, OTP_RESEND_COOLDOWN_MS, 'A code was recently sent. Wait before requesting another.')) return;

    const now = Date.now();
    db.db.prepare(`
      UPDATE otp_verifications SET expires_at = ?
      WHERE contact_hash = ? AND verified_at IS NULL AND expires_at > ?
    `).run(now, contactHash, now);

    await twilioVerify('/Verifications', { To: target, Channel: method });
    const id = crypto.randomUUID();
    const expiresAt = now + OTP_LIFETIME_MS;
    db.db.prepare(`
      INSERT INTO otp_verifications (
        id, property_id, customer_id, name, email, phone, method, consent_at,
        analytics_consent, last_sent_at, created_at, purpose, session_hash,
        contact_hash, expires_at, preferred_date, preferred_time, privacy_acknowledged
      ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      property.id,
      name,
      email || '',
      phone || '',
      method,
      new Date(now).toISOString(),
      Number(req.body.analytics_consent === true),
      now,
      now,
      purpose,
      session.hash,
      contactHash,
      expiresAt,
      preferredDate || null,
      preferredTime || null,
      Number(privacyAcknowledged)
    );
    res.status(201).json({
      success: true,
      verificationId: id,
      maskedDestination: maskContact(method, target),
      expiresInSeconds: OTP_LIFETIME_MS / 1000,
      resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000
    });
  } catch (error) {
    console.error(`Could not start ${options.purpose.toLowerCase()} verification.`, error.status || 'internal_error');
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not start verification.' });
  }
}

app.post('/api/site-visits/verification/start', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const phone = normalizedPhone(req.body.phone);
    const propertyId = String(req.body.property_id || '').trim();
    const preferredDate = String(req.body.preferred_date || '');
    const preferredTime = String(req.body.preferred_time || '');
    if (name.length < 2 || name.length > 120 || !phone || !propertyId ||
        !validVisitDateTime(preferredDate, preferredTime)) {
      return res.status(400).json({
        success: false,
        message: 'Enter your name, a valid phone number, and a future inspection date and time in IST.'
      });
    }
    const property = db.getPropertyById(propertyId);
    if (!property) return res.status(404).json({ success: false, message: 'This property is no longer available.' });
    return startOtpVerification(req, res, {
      purpose: 'SITE_VISIT',
      action: 'site_visit',
      method: 'sms',
      target: phone,
      property,
      name,
      email: '',
      phone,
      preferredDate,
      preferredTime,
      privacyAcknowledged: false
    });
  } catch (error) {
    console.error('Could not start site visit verification.', error.status || 'internal_error');
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not start verification.' });
  }
});

app.post('/api/brochures/verification/start', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = req.body.email ? validEmail(req.body.email) : '';
    const phone = req.body.phone ? normalizedPhone(req.body.phone) : '';
    const propertyId = String(req.body.property_id || '').trim();
    const method = req.body.method;
    if (!name || name.length > 120 || !propertyId ||
        !['email', 'sms'].includes(method) || req.body.privacy_consent !== true ||
        (req.body.email && !email) || (req.body.phone && !phone) ||
        (method === 'email' && !email) || (method === 'sms' && !phone)) {
      return res.status(400).json({
        success: false,
        message: 'Enter your name, the selected contact method, and accept the privacy notice.'
      });
    }
    const property = db.getPropertyById(propertyId);
    if (!property || !property.brochure_url) {
      return res.status(404).json({ success: false, message: 'No brochure is currently available for this property.' });
    }
    return startOtpVerification(req, res, {
      purpose: 'BROCHURE',
      action: 'brochure',
      method,
      target: method === 'sms' ? phone : email,
      property,
      name,
      email,
      phone,
      privacyAcknowledged: true
    });
  } catch (error) {
    console.error('Could not start brochure verification.', error.status || 'internal_error');
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not start verification.' });
  }
});

app.post('/api/site-visits/verification/resend', (req, res) =>
  resendOtpVerification(req, res, 'SITE_VISIT')
);

app.post('/api/brochures/verification/resend', (req, res) =>
  resendOtpVerification(req, res, 'BROCHURE')
);

async function resendOtpVerification(req, res, purpose) {
  try {
    const session = getPublicSession(req, res, false);
    const id = String(req.body.verification_id || '');
    const record = session && getVerification(id, purpose, session.hash);
    const now = Date.now();
    if (!record || record.verified_at || record.expires_at <= now) {
      return res.status(400).json({ success: false, message: 'This verification has expired. Start again.' });
    }
    const cooldown = OTP_RESEND_COOLDOWN_MS - (now - record.last_sent_at);
    if (cooldown > 0) {
      const seconds = Math.ceil(cooldown / 1000);
      res.setHeader('Retry-After', String(seconds));
      return res.status(429).json({ success: false, message: `Wait ${seconds} seconds before requesting another code.` });
    }

    const contactHash = record.contact_hash;
    const ipHash = hashRateLimitValue(currentClientIp(req));
    if (consumePublicLimit(res, `otp-resend-id:${id}`, 3, 60 * 60_000, 'Resend limit reached. Start again later.')) return;
    if (consumePublicLimit(res, `otp-resend-contact:${contactHash}`, 5, 60 * 60_000, 'Too many codes have been sent to this contact. Try again later.')) return;
    if (consumePublicLimit(res, `otp-resend-ip:${ipHash}`, 20, 60 * 60_000, 'Too many verification requests from this connection. Try again later.')) return;
    if (consumePublicLimit(res, `otp-resend-session:${session.hash}`, 10, 60 * 60_000, 'Too many verification requests in this session. Try again later.')) return;

    db.db.prepare('UPDATE otp_verifications SET expires_at = ? WHERE id = ? AND verified_at IS NULL')
      .run(now, id);
    const target = record.method === 'sms' ? record.phone : record.email;
    await twilioVerify('/Verifications', { To: target, Channel: record.method });
    db.db.prepare(`
      UPDATE otp_verifications
      SET created_at = ?, last_sent_at = ?, expires_at = ?, attempt_count = 0
      WHERE id = ? AND verified_at IS NULL
    `).run(now, now, now + OTP_LIFETIME_MS, id);
    res.json({
      success: true,
      expiresInSeconds: OTP_LIFETIME_MS / 1000,
      resendAfterSeconds: OTP_RESEND_COOLDOWN_MS / 1000
    });
  } catch (error) {
    console.error(`Could not resend ${purpose.toLowerCase()} verification.`, error.status || 'internal_error');
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not resend the code.' });
  }
}

app.post('/api/verification/cancel', (req, res) => {
  const session = getPublicSession(req, res, false);
  const verificationId = String(req.body.verification_id || '');
  const purpose = String(req.body.purpose || '');
  if (!session || !['SITE_VISIT', 'BROCHURE'].includes(purpose)) {
    return res.status(204).end();
  }
  db.db.prepare(`
    UPDATE otp_verifications SET expires_at = ?
    WHERE id = ? AND session_hash = ? AND purpose = ? AND verified_at IS NULL
  `).run(Date.now(), verificationId, session.hash, purpose);
  res.status(204).end();
});

function otpAttemptAllowed(req, res, record, session) {
  const now = Date.now();
  if (record.expires_at <= now) {
    res.status(400).json({ success: false, message: 'This code has expired. Request a new code.' });
    return false;
  }
  if (record.attempt_count >= 5) {
    res.setHeader('Retry-After', '300');
    res.status(429).json({ success: false, message: 'Too many incorrect attempts. Request a new code later.' });
    return false;
  }
  const ipHash = hashRateLimitValue(currentClientIp(req));
  if (consumePublicLimit(res, `otp-check-id:${record.id}`, 5, 10 * 60_000, 'Too many verification attempts. Request a new code later.')) return false;
  if (consumePublicLimit(res, `otp-check-ip:${ipHash}`, 30, 60 * 60_000, 'Too many verification attempts from this connection. Try again later.')) return false;
  if (consumePublicLimit(res, `otp-check-session:${session.hash}`, 20, 60 * 60_000, 'Too many verification attempts in this session. Try again later.')) return false;
  db.db.prepare('UPDATE otp_verifications SET attempt_count = attempt_count + 1 WHERE id = ? AND attempt_count < 5')
    .run(record.id);
  return true;
}

function visitPayloadMatches(record, body) {
  return String(body.name || '').trim() === record.name &&
    normalizedPhone(body.phone) === record.phone &&
    String(body.property_id || '') === record.property_id &&
    String(body.preferred_date || '') === record.preferred_date &&
    String(body.preferred_time || '') === record.preferred_time;
}

function siteVisitReceipt(leadId, record) {
  return {
    success: true,
    referenceId: String(leadId),
    maskedPhone: maskContact('sms', record.phone),
    message: 'Your site visit request has been securely received. An authorized advisor will contact you about this visit.'
  };
}

app.post('/api/site-visits/verification/complete', async (req, res) => {
  try {
    const session = getPublicSession(req, res, false);
    const verificationId = String(req.body.verification_id || '');
    const record = session && getVerification(verificationId, 'SITE_VISIT', session.hash);
    if (!record || !visitPayloadMatches(record, req.body)) {
      return res.status(400).json({ success: false, message: 'The phone number or visit details changed. Start verification again.' });
    }
    if (record.lead_id) return res.json(siteVisitReceipt(record.lead_id, record));
    const code = String(req.body.code || '').trim();
    if (!/^[0-9]{4,10}$/.test(code)) return res.status(400).json({ success: false, message: 'Enter the verification code.' });
    if (!validVisitDateTime(record.preferred_date, record.preferred_time)) {
      return res.status(400).json({ success: false, message: 'That inspection time has passed. Choose a future IST date and time and request a new code.' });
    }
    if (!otpAttemptAllowed(req, res, record, session)) return;

    const checked = await twilioVerify('/VerificationCheck', { To: record.phone, Code: code });
    if (checked.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'The code is incorrect or expired. Check it or request a new code.' });
    }

    const now = Date.now();
    const verifiedAt = new Date(now).toISOString();
    let leadId;
    db.db.exec('BEGIN IMMEDIATE');
    try {
      const current = getVerification(verificationId, 'SITE_VISIT', session.hash);
      if (current.lead_id) {
        leadId = current.lead_id;
      } else {
        const marked = db.db.prepare(`
          UPDATE otp_verifications SET verified_at = ?
          WHERE id = ? AND verified_at IS NULL AND expires_at > ?
        `).run(verifiedAt, verificationId, now);
        if (!marked.changes) throw new Error('Verification expired before completion.');
        leadId = db.createEnquiry({
          property_id: current.property_id,
          property_title: db.getPropertyById(current.property_id)?.title || 'Property Site Visit',
          name: current.name,
          phone: current.phone,
          message: `Requested site visit for ${current.preferred_date} at ${current.preferred_time} IST.`,
          preferred_date: current.preferred_date,
          preferred_time: current.preferred_time,
          verified_contact_method: 'sms',
          verified_at: verifiedAt,
          verification_id: verificationId,
          privacy_notice_acknowledged: false
        });
        db.db.prepare('UPDATE otp_verifications SET lead_id = ? WHERE id = ?').run(leadId, verificationId);
        if (current.analytics_consent) {
          db.db.prepare('INSERT INTO analytics_events (event_name, property_id) VALUES (?, ?)')
            .run('enquiry', current.property_id);
        }
        db.logAudit('public', 'site_visit.verified', current.property_id, {
          purpose: 'SITE_VISIT',
          verifiedContactMethod: 'sms'
        });
      }
      db.db.exec('COMMIT');
    } catch (error) {
      db.db.exec('ROLLBACK');
      throw error;
    }
    res.status(201).json(siteVisitReceipt(leadId, record));
  } catch (error) {
    console.error('Could not complete site visit verification.', error.status || 'internal_error');
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not verify the code.' });
  }
});

function brochurePayloadMatches(record, body) {
  const method = body.method;
  const email = body.email ? validEmail(body.email) : '';
  const phone = body.phone ? normalizedPhone(body.phone) : '';
  const target = method === 'sms' ? phone : email;
  return String(body.name || '').trim() === record.name &&
    String(body.property_id || '') === record.property_id &&
    method === record.method &&
    email === record.email &&
    phone === record.phone &&
    target === (record.method === 'sms' ? record.phone : record.email) &&
    body.privacy_consent === true;
}

app.post('/api/brochures/verification/complete', async (req, res) => {
  try {
    const session = getPublicSession(req, res, false);
    const verificationId = String(req.body.verification_id || '');
    const record = session && getVerification(verificationId, 'BROCHURE', session.hash);
    if (!record || !brochurePayloadMatches(record, req.body)) {
      return res.status(400).json({ success: false, message: 'Your contact details changed. Start verification again.' });
    }
    if (record.verified_at) {
      return res.status(400).json({ success: false, message: 'This verification code has already been used.' });
    }
    const code = String(req.body.code || '').trim();
    if (!/^[0-9]{4,10}$/.test(code)) return res.status(400).json({ success: false, message: 'Enter the verification code.' });
    if (!otpAttemptAllowed(req, res, record, session)) return;

    const property = db.getPropertyById(record.property_id);
    if (!property || !property.brochure_url) {
      return res.status(404).json({ success: false, message: 'The property brochure is no longer available.' });
    }
    const target = record.method === 'sms' ? record.phone : record.email;
    const checked = await twilioVerify('/VerificationCheck', { To: target, Code: code });
    if (checked.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'The code is incorrect or expired. Check it or request a new code.' });
    }

    const now = Date.now();
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    db.db.exec('BEGIN IMMEDIATE');
    try {
      const marked = db.db.prepare(`
        UPDATE otp_verifications SET verified_at = ?
        WHERE id = ? AND verified_at IS NULL AND expires_at > ? AND session_hash = ?
      `).run(new Date(now).toISOString(), verificationId, now, session.hash);
      if (!marked.changes) throw new Error('This verification has already been used or expired.');
      db.db.prepare(`
        INSERT INTO brochure_downloads (verification_id, property_id, token_hash, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(verificationId, record.property_id, tokenHash, now + 5 * 60_000, now);
      if (record.analytics_consent) {
        db.db.prepare('INSERT INTO analytics_events (event_name, property_id) VALUES (?, ?)')
          .run('verification_completed', record.property_id);
      }
      db.logAudit('public', 'brochure.verified', record.property_id, {
        purpose: 'BROCHURE',
        verifiedContactMethod: record.method
      });
      db.db.exec('COMMIT');
    } catch (error) {
      db.db.exec('ROLLBACK');
      throw error;
    }
    res.json({
      success: true,
      downloadUrl: `/api/brochures/download/${token}`,
      maskedDestination: maskContact(record.method, target),
      verifiedMethod: record.method,
      expiresInSeconds: 300
    });
  } catch (error) {
    console.error('Could not complete brochure verification.', error.status || 'internal_error');
    res.status(error.status || 500).json({ success: false, message: error.message || 'Could not verify the code.' });
  }
});

app.get('/api/brochures/download/:token', (req, res) => {
  const session = getPublicSession(req, res, false);
  if (!session) return res.status(404).json({ success: false, message: 'This download link is invalid, expired, or already used.' });
  const tokenHash = crypto.createHash('sha256').update(String(req.params.token)).digest('hex');
  const download = db.db.prepare(`
    SELECT brochure_downloads.id, brochure_downloads.property_id, otp_verifications.verified_at, otp_verifications.analytics_consent
    FROM brochure_downloads
    JOIN otp_verifications ON otp_verifications.id = brochure_downloads.verification_id
    WHERE brochure_downloads.token_hash = ? AND brochure_downloads.expires_at > ?
      AND brochure_downloads.downloaded_at IS NULL AND otp_verifications.verified_at IS NOT NULL
      AND otp_verifications.session_hash = ? AND otp_verifications.purpose = 'BROCHURE'
  `).get(tokenHash, Date.now(), session.hash);
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
  res.json({
    analyticsMeasurementId: /^G-[A-Z0-9]+$/.test(measurementId) ? measurementId : '',
    turnstileSiteKey: String(process.env.TURNSTILE_SITE_KEY || '')
  });
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
      const allowedKeys = ['hero_title', 'hero_subtitle', 'contact_phone', 'contact_email', 'whatsapp_number'];
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
    return reply(undefined, { code: -32603, message: 'Tool execution failed.' });
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

// Unknown routes must return a real 404 instead of an indexable homepage copy.
app.use((req, res) => {
  if (req.path === '/mcp') return res.set('Allow', 'POST').sendStatus(405);
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.path.startsWith('/uploads/')) {
    return res.status(404).json({ success: false, message: 'Not found.' });
  }
  notFound(req, res);
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
