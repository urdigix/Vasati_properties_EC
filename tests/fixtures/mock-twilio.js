const originalFetch = global.fetch;
const codes = new Map();

global.fetch = async (input, options = {}) => {
  const url = String(input);
  if (!url.startsWith('https://verify.twilio.com/')) return originalFetch(input, options);
  const request = new URLSearchParams(options.body);
  const target = request.get('To');
  if (url.endsWith('/Verifications')) {
    codes.set(target, '123456');
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
