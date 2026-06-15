/*
 * Node test harness for the reassembler. Proves the streaming reconstruction logic
 * works against both ChatGPT stream formats before we ever load it in Chrome.
 *   run with:  node test/run.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var create = require('../src/reassembler.js').create;

function runFixture(file) {
  var raw = fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8');
  var re = create();
  var events = raw.split(/\n\n/);
  for (var i = 0; i < events.length; i++) {
    var lines = events[i].split('\n');
    var data = '';
    for (var j = 0; j < lines.length; j++) {
      var line = lines[j];
      if (line.indexOf('data:') === 0) data += (line.charAt(5) === ' ') ? line.slice(6) : line.slice(5);
    }
    if (data) re.feed(data);
  }
  return { text: re.getText(), model: re.getModel(), finished: re.isFinished() };
}

var pass = 0, fail = 0;
function check(name, actual, expected) {
  try {
    assert.strictEqual(actual, expected);
    console.log('  ✓ ' + name);
    pass++;
  } catch (e) {
    console.error('  ✗ ' + name + '  expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
    fail++;
  }
}

console.log('snapshot format (older, accumulating parts):');
var s = runFixture('snapshot.txt');
check('response text', s.text, 'Hello! How can I help?');
check('model', s.model, 'gpt-4o');
check('finished', s.finished, true);

console.log('delta format (newer, append/patch deltas):');
var d = runFixture('delta.txt');
check('response text', d.text, 'Hi there, how are you?');
check('model', d.model, 'gpt-5');
check('finished', d.finished, true);

console.log('real chatgpt.com stream (captured live, gpt-5-5):');
var rr = runFixture('real_gpt5.txt');
check('response text', rr.text, "Hey! 👋 How's it going?");
check('model', rr.model, 'gpt-5-5');
check('finished', rr.finished, true);
check('status string did NOT leak into response', rr.text.indexOf('finished_successfully'), -1);

console.log('citation stripping (web-search answers):');
var rc = create();
rc.feed(JSON.stringify({ p: '/message/content/parts/0', o: 'append', v: 'Oximy is a startup' }));
rc.feed(JSON.stringify({ p: "/message/content/parts/0", o: "append", v: "\uE200cite\uE202turn0search7\uE201." }));
check('citation markers stripped', rc.getText(), 'Oximy is a startup.');

// Extra: redelivery / out-of-order safety — a short stray snapshot must not truncate.
console.log('robustness:');
var re = create();
re.feed(JSON.stringify({ message: { author: { role: 'assistant' }, content: { parts: ['Full long answer here'] }, metadata: { model_slug: 'gpt-4o' } } }));
re.feed(JSON.stringify({ message: { author: { role: 'assistant' }, content: { parts: ['Full'] } } })); // stray short snapshot
check('no truncation from short snapshot', re.getText(), 'Full long answer here');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
