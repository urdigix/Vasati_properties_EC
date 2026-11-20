const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{runInNewContext}=require('node:vm');
const {request}=require('../public/admin-save');

test('property save times out even if the network or response body never finishes, then permits another save', async()=>{
  let signal;
  await assert.rejects(request('/api/properties',{method:'POST'},{timeoutMs:20,fetcher:(_url,options)=>{signal=options.signal;return new Promise(()=>{});}}),e=>e.code==='SAVE_TIMEOUT');
  assert.equal(signal.aborted,true);
  await assert.rejects(request('/api/properties',{method:'POST'},{timeoutMs:20,fetcher:async()=>({ok:true,json:()=>new Promise(()=>{})})}),e=>e.code==='SAVE_TIMEOUT');
  const result=await request('/api/properties',{method:'POST'},{fetcher:async()=>Response.json({success:true,data:{id:'saved'}})});
  assert.equal(result.data.id,'saved');
});

test('property save reports rejected, expired, unreadable and offline requests',async()=>{
  for(const [fetcher,pattern] of [
    [async()=>Response.json({success:false,message:'Invalid floor plan'},{status:400}),/Invalid floor plan/],
    [async()=>Response.json({success:false},{status:401}),/session has expired/],
    [async()=>new Response('<html>Proxy error</html>',{status:502}),/unreadable response/],
    [async()=>{throw new Error('Network unavailable')},/Network unavailable/],
    [async()=>Response.json({success:false}),/could not be saved/]
  ]) await assert.rejects(request('/api/properties',{}, {fetcher}),pattern);
});

test('admin save always restores the button and retains entries after validation, payload and network failures',async()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/admin.html'),'utf8');
  const source=html.slice(html.indexOf("    propForm.addEventListener('submit'"),html.indexOf('    // Add manual image URL'));
  for(const failure of ['validation','payload','network','success']){
    const elements=new Map();
    const get=id=>{if(!elements.has(id))elements.set(id,{value:id==='editPropId'?'':'User-entered value',disabled:false,hidden:true,textContent:''});return elements.get(id)};
    let handler,closed=false,requests=0;
    const form={addEventListener:(_name,fn)=>handler=fn,setAttribute:()=>{}};
    const context={
      document:{getElementById:id=>failure==='payload'&&id==='formDescription'?null:get(id),querySelectorAll:()=>[]},
      propForm:form,readProjectOverview:()=>{if(failure==='validation')throw new Error('Invalid overview');return{}},
      FloorPlansAdmin:{get:()=>[]},currentGalleryImages:['/images/logo.png'],currentAmenities:[],
      AdminSave:{request:async()=>{requests++;if(failure==='network')throw new Error('Server timed out');return{success:true}}},
      showToast:()=>{},propModal:{close:()=>{closed=true}},loadProperties:()=>{},loadStats:()=>{}
    };
    runInNewContext(source,context);
    await handler({preventDefault(){}});
    assert.equal(get('savePropertyBtn').disabled,false,failure);
    assert.equal(get('savePropertyBtn').textContent,'Save Property');
    assert.equal(get('formTitle').value,'User-entered value');
    assert.equal(closed,failure==='success');
    assert.equal(get('propertySaveStatus').hidden,failure==='success');
    assert.equal(requests,['network','success'].includes(failure)?1:0);
  }
});
