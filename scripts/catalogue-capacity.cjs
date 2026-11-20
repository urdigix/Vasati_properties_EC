// Isolated local catalogue capacity check; never writes to the project's database.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vasati-capacity-'));
process.env.DATA_DIR=dir;
const db=require('../db/database');db.initializeDatabase();
const plans=[{configuration:'2 BHK',area_sqft:990,rate_per_sqft:4500,image_url:'/images/logo.png'},{configuration:'3 BHK',area_sqft:1280,area_max_sqft:1320,rate_per_sqft:4500,image_url:'/images/logo.png'}];
const id=db.createProperty({title:'Capacity pricing example',location:'Electronic City',price:1,bhk:2,area:'990 sqft',published:true,floor_plans:plans});
db.db.exec('BEGIN');
const insert=db.db.prepare(`INSERT INTO properties (id,title,location,locality,price,price_label,bhk,area,image,images,published,featured,description,floor_plans,created_at) VALUES (?,?,?,? ,?,'₹44.55 L',2,'990 sq.ft.','/images/logo.png','["/images/logo.png"]',1,0,?,?,?)`);
for(let i=1;i<=10000;i++) insert.run('capacity-'+String(i).padStart(5,'0'),'Capacity home '+i,i===9999?'Rare Search Location':'Electronic City','Electronic City',i/100+40,'Synthetic local capacity listing. '.repeat(30),JSON.stringify(plans),'2026-01-01');
db.db.exec('COMMIT');db.db.close();
const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,env:{...process.env,PORT:'0',NODE_ENV:'development',UPLOADS_DIR:path.join(dir,'uploads'),ADMIN_DEFAULT_EMAIL:'capacity@example.test',ADMIN_DEFAULT_PASSWORD:'Local-Capacity-Fixture-2026!'},stdio:['ignore','pipe','pipe']});
let started=false;
child.stderr.on('data',chunk=>process.stderr.write(chunk));
child.stdout.on('data',async chunk=>{
  const m=chunk.toString().match(/http:\/\/localhost:(\d+)/);if(!m||started)return;started=true;
  const base='http://localhost:'+m[1];
  const info={dir,base,pid:child.pid,property:id,url:base+'/properties/'+id+'/capacity-pricing-example'};
  fs.mkdirSync(path.join(root,'.gstack/pricing-capacity'),{recursive:true});
  fs.writeFileSync(path.join(root,'.gstack/pricing-capacity/fixture.json'),JSON.stringify(info,null,2));
  console.log(JSON.stringify(info));
  try {
    const first=await(await fetch(base+'/api/properties')).json();
    if(first.total<10000||first.data.length!==24)throw new Error('Catalogue pagination failed');
    const timings=[],sizes=[];let cursor=0,errors=0;
    const start=performance.now();
    await Promise.all(Array.from({length:25},async()=>{while(cursor<1000){const i=cursor++,t=performance.now();const r=await fetch(base+'/api/properties?page='+((i%417)+1)+'&pageSize=24&sort='+(i%2?'price':'price-desc'));const text=await r.text();timings.push(performance.now()-t);sizes.push(Buffer.byteLength(text));if(!r.ok||JSON.parse(text).data.length>24)errors++;}}));
    const rare=await(await fetch(base+'/api/properties?search=Rare%20Search%20Location')).json();if(rare.total!==1)throw new Error('Full catalogue search failed');
    timings.sort((a,b)=>a-b);
    const result={timestamp:new Date().toISOString(),properties:first.total,requests:1000,concurrency:25,seconds:+((performance.now()-start)/1000).toFixed(2),p50Ms:+timings[499].toFixed(2),p95Ms:+timings[949].toFixed(2),p99Ms:+timings[989].toFixed(2),maxResponseBytes:Math.max(...sizes),errors,rareSearchMatches:rare.total};
    fs.writeFileSync(path.join(root,'.gstack/pricing-capacity/capacity-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
    if(errors||result.p95Ms>1000)process.exitCode=1;
  } catch(error){console.error(error.message);process.exitCode=1;}
  finally {if(!process.argv.includes('--serve'))child.kill();}
});
child.on('exit',()=>process.exit(process.exitCode||0));
