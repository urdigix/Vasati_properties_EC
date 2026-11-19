(function () {
  let sequence = 0, pendingUploads = 0;
  const list = document.getElementById('floorPlansEditorList');
  const status = document.getElementById('floorPlansEditorStatus');
  const message = text => { status.textContent = text; };
  function inputField(labelText, key, value, maxLength = 160) {
    const group = document.createElement('div'); group.className = 'form-group';
    const label = document.createElement('label');
    const input = document.createElement('input'); input.type = 'text'; input.maxLength = maxLength;
    input.id = `floor-plan-field-${++sequence}`; input.dataset.fpField = key; input.value = value || '';
    label.htmlFor = input.id; label.textContent = labelText; group.append(label, input);
    return { group, input };
  }
  function button(text, handler) {
    const element = document.createElement('button'); element.type = 'button'; element.className = 'btn btn-outline';
    element.textContent = text; element.addEventListener('click', handler); return element;
  }
  function addRoom(container, room = {}) {
    if (container.children.length >= 30) return message('Add up to 30 rooms per plan.');
    const row = document.createElement('div'); row.className = 'fp-admin-room';
    const name = inputField('Room name', 'name', room.name, 80);
    const dimensions = inputField('Dimensions', 'dimensions', room.dimensions, 80);
    dimensions.input.placeholder = 'e.g. 14′ 11″ × 11′ 0″';
    row.append(name.group, dimensions.group, button('Remove room', () => { row.remove(); message('Room removed. Save the property to publish.'); container.parentElement.querySelector('[data-add-room]').focus(); }));
    container.append(row);
  }
  function addPlan(plan = {}, focus = false) {
    if (list.children.length >= 30) return message('Add up to 30 floor-plan options.');
    const card = document.createElement('fieldset'); card.className = 'fp-admin-plan';
    const legend = document.createElement('legend'); legend.textContent = '2D floor-plan option';
    const grid = document.createElement('div'); grid.className = 'form-grid';
    const config = inputField('Configuration', 'configuration', plan.configuration, 80); config.input.placeholder = 'e.g. 2 BHK Apartment';
    const area = inputField('Area (include unit)', 'area', plan.area, 80); area.input.placeholder = 'e.g. 1332 sq.ft.';
    const price = inputField('Price / price label', 'price', plan.price); price.input.placeholder = 'e.g. ₹1.5 Cr';
    const image = inputField('2D plan image URL', 'image_url', plan.image_url, 2048); image.input.placeholder = 'Upload below or enter an image URL';
    grid.append(config.group, area.group, price.group, image.group);
    const uploadGroup = document.createElement('div'); uploadGroup.className = 'form-group';
    const uploadLabel = document.createElement('label'); uploadLabel.textContent = 'Upload a 2D plan (JPEG, PNG or WebP; up to 8 MB)';
    const upload = document.createElement('input'); upload.type = 'file'; upload.accept = 'image/jpeg,image/png,image/webp'; upload.id = `floor-plan-upload-${++sequence}`; uploadLabel.htmlFor = upload.id;
    const uploadStatus = document.createElement('p'); uploadStatus.className = 'fp-admin-help'; uploadStatus.setAttribute('role', 'status');
    const preview = document.createElement('img'); preview.className = 'fp-admin-preview'; preview.alt = '2D floor-plan upload preview'; preview.hidden = true;
    function updatePreview() {
      const value = image.input.value.trim();
      if (/^https?:\/\//i.test(value) || /^\/(uploads\/properties|api\/media|images)\//.test(value)) { preview.src = value; preview.hidden = false; }
      else { preview.removeAttribute('src'); preview.hidden = true; }
    }
    preview.addEventListener('error', () => { preview.hidden = true; uploadStatus.textContent = 'Unable to preview this image. Check its URL or upload a new file.'; });
    image.input.addEventListener('change', updatePreview);
    upload.addEventListener('change', async () => {
      const file = upload.files[0]; if (!file) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) { uploadStatus.textContent = 'Choose a JPEG, PNG or WebP no larger than 8 MB.'; upload.value = ''; return; }
      pendingUploads++; upload.disabled = true; image.input.disabled = true; remove.disabled = true;
      uploadStatus.textContent = 'Uploading 2D plan…';
      try {
        const fileData = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read this file.')); reader.readAsDataURL(file); });
        const response = await fetch('/api/upload-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, fileData, purpose: 'floor-plan' }) });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || 'Upload failed.');
        if (card.isConnected) { image.input.value = result.url; updatePreview(); uploadStatus.textContent = '2D plan uploaded. Save the property to publish it.'; }
      } catch (error) { uploadStatus.textContent = error.message || 'Upload failed. Try again.'; }
      finally { pendingUploads--; upload.disabled = false; image.input.disabled = false; remove.disabled = false; upload.value = ''; }
    });
    uploadGroup.append(uploadLabel, upload, uploadStatus, preview);
    const roomsHeading = document.createElement('h4'); roomsHeading.textContent = 'Room dimensions (optional)';
    const rooms = document.createElement('div'); rooms.className = 'fp-admin-rooms';
    (plan.rooms || []).forEach(room => addRoom(rooms, room));
    const addRoomButton = button('Add room', () => { addRoom(rooms); rooms.lastElementChild?.querySelector('input').focus(); }); addRoomButton.dataset.addRoom = '';
    const remove = button('Remove floor plan', () => { card.remove(); message('Plan removed. Save the property to publish.'); document.getElementById('addFloorPlanBtn').focus(); });
    const actions = document.createElement('div'); actions.className = 'fp-admin-actions'; actions.append(addRoomButton, remove);
    card.append(legend, grid, uploadGroup, roomsHeading, rooms, actions); list.append(card); updatePreview();
    if (focus) config.input.focus();
    message(`${list.children.length} plan option(s). Save the property to publish changes.`);
  }
  document.getElementById('addFloorPlanBtn').addEventListener('click', () => addPlan({}, true));
  window.FloorPlansAdmin = {
    set(value) { list.replaceChildren(); FloorPlans.read(value).forEach(plan => addPlan(plan)); message(list.children.length ? 'Edit the plans, then save the property.' : 'No 2D plans yet. Add a plan option to get started.'); },
    get() {
      if (pendingUploads) throw new Error('Wait for the 2D plan uploads to finish before saving.');
      return FloorPlans.normalize([...list.children].map(card => {
        const result = {};
        card.querySelectorAll('.form-grid input[data-fp-field]').forEach(input => { result[input.dataset.fpField] = input.value; });
        result.rooms = [...card.querySelector('.fp-admin-rooms').children].map(row => Object.fromEntries([...row.querySelectorAll('input')].map(input => [input.dataset.fpField, input.value])));
        return result;
      }));
    }
  };
})();
