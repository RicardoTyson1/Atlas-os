// Atlas Mac helper. Runs in the background (launchd) with macOS's built-in JavaScript for Automation:
//   osascript -l JavaScript ~/.atlas/atlas-helper.js
// It asks Atlas for commands, runs them on this Mac, and reports back. Nothing else is installed.
// Rules it enforces itself, whatever the server sends:
//   - Never deletes, renames or overwrites files.
//   - Desktop organizing only moves top-level Desktop items into the eight Atlas folders.
//   - Never opens apps, installers or scripts by file path.
ObjC.import('Foundation');
ObjC.import('stdlib');

const VERSION = '1.1';
const app = Application.currentApplication();
app.includeStandardAdditions = true;

const HOME = ObjC.unwrap($.NSHomeDirectory());
const DIR = HOME + '/.atlas';
const DESKTOP = HOME + '/Desktop';
const FOLDERS = ['Jobs', 'Quotes and Invoices', 'Customers', 'Commercial', 'Marketing', 'Personal', 'Archive', 'To Review'];
const BLOCKED_EXT = ['app', 'command', 'sh', 'zsh', 'bash', 'pkg', 'mpkg', 'dmg', 'scpt', 'scptd', 'applescript', 'workflow', 'terminal', 'tool', 'action', 'prefpane', 'kext', 'plugin', 'jar', 'py', 'rb', 'pl', 'js', 'exe', 'shortcut'];
const fm = $.NSFileManager.defaultManager;

/* ---------- small utilities ---------- */
const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
const sh = cmd => app.doShellScript(cmd, { alteringLineEndings: false });
const log = m => console.log(new Date().toISOString() + ' ' + m);
const exists = p => fm.fileExistsAtPath(p);
const isDir = p => { const d = Ref(); return fm.fileExistsAtPathIsDirectory(p, d) && d[0]; };
function readFile(p) { const s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null); return s.isNil() ? null : ObjC.unwrap(s); }
function writeFile(p, text) { $(text).writeToFileAtomicallyEncodingError(p, true, $.NSUTF8StringEncoding, null); }

const BASE = (readFile(DIR + '/server') || 'https://atlas-os-puce.vercel.app').trim().replace(/\/$/, '');
const HOST = (() => { try { return sh('scutil --get ComputerName').trim(); } catch (e) { return 'Mac'; } })();

function api(path, body) {
  // The passcode lives in ~/.atlas/auth-header (readable only by this user) and is never put on the command line.
  let cmd = 'curl -sS -m 40 -H @' + q(DIR + '/auth-header') + ' ';
  if (body !== undefined) {
    const tmp = DIR + '/out.json';
    writeFile(tmp, JSON.stringify(body));
    cmd += "-H 'content-type: application/json' --data-binary @" + q(tmp) + ' ';
  }
  const out = sh(cmd + q(BASE + path));
  return out ? JSON.parse(out) : {};
}

function expand(p) {
  p = String(p || '').trim();
  if (p === '~') return HOME;
  if (p.startsWith('~/')) p = HOME + p.slice(1);
  return p;
}

/* ---------- actions ---------- */
const ACTIONS = {
  open_app(a) {
    sh('open -a ' + q(a.name));
    return 'Opened ' + a.name + '.';
  },
  open_url(a) {
    if (!/^https?:\/\//i.test(a.url)) throw new Error('Only web links can be opened.');
    sh('open ' + q(a.url));
    return 'Opened ' + a.url + '.';
  },
  open_path(a) {
    const p = expand(a.path);
    if (!p.startsWith(HOME + '/') && p !== HOME && !p.startsWith('/Volumes/')) throw new Error('I only open files in your home folder or on external drives.');
    if (!exists(p)) throw new Error('Nothing found at ' + a.path + '.');
    const ext = (p.split('/').pop().split('.').pop() || '').toLowerCase();
    if (!isDir(p) && BLOCKED_EXT.includes(ext)) throw new Error('For safety I do not open apps, installers or scripts by path. Ask me to open the app by name instead.');
    if (isDir(p) && ext === 'app') throw new Error('For safety I do not open apps by path. Ask me to open the app by name instead.');
    sh('open ' + q(p));
    return 'Opened ' + p.replace(HOME, '~') + '.';
  },
  find_files(a) {
    const out = sh('mdfind -onlyin ' + q(HOME) + ' -name ' + q(a.query) + ' 2>/dev/null | grep -v "/Library/" | head -n 25').trim();
    return out ? 'Matches (newest results are not sorted):\n' + out.split('\n').map(l => l.replace(HOME, '~')).join('\n') : 'No files found with "' + a.query + '" in the name.';
  },
  volume(a) {
    const cur = app.getVolumeSettings();
    if (a.level === 'mute') { app.setVolume(null, { outputMuted: true }); return 'Muted.'; }
    if (a.level === 'unmute') { app.setVolume(null, { outputMuted: false }); return 'Unmuted.'; }
    let v = typeof a.level === 'number' ? a.level : cur.outputVolume + (a.level === 'up' ? 12 : -12);
    v = Math.max(0, Math.min(100, Math.round(v)));
    app.setVolume(null, { outputVolume: v, outputMuted: false });
    return 'Volume set to ' + v + '%.';
  },
  media(a) {
    const verb = { play_pause: 'playpause', next: 'nextTrack', previous: 'previousTrack' }[a.command];
    for (const name of ['Spotify', 'Music']) {
      try {
        const p = Application(name);
        if (p.running()) { p[verb](); return name + ': ' + a.command.replace('_', '/') + '.'; }
      } catch (e) { /* not installed */ }
    }
    return 'Neither Spotify nor Music is open, so there is nothing to control.';
  },
  lock_screen() {
    sh('pmset displaysleepnow');
    return 'Screen locked (display asleep).';
  },
  screenshot() {
    const raw = DIR + '/shot.png', small = DIR + '/shot.jpg';
    sh('screencapture -x -t png ' + q(raw));
    sh('sips -Z 1280 -s format jpeg -s formatOptions 60 ' + q(raw) + ' --out ' + q(small) + ' >/dev/null');
    const b64 = sh('base64 -i ' + q(small)).replace(/\s+/g, '');
    sh('rm -f ' + q(raw) + ' ' + q(small));
    return { text: 'Here is the screen (main display).', image: b64 };
  },
  run_shortcut(a) {
    const out = sh('perl -e \'alarm 45; exec @ARGV\' shortcuts run ' + q(a.name) + ' 2>&1 | head -c 2000').trim();
    return 'Ran the Shortcut "' + a.name + '".' + (out ? ' Output: ' + out : '');
  },
  list_desktop() {
    const names = ObjC.deepUnwrap(fm.contentsOfDirectoryAtPathError(DESKTOP, null)) || [];
    const items = names.filter(n => !n.startsWith('.')).sort((x, y) => x.localeCompare(y)).map(n => {
      const p = DESKTOP + '/' + n;
      const attrs = ObjC.deepUnwrap(fm.attributesOfItemAtPathError(p, null)) || {};
      const folder = isDir(p) && !/\.(app|pages|numbers|key|rtfd|bundle)$/i.test(n);
      const size = folder ? '' : ' (' + Math.max(1, Math.round((attrs.NSFileSize || 0) / 1024)) + ' KB)';
      const mod = attrs.NSFileModificationDate ? new Date(attrs.NSFileModificationDate).toISOString().slice(0, 10) : '';
      return (folder ? 'folder | ' : 'file   | ') + n + size + (mod ? ' | modified ' + mod : '');
    });
    if (!items.length) return 'The Desktop is empty.';
    return items.length + ' items on the Desktop (nothing was changed):\n' + items.join('\n');
  },
  organize_desktop(a) {
    const moved = [], skipped = [], created = [];
    for (const m of a.moves || []) {
      const name = String(m.name || '');
      if (!name || name.includes('/') || name.startsWith('.') || FOLDERS.includes(name) || !FOLDERS.includes(m.folder)) { skipped.push(name + ': not allowed'); continue; }
      const from = DESKTOP + '/' + name, dir = DESKTOP + '/' + m.folder, to = dir + '/' + name;
      if (!exists(from)) { skipped.push(name + ': not on the Desktop'); continue; }
      if (!exists(dir)) {
        if (!fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, false, $(), null)) { skipped.push(name + ': could not create ' + m.folder); continue; }
        created.push(m.folder);
      }
      if (exists(to)) { skipped.push(name + ': something with that name is already in ' + m.folder + ' (left in place)'); continue; }
      // moveItem refuses to overwrite and keeps the original name.
      if (fm.moveItemAtPathToPathError(from, to, null)) moved.push({ name, folder: m.folder });
      else skipped.push(name + ': could not be moved');
    }
    // Batches within 30 minutes belong to the same run, so one undo puts the whole run back.
    let file = (readFile(DIR + '/organize-last') || '').trim(), run = null;
    if (file) { try { run = JSON.parse(readFile(DIR + '/' + file) || 'null'); } catch (e) { run = null; } }
    if (!run || Date.now() - new Date(run.updated || run.at).getTime() > 30 * 60 * 1000) {
      file = 'organize-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      run = { at: new Date().toISOString(), moved: [] };
    }
    run.moved = run.moved.concat(moved);
    run.updated = new Date().toISOString();
    writeFile(DIR + '/' + file, JSON.stringify(run, null, 1));
    writeFile(DIR + '/organize-last', file);
    let text = 'Moved ' + moved.length + ' item' + (moved.length === 1 ? '' : 's') + ', skipped ' + skipped.length + '.';
    if (created.length) text += '\nCreated folders: ' + created.join(', ') + '.';
    if (moved.length) text += '\nMoved:\n' + moved.map(x => x.name + ' → ' + x.folder).join('\n');
    if (skipped.length) text += '\nSkipped:\n' + skipped.join('\n');
    return text;
  },
  undo_organize() {
    const last = (readFile(DIR + '/organize-last') || '').trim();
    const data = last && readFile(DIR + '/' + last);
    if (!data) return 'There is no Desktop organize to undo.';
    const { moved } = JSON.parse(data);
    const back = [], skipped = [];
    for (const m of moved) {
      const from = DESKTOP + '/' + m.folder + '/' + m.name, to = DESKTOP + '/' + m.name;
      if (!exists(from)) { skipped.push(m.name + ': no longer in ' + m.folder); continue; }
      if (exists(to)) { skipped.push(m.name + ': something with that name is already on the Desktop'); continue; }
      if (fm.moveItemAtPathToPathError(from, to, null)) back.push(m.name); else skipped.push(m.name + ': could not be moved');
    }
    writeFile(DIR + '/organize-last', '');
    return 'Moved ' + back.length + ' item' + (back.length === 1 ? '' : 's') + ' back to the Desktop. The folders were left in place (nothing is deleted).' + (skipped.length ? '\nSkipped:\n' + skipped.join('\n') : '');
  }
};

/* ---------- main loop ---------- */
function run() {
  log('Atlas helper ' + VERSION + ' started on ' + HOST + ', server ' + BASE);
  let idleWait = 15;
  while (true) {
    let next = {};
    try {
      next = api('/api/desktop?op=next&v=' + VERSION + '&host=' + encodeURIComponent(HOST));
    } catch (e) {
      log('Could not reach Atlas: ' + e.message);
      delay(30);
      continue;
    }
    if (next.error) { log('Atlas said: ' + next.error); delay(60); continue; }
    const c = next.cmd;
    if (c && ACTIONS[c.action]) {
      log('Running ' + c.action);
      let result;
      try {
        const out = ACTIONS[c.action](c.args || {});
        result = typeof out === 'string' ? { ok: true, text: out } : { ok: true, text: out.text, image: out.image };
      } catch (e) {
        result = { ok: false, text: String(e.message || e).slice(0, 500) };
      }
      try { api('/api/desktop?op=result', Object.assign({ id: c.id }, result)); } catch (e) { log('Could not send result: ' + e.message); }
      continue;
    }
    // Poll quickly while Ricardo is talking to Atlas, slowly otherwise.
    delay(next.hot ? 1.5 : idleWait);
  }
}
run();
