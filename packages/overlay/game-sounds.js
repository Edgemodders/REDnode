// The game's own sound effects, by sound id, as WAV files REDnode's engine can play
// (Sound Tools, SP1: docs/sound.md).
//
// The game keeps about 73,000 sound effects in sfx_container_<n>.opuspak files, indexed by
// base\sound\soundbanks\sfx_container.opusinfo. The archive stores the paks uncompressed, so
// a sound is a plain slice of the .archive file: the index gives its pak, its offset in the
// pak, the size of its RIFF header and its length; after the header comes an Ogg Opus stream.
// Opus is decoded here with opus-decoder (MIT; libopus in WebAssembly, BSD) and written as
// 16-bit WAV into a cache folder.
//
// Which index and paks: the game's own archive, unless an archive in archive/pc/mod carries
// them. Mod archives are searched in name order and the first one wins (unverified: the
// game's own order). After a hot swap, RED Hot Tools has put the swapped archive in
// archive/pc/mod, so this follows it.
//
// .opusinfo layout (as WolvenKit's OpusInfo reads it): "SND ", 8 bytes, a sound count, 4 bytes,
// then one column per field for every sound: ids u32, paks u16, offsets u32, RIFF header
// sizes u16, lengths u32, decoded sizes u32; then the event groups.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathHash } = require('./archive-index');

const SOUND_DIR = 'base\\sound\\soundbanks\\';
const INFO = `${SOUND_DIR}sfx_container.opusinfo`;
const BASE_ARCHIVE = path.join('archive', 'pc', 'content', 'audio_2_soundbanks.archive');
const CACHE = path.join(os.tmpdir(), 'rednode-game-sounds');

const tables = new Map(); // archive file -> { mtimeMs, size, files: Map(hash -> { offset, size, zSize }) }

/** An archive's files with where their first segment is, by path hash. Cached by mtime. */
function archiveFiles(file) {
  const stat = fs.statSync(file);
  const known = tables.get(file);
  if (known && known.mtimeMs === stat.mtimeMs && known.size === stat.size) return known.files;
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(40);
    if (fs.readSync(fd, header, 0, 40, 0) !== 40 || header.toString('latin1', 0, 4) !== 'RDAR') {
      throw new Error(`${file} is not a game archive`);
    }
    const index = Buffer.alloc(header.readUInt32LE(16));
    fs.readSync(fd, index, 0, index.length, Number(header.readBigUInt64LE(8)));
    const count = index.readUInt32LE(16);
    const segments = 28 + count * 56;
    const files = new Map();
    for (let i = 0; i < count; i++) {
      const o = 28 + i * 56;
      const s = segments + index.readUInt32LE(o + 20) * 16;
      files.set(index.readBigUInt64LE(o), {
        offset: Number(index.readBigUInt64LE(s)),
        zSize: index.readUInt32LE(s + 8),
        size: index.readUInt32LE(s + 12),
      });
    }
    tables.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, files });
    return files;
  } finally {
    fs.closeSync(fd);
  }
}

/** The archives to look in, first match wins: archive/pc/mod in name order, then the game's own. */
function archivesOf(gameDir) {
  const modDir = path.join(gameDir, 'archive', 'pc', 'mod');
  let mods = [];
  try {
    mods = fs
      .readdirSync(modDir)
      .filter((n) => n.toLowerCase().endsWith('.archive'))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map((n) => path.join(modDir, n));
  } catch {
    // no mod folder
  }
  return [...mods, path.join(gameDir, BASE_ARCHIVE)];
}

/** Where a game file is: the first archive that has it, read uncompressed. */
function locate(gameDir, gamePath) {
  const hash = pathHash(gamePath);
  for (const file of archivesOf(gameDir)) {
    let files;
    try {
      files = archiveFiles(file);
    } catch {
      continue;
    }
    const at = files.get(hash);
    if (!at) continue;
    if (at.zSize !== at.size) throw new Error(`${gamePath} is compressed in ${path.basename(file)}: REDnode reads only uncompressed sound paks`);
    return { file, ...at };
  }
  return null;
}

function readAt(file, offset, length) {
  const fd = fs.openSync(file, 'r');
  try {
    const out = Buffer.alloc(length);
    fs.readSync(fd, out, 0, length, offset);
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

let index = null; // { key, rows: Map(id -> { pak, offset, riff, length }) }

/** The sound index the game would load, parsed once per archive change. */
function soundIndex(gameDir) {
  const at = locate(gameDir, INFO);
  if (!at) throw new Error('The game\'s sound index (sfx_container.opusinfo) was not found in its archives');
  const key = `${at.file}|${at.offset}|${at.size}|${fs.statSync(at.file).mtimeMs}`;
  if (index?.key === key) return index;
  const buf = readAt(at.file, at.offset, at.size);
  if (buf.toString('latin1', 0, 4) !== 'SND ') throw new Error('The sound index does not start with SND');
  let o = 12;
  const n = buf.readUInt32LE(o);
  o += 8;
  const col = (width) => {
    const start = o;
    o += n * width;
    return (i) => (width === 4 ? buf.readUInt32LE(start + i * 4) : buf.readUInt16LE(start + i * 2));
  };
  const ids = col(4), paks = col(2), offsets = col(4), riff = col(2), lengths = col(4);
  col(4); // decoded sizes
  const rows = new Map();
  for (let i = 0; i < n; i++) rows.set(ids(i), { pak: paks(i), offset: offsets(i), riff: riff(i), length: lengths(i) });
  // Then the event groups: an event's Wwise id, a count, and the ids of the sounds it plays
  // (its variations). Stop events and events whose sound lives in a Wwise bank have none here.
  const events = new Map();
  while (o + 8 <= buf.length) {
    const event = buf.readUInt32LE(o);
    const count = buf.readUInt32LE(o + 4);
    o += 8;
    const sounds = [];
    for (let i = 0; i < count && o + 4 <= buf.length; i++, o += 4) {
      const s = buf.readUInt32LE(o);
      if (rows.has(s)) sounds.push(s);
    }
    events.set(event, sounds);
  }
  index = { key, rows, events, source: path.basename(at.file) };
  return index;
}

/** Wwise's id for an event name: FNV-1 32 over the lower-case name. */
function eventId(name) {
  let h = 2166136261;
  for (const ch of String(name).toLowerCase()) h = (Math.imul(h, 16777619) ^ (ch.charCodeAt(0) & 0xff)) >>> 0;
  return h;
}

/** The sound ids of an event's recordings (its variations), by its name or Wwise id: [] when it has none here. */
function eventSounds(gameDir, event) {
  const id = typeof event === 'number' ? event >>> 0 : /^\d+$/.test(String(event).trim()) ? Number(String(event).trim()) >>> 0 : eventId(String(event).trim());
  return { event: id, sounds: soundIndex(gameDir).events.get(id) ?? [] };
}

/** A sound's Ogg Opus bytes and where they came from. Throws when the index does not list it. */
function soundBytes(gameDir, id) {
  const idx = soundIndex(gameDir);
  const row = idx.rows.get(id);
  if (!row) throw new Error(`Sound ${id} is not in the game's sound index (${idx.source})`);
  const pakPath = `${SOUND_DIR}sfx_container_${row.pak}.opuspak`;
  const pak = locate(gameDir, pakPath);
  if (!pak) throw new Error(`sfx_container_${row.pak}.opuspak was not found in the game's archives`);
  const ogg = readAt(pak.file, pak.offset + row.offset + row.riff, row.length - row.riff);
  if (ogg.toString('latin1', 0, 4) !== 'OggS') throw new Error(`Sound ${id} in pak ${row.pak} is not an Ogg stream`);
  return { ogg, pak: row.pak, index: idx.source, from: path.basename(pak.file) };
}

/** The packets of an Ogg stream. */
function oggPackets(ogg) {
  const packets = [];
  let parts = [];
  let o = 0;
  while (o + 27 <= ogg.length && ogg.toString('latin1', o, o + 4) === 'OggS') {
    const segments = ogg[o + 26];
    let p = o + 27 + segments;
    for (let s = 0; s < segments; s++) {
      const len = ogg[o + 27 + s];
      parts.push(ogg.subarray(p, p + len));
      p += len;
      if (len < 255) {
        packets.push(Buffer.concat(parts));
        parts = [];
      }
    }
    o = p;
  }
  return packets;
}

/** The granule position of the last page: the stream's samples at 48 kHz, pre-skip included. */
function lastGranule(ogg) {
  let granule = 0n;
  let o = 0;
  while (o + 27 <= ogg.length && ogg.toString('latin1', o, o + 4) === 'OggS') {
    granule = ogg.readBigInt64LE(o + 6);
    const segments = ogg[o + 26];
    let size = 0;
    for (let s = 0; s < segments; s++) size += ogg[o + 27 + s];
    o += 27 + segments + size;
  }
  return granule;
}

/** Decodes an Ogg Opus stream to 16-bit WAV. */
async function opusToWav(ogg) {
  const packets = oggPackets(ogg);
  const head = packets[0] ?? Buffer.alloc(0);
  if (head.toString('latin1', 0, 8) !== 'OpusHead') throw new Error('Not an Ogg Opus stream: no OpusHead');
  const channels = head[9];
  const preSkip = head.readUInt16LE(10);
  const family = head[18];
  const { OpusDecoder } = await import('opus-decoder');
  const decoder = new OpusDecoder({
    channels,
    preSkip,
    ...(family > 0 ? { streamCount: head[19], coupledStreamCount: head[20], channelMappingTable: [...head.subarray(21, 21 + channels)] } : {}),
  });
  await decoder.ready;
  let decoded;
  try {
    decoded = decoder.decodeFrames(packets.slice(2)); // packets[1] is OpusTags
  } finally {
    decoder.free();
  }
  const { channelData, samplesDecoded, sampleRate } = decoded;
  if (!samplesDecoded) throw new Error('The Opus stream did not decode');
  const end = Number(lastGranule(ogg)) - preSkip;
  const samples = end > 0 && end < samplesDecoded ? end : samplesDecoded;
  const bytes = samples * channels * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0, 'latin1');
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write('WAVEfmt ', 8, 'latin1');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'latin1');
  wav.writeUInt32LE(bytes, 40);
  let o = 44;
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < channels; c++, o += 2) {
      const v = Math.max(-1, Math.min(1, channelData[c][i]));
      wav.writeInt16LE(Math.round(v * 32767), o);
    }
  }
  return { wav, channels, seconds: samples / sampleRate };
}

/**
 * A game sound as a WAV file in the cache, decoded on first use.
 * @returns {Promise<{ file: string, pak: number, index: string, from: string, channels: number, seconds: number }>}
 */
async function gameSoundWav(gameDir, id) {
  if (!gameDir) throw new Error('REDnode does not know the game folder');
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new Error('A sound id is a whole number from 0 to 4294967295');
  const found = soundBytes(gameDir, id);
  fs.mkdirSync(CACHE, { recursive: true });
  // The name carries where it came from, so a hot-swapped sound gets its own file.
  const file = path.join(CACHE, `${id}-${found.from.replace(/[^\w.-]/g, '_')}-${found.ogg.length}.wav`);
  if (fs.existsSync(file)) {
    const meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
    return { file, pak: found.pak, index: found.index, from: found.from, ...meta };
  }
  const { wav, channels, seconds } = await opusToWav(found.ogg);
  fs.writeFileSync(file, wav);
  fs.writeFileSync(`${file}.json`, JSON.stringify({ channels, seconds }));
  return { file, pak: found.pak, index: found.index, from: found.from, channels, seconds };
}

module.exports = { gameSoundWav, soundBytes, soundIndex, eventSounds, eventId, opusToWav };
