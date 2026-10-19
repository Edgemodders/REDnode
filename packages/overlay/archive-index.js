// Reads which files an .archive holds, from its file table, without REDbridge.
//
// An .archive ("RDAR") keeps no file names, only a 64-bit FNV-1a hash of each path
// (lowercase, backslashes). The header points at the index; the index lists one 56-byte
// entry per file, starting with that hash. So a question like "does this archive change
// the game's sound paks?" is answered by hashing the paths we know and looking them up.
//
// Header (40 bytes): magic "RDAR", version u32, index offset u64, index size u32,
// debug offset u64, debug size u32, file size u64.
// Index: file table offset u32, file table size u32, crc u64, file count u32,
// segment count u32, dependency count u32, then the file entries:
// name hash u64, timestamp i64, inline segments u32, segments start u32, segments end u32,
// dependencies start u32, dependencies end u32, sha1 (20 bytes).

'use strict';

const fs = require('node:fs');

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** The game's hash of a resource path: FNV-1a 64 of the lowercase path with backslashes. */
function pathHash(gamePath) {
  let hash = FNV_OFFSET;
  for (const byte of Buffer.from(gamePath.toLowerCase().replace(/\//g, '\\'), 'utf8')) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK;
  }
  return hash;
}

/** The path hashes of every file in an archive, as a Set of BigInt. Throws if it is not one. */
function archiveHashes(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(40);
    if (fs.readSync(fd, header, 0, 40, 0) !== 40 || header.toString('latin1', 0, 4) !== 'RDAR') {
      throw new Error(`${file} is not a game archive: it does not start with RDAR`);
    }
    const indexAt = Number(header.readBigUInt64LE(8));
    const indexSize = header.readUInt32LE(16);
    const index = Buffer.alloc(indexSize);
    if (fs.readSync(fd, index, 0, indexSize, indexAt) !== indexSize) throw new Error(`${file}: its file table is cut short`);
    const count = index.readUInt32LE(16);
    const first = 28; // after the six index fields
    if (first + count * 56 > indexSize) throw new Error(`${file}: its file table is cut short`);
    const hashes = new Set();
    for (let i = 0; i < count; i++) hashes.add(index.readBigUInt64LE(first + i * 56));
    return hashes;
  } finally {
    fs.closeSync(fd);
  }
}

// The game's sound effects: an index and its packs (about 1,900 of them in game 2.31),
// read by the game's audio engine rather than as ordinary resources. Swapping them into a
// running game crashes it (docs/world.md, "H1 limit: sound paks crash a swap").
const SOUND_DIRS = ['base\\sound\\soundbanks\\', 'ep1\\sound\\soundbanks\\'];
const SOUND_PACKS = 4000;
let soundHashes = null;

function soundPakHashes() {
  if (soundHashes) return soundHashes;
  soundHashes = new Map();
  for (const dir of SOUND_DIRS) {
    soundHashes.set(pathHash(`${dir}sfx_container.opusinfo`), `${dir}sfx_container.opusinfo`);
    for (let n = 0; n < SOUND_PACKS; n++) {
      const name = `${dir}sfx_container_${n}.opuspak`;
      soundHashes.set(pathHash(name), name);
    }
  }
  return soundHashes;
}

/** The game sound paks an archive replaces, by path; empty when it has none. */
function soundPaksIn(file) {
  const known = soundPakHashes();
  const found = [];
  for (const hash of archiveHashes(file)) {
    const name = known.get(hash);
    if (name) found.push(name);
  }
  return found.sort();
}

module.exports = { pathHash, archiveHashes, soundPaksIn };
