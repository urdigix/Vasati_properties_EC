const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const handler = html.slice(html.indexOf('      // Form handler'), html.indexOf("    document.getElementById('backToHomeBtn')"));
// The final brace closes renderPropertyDetail, outside the handler under test.
const source = handler.replace(/\s*}\s*$/, '');

function loadForm(success = true) {
  const listeners = {};
  const form = {
    name: { value: '' }, phone: { value: '' }, preferred_date: { value: '' },
    preferred_time: { value: '', error: '', setCustomValidity(value) { this.error = value; } },
    addEventListener(name, callback) { listeners[name] = callback; },
    checkValidity() { return Boolean(this.name.value && this.phone.value && this.preferred_date.value >= this.preferred_date.min && this.preferred_time.value && !this.preferred_time.error); },
    reset() { for (const key of ['name', 'phone', 'preferred_date', 'preferred_time']) this[key].value = ''; }
  };
  const button = {};
  const calls = [];
  vm.runInNewContext(source, {
    document: { getElementById: id => id === 'scheduleVisitForm' ? form : button },
    p: { id: 'test-home', title: 'Test home' },
    Date: class extends Date { constructor() { super('2026-11-15T04:30:00Z'); } },
    Intl, localStorage: { getItem: () => null }, trackAnalytics() {}, showToast() {},
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { json: async () => ({ success }) }; }
  });
  return { form, button, listeners, calls };
}

test('visit submission requires contact details and a future date and time in IST', async () => {
  const { form, button, listeners, calls } = loadForm();
  assert.equal(button.disabled, true);
  assert.equal(form.preferred_date.min, '2026-11-15');
  form.name.value = 'Visitor'; form.phone.value = '9876543210';
  form.preferred_date.value = '2026-11-16'; listeners.input();
  assert.equal(button.disabled, true, 'date alone cannot enable submission');
  await listeners.submit({ preventDefault() {} });
  assert.equal(calls.length, 0);
  form.preferred_time.value = '11:30'; listeners.change();
  assert.equal(button.disabled, false);
  form.preferred_date.value = '2026-11-15'; form.preferred_time.value = '09:59'; listeners.input();
  assert.equal(button.disabled, true, 'past times today are rejected using IST');
  form.preferred_date.value = '2026-11-16'; form.preferred_time.value = '11:30'; listeners.input();
  await listeners.submit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.message, 'Requested visit date: 2026-11-16; time: 11:30 IST');
  assert.equal(button.disabled, true, 'successful reset requires fresh details');
});

test('failed requests keep the selected appointment and allow retry', async () => {
  const { form, button, listeners } = loadForm(false);
  form.name.value = 'Visitor'; form.phone.value = '9876543210';
  form.preferred_date.value = '2026-11-16'; form.preferred_time.value = '12:00';
  listeners.input();
  await listeners.submit({ preventDefault() {} });
  assert.equal(button.disabled, false);
  assert.equal(form.preferred_time.value, '12:00');
  form.preferred_time.value = ''; listeners.input();
  assert.equal(button.disabled, true, 'clearing the time disables submission again');
});
