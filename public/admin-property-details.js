window.PropertyDetailsEditor = (() => {
  const fields = [['builder_name','Developer / builder'],['rera_id','RERA registration ID'],['project_units','Number of project units'],['project_area','Project area (include unit)'],['launch_date','Launch date'],['map_address','Map search address (leave empty to use property location)']];
  const section = document.createElement('div');
  section.className = 'form-group form-full';
  section.innerHTML = `<h3 style="margin:18px 0 12px">Project details & floor plans</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">${fields.map(([key,label]) => `<div class="form-group"><label for="pd-edit-${key}">${label}</label><input id="pd-edit-${key}" maxlength="500"></div>`).join('')}<div class="form-group"><label for="pd-edit-possession">Possession date / status</label><input id="pd-edit-possession" maxlength="200" placeholder="e.g. December 2027 or Ready to move"></div><div class="form-group"><label for="pd-edit-kind">Property type</label><input id="pd-edit-kind" maxlength="100" placeholder="Apartment, Villa…"></div></div><p style="font-size:12px;color:var(--muted);margin:12px 0">Add up to 12 configurations. Upload the actual floor plan or add its image URL. Leave unconfirmed details empty.</p><div id="pd-edit-plans"></div><button type="button" class="btn btn-outline btn-sm" id="pd-add-plan">+ Add floor plan</button><p id="pd-editor-status" role="status" style="font-size:12px;color:#38bdf8"></p>`;
  document.getElementById('formDescription').closest('.form-group').before(section);
  const list = section.querySelector('#pd-edit-plans'), status = section.querySelector('#pd-editor-status');
  let uploading = 0;
  function add(plan = {}) {
    if (list.children.length >= 12) { status.textContent = 'You can add up to 12 floor plans.'; return; }
    const row = document.createElement('fieldset');
    row.style.cssText = 'border:1px solid var(--card-border);border-radius:10px;padding:12px;margin:0 0 12px;min-width:0';
    row.innerHTML = `<legend>Floor plan</legend><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px"><label>Configuration *<input data-field="label" required maxlength="200" placeholder="e.g. 3 BHK East facing"></label><label>Area (include unit)<input data-field="area" maxlength="200" placeholder="e.g. 1800 sq.ft"></label><label>Price label<input data-field="price" maxlength="200" placeholder="e.g. ₹1.25 Cr"></label><label>Floor plan image URL<input data-field="image" maxlength="2048" placeholder="https://… or /api/media/…"></label><label>Upload floor plan<input type="file" accept="image/png,image/jpeg,image/webp"></label></div><button type="button" class="btn btn-outline btn-sm" data-remove style="margin-top:10px">Remove floor plan</button>`;
    for (const input of row.querySelectorAll('[data-field]')) input.value = plan[input.dataset.field] || '';
    row.querySelector('[data-remove]').addEventListener('click', () => row.remove());
    row.querySelector('[type="file"]').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      uploading++; status.textContent = 'Uploading floor plan…';
      try {
        if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
        if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image no larger than 8 MB.');
        const fileData = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        const response = await fetch('/api/upload-image', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({filename:file.name,fileData}) });
        const result = await response.json();
        if (!response.ok || !result.success || !result.url) throw new Error(result.message || 'Upload failed.');
        row.querySelector('[data-field="image"]').value = result.url;
        status.textContent = 'Floor plan uploaded. Save the property to keep this change.';
      } catch (error) { status.textContent = error.message || 'Could not upload floor plan.'; }
      finally { uploading--; event.target.value = ''; }
    });
    list.append(row);
  }
  section.querySelector('#pd-add-plan').addEventListener('click', () => add());
  function load(p = {}) {
    for (const [key] of fields) section.querySelector(`#pd-edit-${key}`).value = p.project_details?.[key] || '';
    section.querySelector('#pd-edit-possession').value = p.possession || '';
    section.querySelector('#pd-edit-kind').value = p.kind || 'Apartment';
    list.replaceChildren(); status.textContent = '';
    for (const plan of p.floor_plans || []) add(plan);
  }
  function collect() {
    if (uploading) throw new Error('Wait for floor plan uploads to finish before saving.');
    return { project_details: Object.fromEntries(fields.map(([key]) => [key, section.querySelector(`#pd-edit-${key}`).value.trim()])), possession: section.querySelector('#pd-edit-possession').value.trim(), kind: section.querySelector('#pd-edit-kind').value.trim(), floor_plans: [...list.children].map(row => Object.fromEntries([...row.querySelectorAll('[data-field]')].map(input => [input.dataset.field,input.value.trim()]))) };
  }
  return { load, collect };
})();
