const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'properties.db');
const db = new DatabaseSync(dbPath);

function parseJsonField(value, fallback = []) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
    return fallback;
  }
}

function formatProperty(property) {
  if (!property) return null;
  const imageList = parseJsonField(property.images, property.image ? [property.image] : []);
  const amenities = parseJsonField(property.amenities, null);
  const proximity = parseJsonField(property.proximity, null);

  return {
    ...property,
    image: property.image || (imageList[0] || ''),
    images: imageList,
    amenities: amenities && amenities.length ? amenities : null,
    proximity: proximity && proximity.length ? proximity : null,
    featured: Number(property.featured) === 1 || property.featured === true
  };
}

const defaultSettings = {
  hero_tag: '✨ Premium Bengaluru Real Estate Portfolio',
  hero_title: 'Find Your Dream Space in the Silicon Valley of India',
  hero_subtitle: "Verified builder developments, luxury gated communities, and prime resale apartments across Bengaluru's top tech corridors.",
  contact_phone: '+91 6303420048',
  whatsapp_number: '916303420048',
  contact_email: 'contact@vasatiproperties.com',
  stat_active_listings: '150+',
  stat_hubs: '15+',
  stat_trust: '100%'
};

const seedProperties = [
  ['a', 'Modern living in Whitefield', 'Whitefield, East Bengaluru', 'Whitefield', 95, '₹95 L', 2, '1,240 sqft', 2, 'New', 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1000&q=78', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'Bright contemporary home with spacious living and dining areas', 'Agent listing · Verified', 'Apartment', 'Ready to move', 'A bright, thoughtfully laid-out premium home in Whitefield close to tech parks, international schools, and metro stations.', 1],
  ['b', 'Room to grow in Sarjapur', 'Sarjapur Road, South Bengaluru', 'Sarjapur Road', 125, '₹1.25 Cr', 3, '1,685 sqft', 3, 'New', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1000&q=78', '', 'Contemporary residence with generous living space and natural light', 'Agent listing · Verified', 'Apartment', 'Under construction', 'A spacious luxury apartment listing on Sarjapur Road with premium amenities and fast Outer Ring Road connectivity.', 1],
  ['c', 'A home with character', 'HSR Layout, South Bengaluru', 'HSR Layout', 220, '₹2.2 Cr', 3, '2,140 sqft', 3, 'Resale', 'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1000&q=78', '', 'Airy modern family home with a garden-side patio', 'Resale · Verified', 'Villa', 'Ready to move', 'A premium resale family home in prime HSR Layout Sector 2.', 1],
  ['d', 'A brighter start in Electronic City', 'Electronic City, South Bengaluru', 'Electronic City', 68, '₹68 L', 2, '1,090 sqft', 2, 'New', 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1000&q=78', '', 'Sunlit apartment interior with a calm neutral palette', 'Agent listing · Verified', 'Apartment', 'Ready to move', 'A welcoming apartment near Electronic City Phase 1. Close to major IT campuses with fast access via the elevated expressway.', 0],
  ['e', 'A cosy home in Thanisandra', 'Thanisandra, North Bengaluru', 'Thanisandra', 52, '₹52 L', 1, '710 sqft', 1, 'Resale', 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1000&q=78', '', 'Warm and compact home with a light-filled living zone', 'Resale · Verified', 'Apartment', 'Ready to move', 'A compact modern resale apartment in Thanisandra Main Road, ideal for young professionals or investors seeking high rental returns near Manyata Tech Park.', 0],
  ['f', 'The Yelahanka family villa', 'Yelahanka, North Bengaluru', 'Yelahanka', 245, '₹2.45 Cr', 4, '3,050 sqft', 4, 'Villa', 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1000&q=78', '', 'Contemporary villa with clean architecture and landscaped greenery', 'Agent listing · Verified', 'Villa', 'Ready to move', 'A grand duplex family villa in scenic Yelahanka with a peaceful, premium community setting.', 1]
];

const seedProjects = [
  ['proj-1', 'Prestige City Serenity', 'Prestige Group', 'PRESTIGE', '₹ 1.2 Cr - 2.8 Cr', '2, 3 & 4 BHK Luxury Apartments', 'Sarjapur Road, Bengaluru', 'Festive Offer: Zero Stamp Duty on Booking this month', 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1000&q=78', '', '#propertiesSection'],
  ['proj-2', 'Sobha Dream Acres', 'Sobha Limited', 'SOBHA', '₹ 75 L - 1.45 Cr', '1 & 2 BHK Pre-crafted Homes', 'Panathur, Outer Ring Road, Bengaluru', 'Ready to Move Options Available · Instant Loan Approval', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1000&q=78', '', '#propertiesSection'],
  ['proj-3', 'Godrej Woodscapes', 'Godrej Properties', 'GODREJ', '₹ 98 L - 2.1 Cr', '2, 3 & 3.5 BHK Forest Theme Residences', 'Budigere Cross, Old Madras Road, Bengaluru', 'Exclusive Launch Benefits with 10:90 Payment Plan', 'https://images.unsplash.com/photo-1613977257363-707ba9348227?auto=format&fit=crop&w=1000&q=78', '', '#propertiesSection']
];

function ensureColumn(tableName, columnName, columnSql) {
  const exists = db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?").all([tableName, columnName]);
  if (!exists.length) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql};`);
  }
}

function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      location TEXT NOT NULL,
      locality TEXT,
      price REAL NOT NULL,
      price_label TEXT,
      bhk INTEGER,
      area TEXT,
      baths INTEGER DEFAULT 2,
      status TEXT DEFAULT 'New',
      image TEXT,
      images TEXT,
      video_url TEXT,
      brochure_url TEXT,
      alt TEXT,
      listed TEXT,
      kind TEXT,
      possession TEXT,
      description TEXT,
      amenities TEXT,
      proximity TEXT,
      admin_note TEXT,
      featured INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS enquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id TEXT,
      property_title TEXT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      message TEXT,
      status TEXT DEFAULT 'New',
      feedback TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS featured_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      builder_name TEXT,
      builder_logo TEXT,
      price_range TEXT,
      bhk_types TEXT,
      location TEXT,
      offer_text TEXT,
      image TEXT,
      video_url TEXT,
      link TEXT
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      content_type TEXT NOT NULL,
      data BLOB NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    db.exec("CREATE INDEX IF NOT EXISTS enquiries_created_at_idx ON enquiries (created_at DESC);");
  } catch {
    // ignore index creation errors
  }

  for (const [key, value] of Object.entries(defaultSettings)) {
    db.prepare('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)').run(key, String(value));
  }

  const propertyCount = db.prepare('SELECT COUNT(*) AS count FROM properties').get().count;
  if (propertyCount === 0) {
    const insertProperty = db.prepare(`
      INSERT INTO properties (
        id, title, location, locality, price, price_label, bhk, area, baths, status,
        image, video_url, alt, listed, kind, possession, description, featured
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const property of seedProperties) {
      insertProperty.run(property[0], property[1], property[2], property[3], property[4], property[5], property[6], property[7], property[8], property[9], property[10], property[11], property[12], property[13], property[14], property[15], property[16], property[17]);
    }
  }

  const projectCount = db.prepare('SELECT COUNT(*) AS count FROM featured_projects').get().count;
  if (projectCount === 0) {
    const insertProject = db.prepare(`
      INSERT INTO featured_projects (
        id, name, builder_name, builder_logo, price_range, bhk_types, location, offer_text, image, video_url, link
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const project of seedProjects) {
      insertProject.run(project[0], project[1], project[2], project[3], project[4], project[5], project[6], project[7], project[8], project[9], project[10]);
    }
  }
}

function getAllProperties(filters = {}) {
  let sql = 'SELECT * FROM properties WHERE 1 = 1';
  const params = [];

  if (filters.locality && filters.locality !== 'all' && filters.locality !== 'Bengaluru' && filters.locality !== 'Bangalore') {
    sql += ' AND (location LIKE ? OR locality LIKE ?)';
    params.push(`%${filters.locality}%`, `%${filters.locality}%`);
  }

  if (filters.bhk && filters.bhk !== 'any') {
    const bhkNum = Number(filters.bhk);
    if (bhkNum >= 4) {
      sql += ' AND bhk >= 4';
    } else {
      sql += ' AND bhk = ?';
      params.push(bhkNum);
    }
  }

  if (filters.status && filters.status !== 'any' && filters.status !== 'All' && filters.status !== 'all') {
    const status = String(filters.status).trim();
    if (status === 'Ready' || status === 'Ready to Move') {
      sql += " AND (status = 'Ready' OR status = 'Ready to Move')";
    } else if (status === 'New' || status === 'New Launch') {
      sql += " AND (status = 'New' OR status = 'New Launch')";
    } else if (status === 'Villa' || status === 'Luxury Villa') {
      sql += " AND (status = 'Villa' OR status = 'Luxury Villa' OR kind = 'Villa' OR title LIKE '%Villa%')";
    } else if (status === 'Resale' || status === 'Resale Ready') {
      sql += " AND (status = 'Resale' OR status = 'Resale Ready')";
    } else {
      sql += ' AND status = ?';
      params.push(status);
    }
  }

  if (filters.kind && filters.kind !== 'Buy' && filters.kind !== 'any') {
    sql += ' AND kind = ?';
    params.push(String(filters.kind));
  }

  if (filters.minPrice) {
    sql += ' AND price >= ?';
    params.push(Number(filters.minPrice));
  }

  if (filters.maxPrice && Number(filters.maxPrice) < 500) {
    sql += ' AND price <= ?';
    params.push(Number(filters.maxPrice));
  }

  if (filters.budget && filters.budget !== 'any') {
    sql += ' AND price <= ?';
    params.push(Number(filters.budget));
  }

  if (filters.search) {
    sql += ' AND (title LIKE ? OR location LIKE ? OR description LIKE ?)';
    const searchTerm = `%${String(filters.search)}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  if (filters.sort === 'price') {
    sql += ' ORDER BY price ASC';
  } else if (filters.sort === 'price-desc') {
    sql += ' ORDER BY price DESC';
  } else {
    sql += ' ORDER BY featured DESC, created_at DESC';
  }

  const rows = db.prepare(sql).all(...params);
  return rows.map(formatProperty);
}

function getPropertyById(id) {
  const row = db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
  return formatProperty(row);
}

function createProperty(prop) {
  const id = prop.id || `prop_${Date.now().toString(36)}_${crypto.randomUUID()}`;
  const price = Number(prop.price ?? 0);
  const title = String(prop.title || 'Untitled Property');
  const location = String(prop.location || '');
  const locality = String(prop.locality || location.split(',')[0]?.trim() || 'Bengaluru');
  const image = String(prop.image || '');
  const images = Array.isArray(prop.images)
    ? prop.images.filter(Boolean)
    : typeof prop.images === 'string'
      ? (() => { try { const parsed = JSON.parse(prop.images); return Array.isArray(parsed) ? parsed.filter(Boolean) : [prop.images].filter(Boolean); } catch { return [prop.images].filter(Boolean); } })()
      : [];
  const discountImage = images.length ? images[0] : image;
  const query = `
    INSERT INTO properties (
      id, title, location, locality, price, price_label, bhk, area, baths, status,
      image, images, video_url, brochure_url, alt, listed, kind, possession, description, amenities, proximity, featured
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  db.prepare(query).run(
    id,
    title,
    location,
    locality,
    price,
    String(prop.priceLabel || (price >= 100 ? `₹${(price / 100).toFixed(2)} Cr` : `₹${price} L`)),
    Number(prop.bhk || 2),
    String(prop.area || '0 sqft'),
    Number(prop.baths || 2),
    String(prop.status || 'New'),
    discountImage,
    JSON.stringify(images.length ? images : [discountImage].filter(Boolean)),
    String(prop.video_url || ''),
    String(prop.brochure_url || ''),
    String(prop.alt || title),
    String(prop.listed || 'Agent listing · Verified'),
    String(prop.kind || 'Apartment'),
    String(prop.possession || 'Ready to move'),
    String(prop.description || ''),
    prop.amenities ? JSON.stringify(Array.isArray(prop.amenities) ? prop.amenities : String(prop.amenities).split(',')) : null,
    prop.proximity ? JSON.stringify(prop.proximity) : null,
    Number(Boolean(prop.featured))
  );
  return id;
}

function updateProperty(id, prop) {
  const current = getPropertyById(id);
  if (!current) return false;

  const next = {
    ...current,
    ...prop,
    price: Number(prop.price ?? current.price ?? 0),
    bhk: Number(prop.bhk ?? current.bhk ?? 2),
    baths: Number(prop.baths ?? current.baths ?? 2),
    featured: prop.featured !== undefined ? Number(Boolean(prop.featured)) : Number(Boolean(current.featured))
  };

  const imageList = Array.isArray(prop.images)
    ? prop.images.filter(Boolean)
    : typeof prop.images === 'string'
      ? (() => { try { const parsed = JSON.parse(prop.images); return Array.isArray(parsed) ? parsed.filter(Boolean) : [prop.images].filter(Boolean); } catch { return [prop.images].filter(Boolean); } })()
      : parseJsonField(current.images, current.image ? [current.image] : []);

  const image = String(prop.image || next.image || (imageList[0] || ''));
  const query = `
    UPDATE properties SET
      title = ?,
      location = ?,
      locality = ?,
      price = ?,
      price_label = ?,
      bhk = ?,
      area = ?,
      baths = ?,
      status = ?,
      image = ?,
      images = ?,
      video_url = ?,
      brochure_url = ?,
      alt = ?,
      listed = ?,
      kind = ?,
      possession = ?,
      description = ?,
      amenities = ?,
      proximity = ?,
      featured = ?
    WHERE id = ?
  `;
  db.prepare(query).run(
    String(next.title || current.title),
    String(next.location || current.location),
    String(next.locality || current.locality || (next.location || current.location).split(',')[0]?.trim() || 'Bengaluru'),
    Number(next.price),
    String(next.priceLabel || current.price_label || (Number(next.price) >= 100 ? `₹${(Number(next.price) / 100).toFixed(2)} Cr` : `₹${Number(next.price)} L`)),
    Number(next.bhk),
    String(next.area || current.area || '0 sqft'),
    Number(next.baths),
    String(next.status || current.status || 'New'),
    image,
    JSON.stringify(imageList.length ? imageList : [image].filter(Boolean)),
    String(next.video_url ?? current.video_url ?? ''),
    String(next.brochure_url ?? current.brochure_url ?? ''),
    String(next.alt || current.alt || next.title || current.title),
    String(next.listed || current.listed || 'Agent listing · Verified'),
    String(next.kind || current.kind || 'Apartment'),
    String(next.possession || current.possession || 'Ready to move'),
    String(next.description || current.description || ''),
    next.amenities ? JSON.stringify(Array.isArray(next.amenities) ? next.amenities : String(next.amenities).split(',')) : (current.amenities ? current.amenities : null),
    next.proximity ? JSON.stringify(next.proximity) : (current.proximity ? current.proximity : null),
    Number(next.featured),
    id
  );
  return true;
}

function deleteProperty(id) {
  db.prepare('DELETE FROM properties WHERE id = ?').run(id);
  return true;
}

function getFeaturedProjects() {
  return db.prepare('SELECT * FROM featured_projects ORDER BY id').all();
}

function createFeaturedProject(project) {
  const id = String(project.id || `proj_${Date.now().toString(36)}`);
  db.prepare(`
    INSERT INTO featured_projects (id, name, builder_name, builder_logo, price_range, bhk_types, location, offer_text, image, video_url, link)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(project.name || ''),
    String(project.builder_name || ''),
    String(project.builder_logo || ''),
    String(project.price_range || ''),
    String(project.bhk_types || ''),
    String(project.location || ''),
    String(project.offer_text || ''),
    String(project.image || ''),
    String(project.video_url || ''),
    String(project.link || '#propertiesSection')
  );
  return id;
}

function updateFeaturedProject(id, project) {
  db.prepare(`
    UPDATE featured_projects
    SET name = ?, builder_name = ?, builder_logo = ?, price_range = ?, bhk_types = ?, location = ?, offer_text = ?, image = ?, video_url = ?, link = ?
    WHERE id = ?
  `).run(
    String(project.name || ''),
    String(project.builder_name || ''),
    String(project.builder_logo || ''),
    String(project.price_range || ''),
    String(project.bhk_types || ''),
    String(project.location || ''),
    String(project.offer_text || ''),
    String(project.image || ''),
    String(project.video_url || ''),
    String(project.link || '#propertiesSection'),
    id
  );
  return true;
}

function deleteFeaturedProject(id) {
  db.prepare('DELETE FROM featured_projects WHERE id = ?').run(id);
  return true;
}

function getSiteSettings() {
  const rows = db.prepare('SELECT key, value FROM site_settings ORDER BY key').all();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

function updateSiteSettings(settingsObj = {}) {
  for (const [key, value] of Object.entries(settingsObj)) {
    db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  }
  return true;
}

function getAllEnquiries(statusFilter = null) {
  let query = 'SELECT * FROM enquiries';
  const params = [];
  if (statusFilter) {
    query += ' WHERE status = ?';
    params.push(String(statusFilter));
  }
  query += ' ORDER BY created_at DESC';
  return db.prepare(query).all(...params);
}

function createEnquiry(enquiry) {
  const stmt = db.prepare(`
    INSERT INTO enquiries (property_id, property_title, name, phone, email, message, status)
    VALUES (?, ?, ?, ?, ?, ?, 'New')
  `);
  const result = stmt.run(
    enquiry.property_id || null,
    enquiry.property_title || 'General Enquiry',
    enquiry.name || 'Customer',
    enquiry.phone || '',
    enquiry.email || '',
    enquiry.message || ''
  );
  return result.lastInsertRowid;
}

function updateEnquiryStatus(id, status) {
  if (status === undefined || status === null || status === '') return true;
  db.prepare('UPDATE enquiries SET status = ? WHERE id = ?').run(String(status), Number(id));
  return true;
}

function updateEnquiryFeedback(id, feedback) {
  if (feedback === undefined || feedback === null) return true;
  db.prepare('UPDATE enquiries SET feedback = ? WHERE id = ?').run(String(feedback), Number(id));
  return true;
}

function deleteEnquiry(id) {
  db.prepare('DELETE FROM enquiries WHERE id = ?').run(Number(id));
  return true;
}

function getStats() {
  const totalProperties = db.prepare('SELECT COUNT(*) AS count FROM properties').get().count;
  const newHomes = db.prepare("SELECT COUNT(*) AS count FROM properties WHERE status = 'New' OR status = 'New Launch'").get().count;
  const readyHomes = db.prepare("SELECT COUNT(*) AS count FROM properties WHERE status = 'Ready' OR status = 'Ready to Move'").get().count;
  const resaleHomes = db.prepare("SELECT COUNT(*) AS count FROM properties WHERE status = 'Resale' OR status = 'Resale Ready'").get().count;
  const villas = db.prepare("SELECT COUNT(*) AS count FROM properties WHERE status = 'Villa' OR status = 'Luxury Villa' OR kind = 'Villa'").get().count;
  const totalSlides = db.prepare('SELECT COUNT(*) AS count FROM featured_projects').get().count;
  const totalEnquiries = db.prepare('SELECT COUNT(*) AS count FROM enquiries').get().count;
  const newEnquiries = db.prepare("SELECT COUNT(*) AS count FROM enquiries WHERE status = 'New'").get().count;

  return {
    totalProperties,
    newHomes,
    readyHomes,
    resaleHomes,
    villas,
    totalSlides,
    totalEnquiries,
    newEnquiries
  };
}

function createMediaAsset({ filename, contentType, data }) {
  const id = crypto.randomUUID();
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data || '', 'base64');
  db.prepare(`
    INSERT INTO media_assets (id, filename, content_type, data, size_bytes)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, String(filename || 'upload'), String(contentType || 'application/octet-stream'), buffer, buffer.length);
  return id;
}

function getMediaAsset(id) {
  return db.prepare('SELECT * FROM media_assets WHERE id = ?').get(id);
}

module.exports = {
  db,
  initializeDatabase,
  getAllProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
  getFeaturedProjects,
  createFeaturedProject,
  updateFeaturedProject,
  deleteFeaturedProject,
  getSiteSettings,
  updateSiteSettings,
  getAllEnquiries,
  createEnquiry,
  updateEnquiryStatus,
  updateEnquiryFeedback,
  deleteEnquiry,
  getStats,
  createMediaAsset,
  getMediaAsset
};
