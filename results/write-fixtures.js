/* Render every fixture to results/out/. Same list the tests use, so the
   pages on disk are always the pages under test. */
var fs = require('fs');
var path = require('path');
var derive = require('./derive.js');
var renderer = require('./render.js');
var FIXTURES = require('./fixtures.js').FIXTURES;

var dir = path.join(__dirname, 'out');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
fs.readdirSync(dir).forEach(function (f) { fs.unlinkSync(path.join(dir, f)); });

Object.keys(FIXTURES).forEach(function (name) {
  var f = FIXTURES[name];
  var p = derive.derive(f.answers, f.contact, { reading_no: 1, generated_at: '2 Sep 2026' });
  fs.writeFileSync(path.join(dir, name + '.html'), renderer.render(p));
  console.log('  ' + name.padEnd(26) + p.state.padEnd(10) +
    'quiet ' + p.quiet_count + (p.thin ? ' thin' : '     ') +
    '  focus ' + p.focus.padEnd(12) + p.calculator.pattern);
});
console.log('\n  ' + Object.keys(FIXTURES).length + ' pages written to results/out/');
