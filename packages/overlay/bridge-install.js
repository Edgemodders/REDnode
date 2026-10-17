// Getting REDbridge for players without VS Code (W3): the latest release from GitHub,
// checked against the SHA-256 GitHub gives for it, unpacked into REDnode's own folder,
// and the .NET 10 runtime for this Windows user when the machine has none. Only on the
// player's click in the Mod Manager. REDbridge is GPL-3.0 and lives in its own
// repository; REDnode only downloads it.
//
//   %LOCALAPPDATA%\REDnode\bridge\<tag>\REDbridge.exe
//
// .NET goes where Microsoft's dotnet-install.ps1 puts a per-user runtime,
// %LOCALAPPDATA%\Microsoft\dotnet, with no admin rights and no PATH or DOTNET_ROOT
// change: the host sets DOTNET_ROOT for the REDbridge process alone (a user-level
// DOTNET_ROOT once broke Vortex's .NET check for EDGEdeck).

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const REPO = 'Edgemodders/REDbridge';
const DOTNET_INSTALL = 'https://dot.net/v1/dotnet-install.ps1';
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'REDnode' };

const localAppData = () => process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');

/** Where REDnode keeps the REDbridge copies it fetched, one folder per release tag. */
const bridgeRoot = () => path.join(localAppData(), 'REDnode', 'bridge');

/** Where dotnet-install.ps1 puts a runtime for this Windows user. */
const userDotnetRoot = () => path.join(localAppData(), 'Microsoft', 'dotnet');

function hasNet10(root) {
  try {
    return fs.readdirSync(path.join(root, 'shared', 'Microsoft.NETCore.App')).some((v) => v.startsWith('10.'));
  } catch {
    return false;
  }
}

/**
 * Where a .NET 10 runtime is: { root, machine } or null. With aOnlyUser (the clean test),
 * a machine-wide install is not counted.
 */
function dotnet10(aOnlyUser) {
  const machine = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'dotnet');
  if (!aOnlyUser && hasNet10(machine)) return { root: machine, machine: true };
  return hasNet10(userDotnetRoot()) ? { root: userDotnetRoot(), machine: false } : null;
}

/**
 * The newest REDbridge release with a Windows x64 zip:
 * { tag, version, asset, url, size, sha256, page }. sha256 is null when GitHub gave none.
 */
async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} when asked for the latest REDbridge release`);
  const rel = await res.json();
  const asset = (rel.assets ?? []).find((a) => /win-x64\.zip$/i.test(a.name));
  if (!asset) throw new Error(`REDbridge ${rel.tag_name} has no Windows x64 zip`);
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? '');
  return {
    tag: rel.tag_name,
    version: String(rel.tag_name).replace(/^v/, ''),
    asset: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
    sha256: digest ? digest[1].toLowerCase() : null,
    page: rel.html_url,
  };
}

/** Downloads a URL to a file, with progress(received, total); returns the file's SHA-256. */
async function download(url, file, progress) {
  const res = await fetch(url, { headers: { 'User-Agent': 'REDnode' } });
  if (!res.ok || !res.body) throw new Error(`The download answered ${res.status}: ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let received = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      received += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      progress?.(received, total);
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  return hash.digest('hex');
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 1 << 24 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { output: `${stdout}\n${stderr}` })) : resolve(`${stdout}\n${stderr}`),
    );
  });
}

// Windows' own tar (bsdtar, in Windows 10 1803 and later) unpacks zips; PowerShell's
// Expand-Archive is the slower fallback.
async function unzip(zip, dir) {
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  if (fs.existsSync(tar)) {
    await run(tar, ['-xf', zip, '-C', dir]);
    return;
  }
  await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`,
  ]);
}

/**
 * Downloads a release, checks it and unpacks it to <bridgeRoot>/<tag>. Returns REDbridge.exe.
 * A release without a SHA-256 from GitHub, or one that does not match, is not unpacked.
 */
async function installRelease(release, { progress, log }) {
  if (!release.sha256) throw new Error(`GitHub gave no SHA-256 for ${release.asset}, so REDnode will not install it`);
  const target = path.join(bridgeRoot(), release.tag);
  const exe = path.join(target, 'REDbridge.exe');
  if (fs.existsSync(exe)) return exe;
  fs.mkdirSync(bridgeRoot(), { recursive: true });
  const work = fs.mkdtempSync(path.join(bridgeRoot(), '.get-'));
  try {
    const zip = path.join(work, release.asset);
    log(`REDbridge: downloading ${release.asset} (${Math.round(release.size / 1048576)} MB) from ${release.url}`);
    const sha256 = await download(release.url, zip, progress);
    if (sha256 !== release.sha256) {
      throw new Error(`${release.asset} did not match GitHub's SHA-256 (got ${sha256}); it was deleted`);
    }
    log(`REDbridge: ${release.asset} matches GitHub's SHA-256; unpacking`);
    const unpacked = path.join(work, 'unpacked');
    fs.mkdirSync(unpacked);
    await unzip(zip, unpacked);
    if (!fs.existsSync(path.join(unpacked, 'REDbridge.exe'))) throw new Error(`${release.asset} has no REDbridge.exe`);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(unpacked, target);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  log(`REDbridge ${release.version} installed at ${exe}`);
  return exe;
}

/** Installs the .NET 10 runtime for this Windows user with Microsoft's script. Returns its root. */
async function installDotnet({ log }) {
  const root = userDotnetRoot();
  fs.mkdirSync(bridgeRoot(), { recursive: true });
  const work = fs.mkdtempSync(path.join(bridgeRoot(), '.dotnet-'));
  try {
    const script = path.join(work, 'dotnet-install.ps1');
    await download(DOTNET_INSTALL, script);
    log(`REDbridge: installing the .NET 10 runtime for this Windows user into ${root}`);
    let output = '';
    try {
      output = await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
        '-Channel', '10.0', '-Runtime', 'dotnet', '-InstallDir', root, '-NoPath',
      ]);
    } catch (err) {
      output = err.output ?? '';
      throw new Error(`Microsoft's .NET installer failed: ${err.message.split('\n')[0]}`);
    } finally {
      for (const line of output.split(/\r?\n/)) if (line.trim()) log(`  dotnet-install: ${line.trim()}`);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  if (!hasNet10(root)) throw new Error('The .NET 10 runtime did not install; the host log has the installer\'s lines');
  return root;
}

/** Removes REDnode's older REDbridge copies; one still in use stays until a later try. */
function removeOlder(keepTag, log) {
  let tags = [];
  try {
    tags = fs.readdirSync(bridgeRoot());
  } catch {
    return;
  }
  for (const tag of tags) {
    if (tag === keepTag || tag.startsWith('.')) continue;
    try {
      fs.rmSync(path.join(bridgeRoot(), tag), { recursive: true });
      log(`REDbridge: removed the older copy ${tag}`);
    } catch {
      // Running from that copy: it goes next time.
    }
  }
}

module.exports = { bridgeRoot, dotnet10, latestRelease, installRelease, installDotnet, removeOlder };
