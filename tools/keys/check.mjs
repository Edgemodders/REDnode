// Checks keys.mjs against a scratch folder, with made-up keys: node tools/keys/check.mjs
// Windows only (DPAPI). Never touches the real store in %APPDATA%\Edgemodders\keys.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'edge-keys-'));
process.env.EDGEMODDERS_KEYS_DIR = dir;
for (const v of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'MY_TOOL_API_KEY']) delete process.env[v];
const keys = await import('./keys.mjs');

let failed = 0;
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? `: ${extra}` : ''}`);
  if (!ok) failed++;
};
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const FAKE = 'AIzaFAKE-check-key-0000-wxyz';
try {
  check(keys.getKey('gemini') === undefined, 'unset key reads as undefined');
  check(!keys.hasKey('gemini'), 'hasKey is false when unset');

  let t = Date.now();
  keys.setKey('gemini', `  ${FAKE}\n`);
  check(true, 'setKey', `${Date.now() - t} ms`);
  const hex = readFileSync(join(dir, 'gemini.txt'), 'utf8');
  check(/^[0-9a-f]+\r\n$/.test(hex) && !hex.includes(FAKE), 'the file is one line of hex, not the key');
  check(keys.hasKey('gemini'), 'hasKey is true');

  t = Date.now();
  check(keys.getKey('gemini') === FAKE, 'getKey reads it back, trimmed', `${Date.now() - t} ms (cached from setKey)`);

  // A file PowerShell itself made, as the command in keys.mjs's header does, is read the same.
  const own = 'sk-ant-FAKE-made-by-powershell-1234';
  const ps = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', "ConvertTo-SecureString $env:K -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $env:F"],
    { env: { ...process.env, K: own, F: join(dir, 'anthropic.txt') }, encoding: 'utf8' },
  );
  check(ps.status === 0, 'PowerShell wrote a key file of its own');
  t = Date.now();
  check(keys.getKey('anthropic', { tool: 'check' }) === own, "a file made by PowerShell's ConvertFrom-SecureString reads back", `${Date.now() - t} ms`);
  t = Date.now();
  keys.getKey('anthropic');
  check(Date.now() - t < 50, 'a second read is cached', `${Date.now() - t} ms`);

  // The other way round: our file decrypts in plain PowerShell.
  const back = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '$s = Get-Content -LiteralPath $env:F | ConvertTo-SecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))'],
    { env: { ...process.env, F: join(dir, 'gemini.txt') }, encoding: 'utf8' },
  );
  check(back.stdout.trim() === FAKE, "our file decrypts with PowerShell's ConvertTo-SecureString");

  // A change by another tool is seen: the cache follows the file.
  keys.setKey('gemini', 'AIzaFAKE-second-key-9999');
  writeFileSync(join(dir, 'gemini.txt'), readFileSync(join(dir, 'gemini.txt')));
  check(keys.getKey('gemini') === 'AIzaFAKE-second-key-9999', 'a replaced key is read again');

  const info = keys.keyInfo('anthropic');
  check(info.set && info.source === 'file' && info.last4 === '1234' && info.name === 'Anthropic', 'keyInfo: set, from the file, last 4', JSON.stringify({ ...info, usedBy: info.usedBy.length }));
  check(!JSON.stringify(info).includes(own.slice(0, -4)), 'keyInfo carries no more of the key than its last 4');
  check(info.usedBy[0]?.tool === 'check', 'used by records the tool by name');
  const used = readFileSync(join(dir, 'used-by.json'), 'utf8');
  check(!used.includes(own) && !used.includes(FAKE.slice(4)), 'used-by.json holds names and times only');

  process.env.GEMINI_API_KEY = 'AIzaFROM-ENV';
  check(keys.getKey('gemini') === 'AIzaFROM-ENV', 'the environment variable wins');
  check(keys.keyInfo('gemini').source === 'env', 'keyInfo says it comes from the environment');
  delete process.env.GEMINI_API_KEY;

  writeFileSync(join(dir, 'openai.txt'), '01000000d08c9ddf0115d1118c7a00c04fc297eb0100000000\r\n');
  t = Date.now();
  check(keys.getKey('openai') === undefined, 'an undecryptable file counts as unset', `${Date.now() - t} ms`);
  t = Date.now();
  check(keys.keyInfo('openai').unreadable === true, 'keyInfo marks it unreadable, from the cache', `${Date.now() - t} ms`);

  check(keys.removeKey('openai') && !keys.hasKey('openai'), 'removeKey removes the file');
  check(keys.removeKey('openai') === false, 'removeKey again says there was none');

  check(throws(() => keys.getKey('../x')) && throws(() => keys.getKey('Gemini')), 'bad service ids are refused');
  check(throws(() => keys.setKey('gemini', 'two words')) && throws(() => keys.setKey('gemini', '')), 'keys with spaces or empty are refused');
  check(keys.checkKey('anthropic', 'sk-oops') !== null && keys.checkKey('anthropic', 'sk-ant-abc') === null, 'checkKey: the Anthropic prefix');
  check(keys.envName('my-tool') === 'MY_TOOL_API_KEY', 'envName for another service');

  keys.setKey('my-tool', 'FAKE-other-service-key');
  check(keys.listServices().join(',') === 'anthropic,gemini,openai,elevenlabs,my-tool', 'listServices: the known ones, then the rest', keys.listServices().join(','));

  t = Date.now();
  await keys.promises.setKey('elevenlabs', 'FAKE-eleven-async-5678');
  const a = await keys.promises.getKey('elevenlabs');
  check(a === 'FAKE-eleven-async-5678', 'promises: setKey and getKey', `${Date.now() - t} ms`);
  writeFileSync(join(dir, 'elevenlabs.txt'), readFileSync(join(dir, 'elevenlabs.txt'))); // a new stamp: decrypt again
  t = Date.now();
  check((await keys.promises.getKey('elevenlabs')) === 'FAKE-eleven-async-5678', 'promises: getKey decrypts', `${Date.now() - t} ms`);
  check((await keys.promises.keyInfo('elevenlabs')).last4 === '5678', 'promises: keyInfo');
  check((await keys.promises.getKey('nothing-here')) === undefined, 'promises: unset is undefined');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
