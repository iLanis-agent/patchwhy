(function (root) {
  'use strict';
  // Unified diff reader and applier (the format of diff -u and git diff).
  function stripPath(p) { p = p.replace(/\t.*$/, '').trim(); if (p === '/dev/null') return p; return p.replace(/^"(.*)"$/, '$1'); }
  function parse(text) {
    var lines = String(text).split(/\r?\n/), crlf = /\r\n/.test(text), files = [], issues = [], f = null, h = null, i, m;
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    function closeHunk() {
      if (!h) return;
      h.aOld = h.lines.filter(function (x) { return x.t !== '+'; }).length; h.aNew = h.lines.filter(function (x) { return x.t !== '-'; }).length;
      if (h.aOld !== h.oldLen || h.aNew !== h.newLen) h.countError = 'Header says -' + h.oldStart + ',' + h.oldLen + ' +' + h.newStart + ',' + h.newLen + ' but the lines below count ' + h.aOld + ' old and ' + h.aNew + ' new.';
      h = null;
    }
    for (i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (h && (h.aOld === undefined) && (h.seenOld < h.oldLen || h.seenNew < h.newLen || l[0] === '\\')) {
        if (l[0] === '\\') { var last = h.lines[h.lines.length - 1]; if (last) last.noEol = true; continue; }
        var t = l[0];
        if (t === ' ' || t === '+' || t === '-') { h.lines.push({ t: t, s: l.slice(1), no: i + 1 }); if (t !== '+') h.seenOld++; if (t !== '-') h.seenNew++; continue; }
        if (l === '') { h.lines.push({ t: ' ', s: '', no: i + 1, blank: true }); h.seenOld++; h.seenNew++; h.blankCtx = true; continue; }
        // ran out of valid body lines early
        closeHunk();
      }
      if ((m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(l))) {
        closeHunk();
        if (!f) { f = { old: '?', nw: '?', hunks: [], noHeader: true }; files.push(f); }
        h = { oldStart: +m[1], oldLen: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLen: m[4] === undefined ? 1 : +m[4], section: m[5].trim(), lines: [], seenOld: 0, seenNew: 0, no: i + 1 };
        f.hunks.push(h); continue;
      }
      if (/^--- /.test(l) && lines[i + 1] && /^\+\+\+ /.test(lines[i + 1])) { closeHunk(); f = { old: stripPath(l.slice(4)), nw: stripPath(lines[i + 1].slice(4)), hunks: [] }; files.push(f); i++; continue; }
      if (/^diff --git /.test(l)) { closeHunk(); f = null; continue; }
      if (h) { closeHunk(); }
      if (/^(index |new file mode|deleted file mode|old mode|new mode|similarity|rename |Binary files)/.test(l)) { if (/^Binary files/.test(l)) issues.push({ lvl: 'warn', msg: 'Line ' + (i + 1) + ': binary file change. Text patches cannot carry it.' }); continue; }
      if (l.trim() !== '' && files.length) issues.push({ lvl: 'info', msg: 'Line ' + (i + 1) + ' is outside any hunk and is ignored: "' + l.slice(0, 50) + '".' });
    }
    closeHunk();
    // closing a hunk that is still short at end of input
    files.forEach(function (ff) { ff.hunks.forEach(function (hh) {
      if (hh.aOld === undefined) { hh.aOld = hh.lines.filter(function (x) { return x.t !== '+'; }).length; hh.aNew = hh.lines.filter(function (x) { return x.t !== '-'; }).length; }
      if ((hh.aOld !== hh.oldLen || hh.aNew !== hh.newLen) && !hh.countError) hh.countError = 'Header says -' + hh.oldStart + ',' + hh.oldLen + ' +' + hh.newStart + ',' + hh.newLen + ' but the lines below count ' + hh.aOld + ' old and ' + hh.aNew + ' new.';
      if (hh.blankCtx) issues.push({ lvl: 'warn', msg: 'Hunk at line ' + hh.no + ' has empty lines where context lines (a single space) should be. Editors that strip trailing whitespace do this. GNU patch and git apply both accept it, but some other tools do not.' });
      ff.adds = (ff.adds || 0) + hh.lines.filter(function (x) { return x.t === '+'; }).length; ff.dels = (ff.dels || 0) + hh.lines.filter(function (x) { return x.t === '-'; }).length;
    }); });
    if (!files.length) issues.push({ lvl: 'err', msg: 'No unified diff found. Expected "--- a/file", "+++ b/file" and "@@ -1,3 +1,4 @@" lines.' });
    files.forEach(function (ff) { if (ff.noHeader) issues.push({ lvl: 'err', msg: 'Hunk without ---/+++ file header lines.' }); ff.hunks.forEach(function (hh) { if (hh.countError) issues.push({ lvl: 'err', msg: 'Hunk at line ' + hh.no + ': ' + hh.countError + ' patch and git apply call this a corrupt patch.' }); }); });
    if (crlf) issues.push({ lvl: 'warn', msg: 'The diff text has CRLF line endings. If the files use LF, every line will fail to match.' });
    return { files: files, issues: issues, crlf: crlf };
  }
  function splitLines(t) { if (t === '') return { lines: [], eol: true }; var eol = /\n$/.test(t), a = t.split('\n'); if (eol) a.pop(); return { lines: a, eol: eol }; }
  function matchAt(src, pos, seq) { for (var i = 0; i < seq.length; i++) if (src[pos + i] !== seq[i]) return false; return true; }
  // apply with exact context, searching for the nearest offset (like patch --fuzz=0)
  function apply(orig, file) {
    var sp = splitLines(orig), src = sp.lines, out = [], pos = 0, delta = 0, results = [], eol = sp.eol, ok = true;
    file.hunks.forEach(function (h, hi) {
      var oldSeq = h.lines.filter(function (x) { return x.t !== '+'; }).map(function (x) { return x.s; }), newLines = h.lines.filter(function (x) { return x.t !== '-'; }), start = h.oldStart - 1 + (oldSeq.length === 0 && h.oldLen === 0 ? 1 : 0);
      if (h.oldLen === 0) start = h.oldStart;   // pure insertion: oldStart is the line AFTER which to insert
      start += delta;   // like patch, assume the offset found for the previous hunk still holds
      var found = -1, best = null, d;
      for (d = 0; d <= src.length + 1; d++) {
        var c1 = start + d, c2 = start - d;
        if (c1 >= pos && c1 + oldSeq.length <= src.length && matchAt(src, c1, oldSeq)) { found = c1; break; }
        if (d && c2 >= pos && c2 + oldSeq.length <= src.length && matchAt(src, c2, oldSeq)) { found = c2; break; }
      }
      if (found < 0) { ok = false; var at = Math.max(pos, Math.min(start, src.length)), bi = 0; while (bi < oldSeq.length && src[at + bi] === oldSeq[bi]) bi++; var why = bi >= oldSeq.length ? 'it matches only at positions that overlap an earlier hunk' : at + bi >= src.length ? 'the file ends at line ' + src.length + ' but the hunk expects "' + String(oldSeq[bi]).slice(0, 40) + '" at line ' + (at + bi + 1) : 'at line ' + (at + bi + 1) + ' the hunk expects "' + String(oldSeq[bi]).slice(0, 40) + '" but the file has "' + String(src[at + bi]).slice(0, 40) + '"'; results.push({ hunk: hi + 1, ok: false, reason: 'The ' + oldSeq.length + ' context and removed lines do not match anywhere in the file. Closest to line ' + h.oldStart + ': ' + why + '.' }); return; }
      for (var k = pos; k < found; k++) out.push(src[k]);
      newLines.forEach(function (x) { out.push(x.s); });
      var lastOld = h.lines.filter(function (x) { return x.t !== '+'; }).slice(-1)[0], lastNew = newLines.slice(-1)[0];
      if (found + oldSeq.length >= src.length) { if (lastNew) eol = !lastNew.noEol; else if (lastOld) eol = true; }
      pos = found + oldSeq.length;
      delta = found - (h.oldLen === 0 ? h.oldStart : h.oldStart - 1);
      results.push({ hunk: hi + 1, ok: true, offset: delta });
    });
    if (!ok) return { ok: false, results: results };
    for (var j = pos; j < src.length; j++) out.push(src[j]);
    var text = out.join('\n') + (out.length && eol ? '\n' : '');
    return { ok: true, text: text, results: results };
  }
  var api = { parse: parse, apply: apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PatchWhy = api;
})(typeof window !== 'undefined' ? window : this);
