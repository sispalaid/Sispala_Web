#!/usr/bin/env node
// Backfill script: parse past server console.log lines from journalctl stdin
// and merge them into login_logs.json in writeLog() format.
//
// Usage (on the server):
//   journalctl -u sispala-stack -o short-iso --since "2026-01-01" | node backfill_logs.js
//   journalctl -u sispala-web   -o short-iso --since "2026-01-01" | node backfill_logs.js
//
// Recognized lines:
//   Alarm  CH1 dipicu oleh: <user>       -> ALARM
//   Sirine CH2 dipicu oleh: <user>       -> SIRINE
//   Menjalankan broadcast: mpv ... "file" -> AUDIO_PLAY: <file> (<channel>)

'use strict';

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'login_logs.json');
const USERS_FILE = path.join(__dirname, 'users.json');

function readJSON(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {}
  return null;
}

function roleOf(username) {
  const users = readJSON(USERS_FILE);
  if (Array.isArray(users)) {
    const u = users.find(x => x.username === username);
    if (u) return u.role;
  }
  return 'admin'; // fallback: alarm/sirine allowed for admin+superadmin
}

// journalctl short-iso line: 2026-06-19T20:39:47+0700 host node[123]: Msg
const LINE_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:[+-]\d{4})?\s+\S+\s+node\[\d+\]:\s*(.*)$/;

// Reformat an ISO timestamp to writeLog() WIB format: "19/6/2026, 20.39.47"
function wibTimestamp(iso) {
  // server local time assumed WIB; offset +0700 stripped above
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return iso;
  const [, y, mo, d, h, mi, s] = m;
  return `${parseInt(d, 10)}/${parseInt(mo, 10)}/${y}, ${h}.${mi}.${s}`;
}

const PLAY_RE = /^Menjalankan broadcast: mpv (--no-video --volume=100 --input-ipc-server=\S+ )?(?:--af=lavfi="\[pan=stereo\|(?:c0=c0\|c1=0\*c0|c0=0\*c0\|c1=c0)\]" )?"(.+)"$/;

function parseLine(ts, msg) {
  let m = msg.match(/^Alarm CH1 dipicu oleh: (\S+)$/);
  if (m) return { username: m[1], role: roleOf(m[1]), action: 'ALARM', timestamp: wibTimestamp(ts) };

  m = msg.match(/^Sirine CH2 dipicu oleh: (\S+)$/);
  if (m) return { username: m[1], role: roleOf(m[1]), action: 'SIRINE', timestamp: wibTimestamp(ts) };

  m = msg.match(PLAY_RE);
  if (m) {
    const file = path.basename(m[3]);
    const channel = m[2] ? (m[2].includes('c1=0*c0') ? 'left' : 'right') : 'stereo';
    const username = '<system>';
    return { username, role: roleOf(username), action: `AUDIO_PLAY: ${file} (${channel})`, timestamp: wibTimestamp(ts) };
  }
  return null;
}

let existing = readJSON(LOG_FILE) || [];
const seen = new Set(existing.map(l => `${l.timestamp}|${l.username}|${l.action}`));
const added = [];

const input = fs.readFileSync(0, 'utf8');
for (const line of input.split('\n')) {
  const m = line.match(LINE_RE);
  if (!m) continue;
  const entry = parseLine(m[1], m[2]);
  if (!entry) continue;
  const key = `${entry.timestamp}|${entry.username}|${entry.action}`;
  if (seen.has(key)) continue;
  seen.add(key);
  added.push(entry);
}

// Sort by WIB timestamp descending (newest first), stable for equal timestamps
function tsKey(t) {
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}), (\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return 0;
  const [, d, mo, y, h, mi, s] = m;
  return Number(`${y}${String(mo).padStart(2, '0')}${String(d).padStart(2, '0')}${h}${mi}${s}`);
}

const sorted = added.concat(existing).sort((a, b) => tsKey(b.timestamp) - tsKey(a.timestamp)).slice(0, 300);

fs.writeFileSync(LOG_FILE, JSON.stringify(sorted, null, 2));
console.log(`Backfill complete: ${added.length} new entries added (${sorted.length} total, max 300).`);
if (added.length > 0) {
  console.log('Sample new entries:');
  added.slice(0, 5).forEach(e => console.log(`  ${e.timestamp} | ${e.username} (${e.role}) | ${e.action}`));
}
