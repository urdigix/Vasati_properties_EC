const originalFetch = global.fetch;
const codes = new Map();
const sendsByTarget = new Map();

global.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
    const request = new URLSearchParams(options.body);
    const token = request.get('response');
    const action = token === 'test-brochure-token' ? 'brochure' : 'site_visit';
    return new Response(JSON.stringify({
      success: token === 'test-brochure-token' || token === 'test-site_visit-token',
      action,
      hostname: '127.0.0.1'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (!url.startsWith('https://verify.twilio.com/')) return originalFetch(input, options);
  const request = new URLSearchParams(options.body);
  const target = request.get('To');
  if (url.endsWith('/Verifications')) {
    const sends = (sendsByTarget.get(target) || 0) + 1;
    sendsByTarget.set(target, sends);
    codes.set(target, sends === 1 ? '123456' : '654321');
    return new Response(JSON.stringify({ status: 'pending' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.endsWith('/VerificationCheck')) {
    return new Response(JSON.stringify({ status: request.get('Code') === codes.get(target) ? 'approved' : 'pending' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ message: 'Unexpected test request.' }), { status: 404 });
};
