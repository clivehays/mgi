/* =============================================================
   Install the repo's git hooks.

   Hooks live in scripts/hooks/ so they are version controlled and survive
   a clone; .git/hooks is not. This copies them across.

       npm run hooks

   Re-run it after pulling a change to scripts/hooks/. It overwrites, and
   says so, rather than silently leaving an older hook in place.
   ============================================================= */

var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, 'hooks');
var DEST = path.join(__dirname, '..', '.git', 'hooks');

if (!fs.existsSync(DEST)) {
  console.error('No .git/hooks here. Run this from inside the repo.');
  process.exit(1);
}

var names = fs.readdirSync(SRC);
if (!names.length) {
  console.log('No hooks to install.');
  process.exit(0);
}

names.forEach(function (name) {
  var from = path.join(SRC, name);
  var to = path.join(DEST, name);
  var existed = fs.existsSync(to);
  fs.copyFileSync(from, to);
  /* git only runs a hook it can execute. Harmless on Windows, required
     everywhere else, and this repo is worked on from both. */
  try {
    fs.chmodSync(to, 0o755);
  } catch (e) {
    /* a filesystem without modes; git for windows runs it anyway */
  }
  console.log('  ' + (existed ? 'replaced' : 'installed') + '  ' + name);
});

console.log('\n' + names.length + ' hook(s) in .git/hooks');
