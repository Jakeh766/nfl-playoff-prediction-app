const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '../frontend', file), 'utf8');

function control(source, id) {
  const tag = source.match(new RegExp(`<([a-z]+)\\b([^>]*\\bid="${id}"[^>]*)>`));
  assert.ok(tag, `${id} exists`);
  const attrs = Object.fromEntries([...tag[2].matchAll(/([\w-]+)="([^"]*)"/g)]
    .map(match => [match[1], match[2]]));
  return { tag: tag[1], ...attrs };
}

test('account panel actions are keyboard-operable buttons, never placeholder links', () => {
  const shell = read('shell.js');
  for (const id of ['forgot-password', 'create-account', 'resend-confirmation',
    'create-account-back', 'confirm-account-back', 'forgot-password-back',
    'reset-password-back', 'delete-account']) {
    const action = control(shell, id);
    assert.equal(action.tag, 'button', id);
    assert.equal(action.type, 'button', `${id} must not submit a nearby form`);
    assert.ok(action.class.split(' ').includes('text-button'), id);
    assert.equal(action.href, undefined, id);
  }
  assert.ok(control(shell, 'delete-account').class.split(' ').includes('text-button--danger'));
});

test('group text actions share a style while Delete group keeps its prominent button', () => {
  const html = read('groups.html');
  for (const id of ['groups-back', 'regenerate-group-invite', 'leave-group']) {
    const action = control(html, id);
    assert.equal(action.tag, 'button', id);
    assert.equal(action.type, 'button', id);
    assert.ok(action.class.split(' ').includes('text-button'), id);
  }
  assert.ok(control(html, 'leave-group').class.split(' ').includes('text-button--danger'));
  const prominent = control(html, 'delete-group').class.split(' ');
  assert.ok(prominent.includes('group-delete-button'));
  assert.ok(!prominent.includes('text-button'));
});

test('text actions retain touch targets and focus, and hover is gated to mouse-like pointers', () => {
  const css = read('styles.css');
  const base = css.match(/^\.text-button\s*\{([^}]+)\}/m)[1];
  assert.match(base, /text-decoration:\s*none/);
  assert.match(base, /color:\s*var\(--text\)/);
  assert.match(base, /min-height:\s*44px/);
  assert.match(css, /\.text-button--danger\s*\{[^}]*color:\s*var\(--danger-text\)/);
  assert.match(css, /\.text-button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-outline\)/);
  assert.match(css, /\.text-button:disabled\s*\{[^}]*cursor:\s*not-allowed/);
  const gated = css.match(/@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{\s*\.text-button:enabled:hover,\s*summary\.text-button:hover\s*\{[^}]*background:[^}]+\}\s*\}/);
  assert.ok(gated, 'hover feedback must exclude coarse/touch-only devices and disabled buttons');
  assert.doesNotMatch(css.replace(gated[0], ''), /[^{}]*\.text-button[^{}]*:hover[^{}]*\{/,
    'no ungated text-action hover rules');
  // Only the directory card's navigation cue intentionally forces an underline.
  const underlines = [...css.matchAll(/([^{}]+)\{[^{}]*text-decoration:\s*underline[^{}]*\}/g)];
  assert.deepEqual(underlines.map(match => match[1].trim()), ['.group-card-action']);
});

test('content, legal and destination links remain anchors outside the text-button style', () => {
  for (const file of fs.readdirSync(path.join(__dirname, '../frontend')).filter(file => file.endsWith('.html'))
    .concat(['shell.js', 'scoring.js'])) {
    const source = read(file);
    assert.doesNotMatch(source, /<(?:button|summary)\b[^>]*class="[^"]*\btext-link\b/, file);
    assert.doesNotMatch(source, /<a\b[^>]*class="[^"]*\btext-button\b/, file);
    assert.doesNotMatch(source, /<a\b[^>]*href="#"/, file);
  }
  assert.match(read('privacy.html'), /<a href="mailto:contact@predictplayoffs.com">/);
  assert.match(read('scoring.html'), /<a href="https:\/\/www.vegasinsider.com\/nfl\/odds\/win-totals\/">/);
  assert.match(read('scoring.js'), /<a href="\$\{NBA_SEASON.sourceUrl\}">BetMGM snapshot<\/a>/);
  for (const file of ['index.html', 'nba.html']) {
    assert.match(read(file), /<a class="text-link" href="\/scoring"/);
    assert.match(read(file), /<a class="text-link" href="\/groups"/);
  }
});
