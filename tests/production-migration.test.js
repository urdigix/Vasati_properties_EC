const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const modulePath = path.resolve(__dirname, '../db/database.js');
function run(dir, code, extra = {}) {
  const result = spawnSync(process.execPath, ['-e', `const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path'); const database=require(${JSON.stringify(modulePath)}); ${code}`], { env: { ...process.env, DATA_DIR: dir, BACKUP_BEFORE_MIGRATION: 'true', ...extra }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vasati-migration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, `database.initializeDatabase(); database.db.prepare("DELETE FROM schema_migrations WHERE name = 'practice-overview-2d-v1'").run(); database.db.exec('ALTER TABLE properties DROP COLUMN project_overview; ALTER TABLE properties ADD COLUMN project_details TEXT;'); database.db.close();`);
  return dir;
}
test('existing database is backed up before migration and legacy details/plans survive reads and edits', t => {
  const dir = fixture(t);
  run(dir, `
    database.db.prepare('UPDATE properties SET project_details = ?, floor_plans = ? WHERE id = ?').run(JSON.stringify({project_units:'15',project_area:'1 Building - 15 units',launch_date:'2025-09-01',rera_id:'RERA-15',builder_name:'Preserved Builder'}), JSON.stringify([{label:'2 BHK',area:'1332 sqft',price:'1.5 Cr',image:'/images/plan.png'},{label:'3 BHK'}]), 'a');
    database.initializeDatabase();
    const p=database.getPropertyById('a',true);
    assert.equal(p.project_overview.project_units,'15'); assert.equal(p.project_overview.project_size,'1 Building - 15 units'); assert.equal(p.project_overview.launch_date,'2025-09'); assert.equal(p.project_overview.rera_id,'RERA-15');
    assert.equal(JSON.parse(p.project_details).builder_name,'Preserved Builder');
    assert.equal(p.floor_plans.length,2); assert.equal(p.floor_plans[0].image_url,'/images/plan.png'); assert.equal(p.floor_plans[1].configuration,'3 BHK'); assert.equal(p.floor_plans[1].image_url,'');
    database.updateProperty('a',{title:'Updated title'}); assert.deepEqual(database.getPropertyById('a',true).floor_plans,p.floor_plans);
    const files=fs.readdirSync(process.env.DATA_DIR).filter(name=>name.startsWith('properties-before-practice-')); assert.equal(files.length,1);
    const {DatabaseSync}=require('node:sqlite'); const backup=new DatabaseSync(path.join(process.env.DATA_DIR,files[0]),{readOnly:true});
    assert.equal(backup.prepare("SELECT count(*) AS n FROM pragma_table_info('properties') WHERE name='project_overview'").get().n,0);
    assert.equal(backup.prepare('SELECT title FROM properties WHERE id=?').get('a').title,'Modern living in Whitefield'); backup.close();
    database.initializeDatabase(); assert.equal(fs.readdirSync(process.env.DATA_DIR).filter(name=>name.startsWith('properties-before-practice-')).length,1);
    database.db.close();
  `);
});
test('existing intentionally empty production tables are never reseeded', t => {
  const dir = fixture(t);
  run(dir, `database.db.exec('DELETE FROM properties; DELETE FROM featured_projects;'); database.initializeDatabase(); assert.equal(database.getAllProperties({},true).length,0); assert.equal(database.getFeaturedProjects().length,0); database.db.close();`);
});
test('backup failure aborts before adding columns or migration markers', t => {
  const dir = fixture(t);
  run(dir, `const original=database.db.exec.bind(database.db); database.db.exec=(sql)=>{if(sql.startsWith('VACUUM INTO'))throw new Error('backup unavailable'); return original(sql);}; assert.throws(()=>database.initializeDatabase(),/backup unavailable/); assert.equal(database.db.prepare("SELECT count(*) AS n FROM pragma_table_info('properties') WHERE name='project_overview'").get().n,0); assert.equal(database.db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE name=?').get('practice-overview-2d-v1').n,0); database.db.close();`);
});
test('legacy partial plans render honestly without invented images and remain valid after serialization', () => {
  const plans=require('../public/floor-plans');
  const records=plans.read(JSON.stringify([{label:'3 BHK'},{label:'3 BHK'}]));
  assert.equal(records.length,2); assert.deepEqual(plans.read(JSON.stringify(records)),records);
  const html=plans.render({title:'Existing property',floor_plans:records});
  assert.ok(html.includes('A 2D plan image has not been provided')); assert.ok(!html.includes('<img src=""'));
});


test('requested production contacts migrate once while other settings and later admin edits survive', t => {
  const dir = fixture(t);
  run(dir, `
    database.updateSiteSettings({contact_email:'old@example.test',social_instagram:'https://example.test/old',social_facebook:'https://example.test/old',whatsapp_number:'910000000000',hero_title:'Keep owner title'});
    database.initializeDatabase();
    const settings=database.getSiteSettings();
    assert.equal(settings.contact_email,'sales@vasatiproperties.com');
    assert.equal(settings.social_instagram,'https://www.instagram.com/vasati_properties?fqnt=Ym1ob3l0M2tmZnR5');
    assert.equal(settings.social_facebook,'https://www.facebook.com/share/1FG68jV1mz/');
    assert.equal(settings.whatsapp_number,'916303420048'); assert.equal(settings.hero_title,'Keep owner title');
    database.updateSiteSettings({contact_email:'updated@example.test',social_instagram:'https://instagram.com/new',social_facebook:'https://facebook.com/new',whatsapp_number:'919999999999'});
    database.db.close();
  `);
  run(dir, `database.initializeDatabase(); const settings=database.getSiteSettings(); assert.equal(settings.contact_email,'updated@example.test'); assert.equal(settings.social_instagram,'https://instagram.com/new'); assert.equal(settings.social_facebook,'https://facebook.com/new'); assert.equal(settings.whatsapp_number,'919999999999'); assert.equal(settings.hero_title,'Keep owner title'); database.db.close();`);
});
test('contact migration requires the explicit production backup flag', t => {
  const dir = fixture(t);
  run(dir, `database.updateSiteSettings({contact_email:'keep@example.test'}); database.initializeDatabase(); assert.equal(database.getSiteSettings().contact_email,'keep@example.test'); database.db.close();`, {BACKUP_BEFORE_MIGRATION:'false'});
});
test('legacy 500-character text fields and valid neighboring plans are retained through serialization', () => {
  const plans=require('../public/floor-plans');
  const legacy=[{label:'L'.repeat(500),area:'A'.repeat(500),price:'P'.repeat(500),image:'/floor-plans/old.png'},{label:'2 BHK'}];
  const records=plans.read(JSON.stringify(legacy));
  assert.equal(records.length,2); assert.equal(records[0].configuration,legacy[0].label); assert.equal(records[0].area,legacy[0].area); assert.equal(records[0].price,legacy[0].price); assert.equal(records[0].image_url,legacy[0].image);
  assert.deepEqual(plans.read(JSON.stringify(records)),records); assert.ok(plans.render({title:'Existing property',floor_plans:records}).includes('/floor-plans/old.png'));
});
