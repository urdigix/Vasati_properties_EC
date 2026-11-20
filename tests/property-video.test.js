const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runInNewContext } = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const source = html.slice(html.indexOf('    function propertyVideoSource('), html.indexOf('    const toastBox'));
const context = { URL, location: { origin: 'https://vasatiproperties.com' }, escapeDetailHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') };
runInNewContext(source, context);

test('property walkthrough normalizes YouTube Shorts, watch, shared, live and embed URLs', () => {
  for (const url of [
    'https://youtube.com/shorts/k1M4kAJqKn4?si=share',
    'https://www.youtube.com/watch?feature=shared&v=k1M4kAJqKn4',
    'https://m.youtube.com/watch?v=k1M4kAJqKn4',
    'https://youtu.be/k1M4kAJqKn4?si=share',
    'https://www.youtube.com/live/k1M4kAJqKn4',
    'https://www.youtube.com/embed/k1M4kAJqKn4',
    'https://www.youtube-nocookie.com/embed/k1M4kAJqKn4'
  ]) {
    const video = context.propertyVideoSource(url);
    assert.equal(video.kind, 'youtube', url);
    assert.equal(video.src, 'https://www.youtube.com/embed/k1M4kAJqKn4');
    const markup = context.renderPropertyVideo(url, 'Tour');
    assert.match(markup, /<iframe/);
    assert.match(markup, /Watch on YouTube/);
  }
});

test('uploads and direct video files use a mobile-compatible native player', () => {
  for (const url of ['/api/media/video-id', '/uploads/tour.mp4', 'https://cdn.example/tour.webm?token=public']) {
    const markup = context.renderPropertyVideo(url, 'Tour');
    assert.match(markup, /<video controls playsinline preload="metadata"/);
    assert.doesNotMatch(markup, /<iframe/);
  }
  assert.equal(context.renderPropertyVideo('', 'Tour'), '');
  assert.equal(context.renderPropertyVideo('javascript:alert(1)', 'Tour'), '');
  assert.equal(context.renderPropertyVideo('data:text/html,hello', 'Tour'), '');
  for (const url of ['https://youtube.com.evil.example/watch?v=k1M4kAJqKn4', 'https://youtube.com/watch?v=invalid']) {
    assert.equal(context.propertyVideoSource(url).kind, 'link');
    assert.doesNotMatch(context.renderPropertyVideo(url, 'Tour'), /<iframe/);
  }
  assert.doesNotMatch(context.renderPropertyVideo('/api/media/video-id', '"><img src=x onerror=alert(1)>'), /<img/);
  const admin = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
  assert.match(admin, /type="text" id="formVideoUrl"/, 'Relative upload URLs must not fail native URL input validation');
});
