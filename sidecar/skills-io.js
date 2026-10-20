/* sidecar/skills-io.js — durable I/O for skills.jsonl, the agent's owned skill library.

   skills.jsonl is a STATE log: the newest record per (agent, skill) IS the skill. It used to be wired like the
   spend ledger, a HISTORY log: the boot read kept only the last LOG_MAX_BYTES of archive + live, and every append
   rotated the live file to <file>.1 past that size, deleting the previous .1. Once markUsed appended the whole
   record (body, support files, base64 package) of every loaded skill on every run, a busy station rotated twice in
   one uptime and the only durable copy of any skill not used recently was deleted. RAM hid it until the next
   restart; boot compaction then made the loss permanent.

   This io never deletes skill data:
     • readAll() reads the WHOLE legacy archive <file>.1 (older) and then the WHOLE live file: a state log has to be
       read entire. A file larger than readMaxBytes falls back to a tail read and loadComplete() turns false, so the
       store refuses to compact: a partial view must never be written back as the whole library;
     • append() is a durable JSONL append, never a rotation;
     • needsCompaction() asks for a rewrite while a legacy .1 archive exists, or once the live file passes
       compactBytes AND twice its size right after the last rewrite (a large library is not rewritten per append);
     • rewrite(entries) atomically replaces the live file, then removes the legacy .1 (its records were loaded
       and are part of the rewrite).

     makeSkillsIo({ fs, file, writeDurable(file, body), note?, compactBytes?, readMaxBytes? })
       -> { readAll, loadComplete, append, needsCompaction, rewrite } */
'use strict';
const { appendJsonlDurable, tailLines } = require('./logbound.js');

const DEFAULT_COMPACT_BYTES = 4 * 1024 * 1024;
const DEFAULT_READ_MAX_BYTES = 256 * 1024 * 1024;

function makeSkillsIo(deps) {
  const fs = deps.fs, file = deps.file, archive = deps.file + '.1';
  if (!fs || !file || typeof deps.writeDurable !== 'function') throw new Error('skills-io needs { fs, file, writeDurable }');
  const note = typeof deps.note === 'function' ? deps.note : function () {};
  const compactBytes = deps.compactBytes > 0 ? deps.compactBytes : DEFAULT_COMPACT_BYTES;
  const readMaxBytes = deps.readMaxBytes > 0 ? deps.readMaxBytes : DEFAULT_READ_MAX_BYTES;
  let complete = true;
  let compactedSize = 0;   // live size right after this process's last rewrite (hysteresis)

  // -1 = no such file; null = it exists but cannot be measured
  function sizeOf(f) {
    try { return fs.statSync(f).size; }
    catch (e) { return e && e.code === 'ENOENT' ? -1 : null; }
  }
  function linesOf(f) {
    const size = sizeOf(f);
    if (size === -1) return [];
    if (size !== null && size > readMaxBytes) {
      complete = false;
      note('skills.io.read-partial', new Error(f + ' is ' + size + ' bytes; read only its last ' + readMaxBytes));
      return tailLines({ fs }, f, readMaxBytes);
    }
    try { return String(fs.readFileSync(f, 'utf8')).split('\n').filter(Boolean); }
    catch (e) {
      if (e && e.code === 'ENOENT') return [];
      complete = false;   // it exists and could not be read: never let a compaction treat it as empty
      throw e;
    }
  }
  // A torn row (a crash mid-append) is skipped, as the bounded loader did; the skip is counted, never silent.
  function parse(lines, f) {
    const out = [];
    let torn = 0, firstError = null;
    for (const l of lines) {
      try { out.push(JSON.parse(l)); }
      catch (e) { torn++; if (!firstError) firstError = e; }
    }
    if (torn) note('skills.io.torn-row', new Error(torn + ' unparsable row(s) skipped in ' + f + ': ' + ((firstError && firstError.message) || '')));
    return out;
  }

  return {
    readAll() {
      complete = true;
      return parse(linesOf(archive), archive).concat(parse(linesOf(file), file));
    },
    loadComplete() { return complete; },
    append(entry) { appendJsonlDurable({ fs, note }, file, entry); },
    needsCompaction() {
      if (sizeOf(archive) >= 0) return true;
      const size = sizeOf(file);
      return size !== null && size > Math.max(compactBytes, compactedSize * 2);
    },
    rewrite(entries) {
      const list = Array.isArray(entries) ? entries : [];
      const body = list.map(e => JSON.stringify(e)).join('\n') + (list.length ? '\n' : '');
      deps.writeDurable(file, body);
      compactedSize = Buffer.byteLength(body, 'utf8');
      try { fs.unlinkSync(archive); } catch (e) { if (!e || e.code !== 'ENOENT') note('skills.io.archive-unlink', e); }
    }
  };
}

module.exports = { makeSkillsIo, DEFAULT_COMPACT_BYTES, DEFAULT_READ_MAX_BYTES };
