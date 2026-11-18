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
  const listeners = {}, elements = new Map(), calls = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', hidden: true, textContent: '',
      checkValidity() { return true; }, focus() {},
      addEventListener(event, callback) { listeners[id + ':' + event] = callback; }
    });
    return elements.get(id);
  };
  const fields = Object.fromEntries(['name','phone','country_code','preferred_date','preferred_time'].map(id => [id, element(id)]));
  fields.country_code.value = '+91';
  const form = { ...fields, querySelector: selector => fields[/name="([^"]+)"/.exec(selector)[1]],
    querySelectorAll: () => Object.values(fields), reportValidity() {},
    addEventListener(event, callback) { listeners[event] = callback; }
  };
  const context = {
    document: { getElementById: id => id === 'scheduleVisitForm' ? form : element(id) },
    p: { id: 'test-home', title: 'Test home' }, activeSiteVisitVerificationId: '',
    turnstileSiteKey: 'test-key', siteVisitCaptchaToken: 'test-token',
    renderTurnstileWidget() {}, resetTurnstileWidget() {}, startOtpCountdown() {}, cancelVerification() {},
    otpTimers: { visit: {} }, clearInterval() {},
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-15T04:30:00Z'])); } },
    Intl, localStorage: { getItem: () => null }, trackAnalytics() {}, showToast() {},
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: success, json: async () => success ? { verificationId: 'visit-1', maskedDestination: '******3210', expiresInSeconds: 300, resendAfterSeconds: 60 } : { message: 'Try again' } };
    }
  };
  vm.runInNewContext(source, context);
  listeners.input = () => listeners['preferred_time:input']();
  listeners.change = () => listeners['preferred_time:change']();
  return { form, button: element('submitLeadBtn'), listeners, calls, context, elements };
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
  assert.equal(calls[0].url, '/api/site-visits/verification/start');
  assert.equal(calls[0].body.preferred_date, '2026-11-16');
  assert.equal(calls[0].body.preferred_time, '11:30');
  assert.equal(calls[0].body.phone, '+919876543210');
  assert.equal(button.disabled, true, 'pending verification prevents duplicate sends');
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

test('changing appointment details cancels the old verification and requires a new code', async () => {
  const { form, listeners, calls, context, elements } = loadForm();
  form.name.value = 'Visitor'; form.phone.value = '9876543210';
  form.preferred_date.value = '2026-11-16'; form.preferred_time.value = '12:00';
  listeners.input(); await listeners.submit({ preventDefault() {} });
  assert.equal(context.activeSiteVisitVerificationId, 'visit-1');
  form.preferred_time.value = '13:00'; listeners.change();
  assert.equal(context.activeSiteVisitVerificationId, '');
  assert.equal(calls[1].url, '/api/verification/cancel');
  assert.equal(calls[1].body.verification_id, 'visit-1');
  assert.equal(elements.get('siteVisitOtpStep').hidden, true);
});
