---
title: Shared keys
---

# Shared keys

The player's AI service keys (Anthropic, Google Gemini, OpenAI, ElevenLabs and others), typed once and read by every EDGE tool on the PC: REDnode's packages, EDGEmat in VS Code and as an MCP server, EDGEwave, REDagent. Asked for in [#23](https://github.com/Edgemodders/REDnode/issues/23).

| Phase | What | State |
|---|---|---|
| K1 | The store and its library, `tools/keys/keys.mjs` | Built |
| K2 | A **Keys** view in the launcher's Settings drawer, in the game | Built in REDnode 0.46.0, awaiting its in-game test |
| K3 | The `keys:<service>` permission, `secrets.shared` and `secrets.askShared` for packages; REDagent and `edgewave-voice` move to the store | Planned |

The files are the shared contract. REDnode's Keys view (K2) is the in-game way to set them; outside the game, each tool reads and writes the same files itself, with REDnode closed.

## The store

| | |
|---|---|
| Where | `%APPDATA%\Edgemodders\keys\<service>.txt`, one file per service |
| Service ids | Lowercase letters, digits and dashes, up to 40: `anthropic`, `gemini`, `openai`, `elevenlabs`, or any other a tool needs |
| Format | Windows DPAPI for the current user, written as PowerShell's `ConvertFrom-SecureString` writes it: one line of hex |
| Who can read it | Only the same Windows user on the same PC. Any program that user runs can read it, as with VS Code's secret storage or an environment variable |
| Environment | A variable wins when set: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`; for another id, its name in capitals with `_API_KEY` (`my-tool` is `MY_TOOL_API_KEY`). For CI, and for clients that pass keys |
| Used by | `used-by.json` beside the keys: which tool read which key and when, names and times only |

A key can be set with no tool at all, from PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\Edgemodders\keys" | Out-Null
Read-Host 'Gemini key' -AsSecureString | ConvertFrom-SecureString | Set-Content "$env:APPDATA\Edgemodders\keys\gemini.txt"
```

A file that cannot be decrypted (made by another Windows user, or copied from another PC) counts as unset, so the tool asks for the key again.

## The Keys view

In the game: F10, the gear (Settings), then **Open** on the **Keys** line. The view takes the drawer's place, with **‹ Settings** to go back.

| Shows | Means |
|---|---|
| `•••• abcd` | Set; the key's last 4 characters. Hover for when it was saved |
| From `GEMINI_API_KEY` | An environment variable is set and wins over the saved key |
| Unreadable here | A file made by another Windows user or PC: set it again |
| Not set | No key |
| Used by EDGEmat, REDagent | Tools that have read it; hover for when |

**Set** and **Replace** open a box that shows dots: paste the key and press Enter. A key that does not look right for its service is refused (an Anthropic key starts with `sk-ant-`, an OpenAI one with `sk-`). **Remove** asks once more, since it removes the key for every tool. **Other service id** adds a line for any service by its id.

The page never holds a key after Enter: it goes to the host, which saves it with the library's non-blocking functions and answers only what `keyInfo` gives. Only the launcher and the Mod Manager may make the call (`rednode:host:keys`). The host logs `Keys: <service> set` or `removed`, never a key.

## The library

`tools/keys/keys.mjs`: one ES module, MIT, no dependencies, Node 18 or later. Each repo copies it, as the Nexus tool is copied; keep the copies the same. `node tools/keys/check.mjs` checks it against a scratch folder with made-up keys (30 checks), never the real store.

```js
import { getKey, setKey, hasKey, removeKey, keyInfo } from './keys.mjs';

const key = getKey('gemini', { tool: 'EDGEmat' }); // a string, or undefined when not set
if (!key) {
  const typed = await askThePlayer('Your Google Gemini key'); // the tool's own prompt
  setKey('gemini', typed); // every other tool now finds it
}
```

| Function | Does |
|---|---|
| `getKey(service, { tool }?)` | The key: the environment variable when set, else the file. `tool` names the reader for the "used by" record |
| `setKey(service, key)` | Saves it, replacing any. The variable still wins when set |
| `hasKey(service)` | Whether a key is set, with no decryption |
| `removeKey(service)` | Removes the file (not the variable); true when there was one |
| `keyInfo(service)` | What a Keys window shows, never the key: `set`, `source` (`env` or `file`), `last4`, `unreadable`, `updated`, `usedBy` |
| `listServices()` | The known services, then any other with a file |
| `checkKey(service, key)` | A message when the key does not look right (an Anthropic key starts with `sk-ant-`, an OpenAI one with `sk-`), else null |
| `envName(service)` | The variable that wins for a service |
| `SERVICES` | The known services, with their names |
| `promises` | `getKey`, `setKey`, `hasKey`, `removeKey`, `keyInfo` without blocking |

How a key is kept safe in the library:

- Encryption and decryption run in Windows PowerShell 5.1 (`ConvertTo-SecureString`, `ConvertFrom-SecureString`), started by its full path with its window hidden. The key and the encrypted text go only through PowerShell's standard input and output: never on a command line, never in an environment variable.
- PowerShell gets a short environment of its own (the Windows folders and the user's profile), not the calling process's, so other keys in that environment do not reach it.
- Nothing prints a key. `keyInfo` gives only the last 4 characters.
- A decrypted key is kept in the process's memory until its file changes, so a second read starts no PowerShell. A key replaced by another tool is read again.

A PowerShell start takes about 1 s on the dev PC, so the first read or write of each key in a process blocks that long with the sync functions. A host that must stay responsive, such as REDnode's, uses `promises`.

On other systems than Windows the library reads environment variables only; `setKey` fails.

## Who uses it

| Tool | Reads | Writes | When |
|---|---|---|---|
| REDnode's Keys view | All | All (Set, Replace, Remove) | K2, REDnode 0.46.0 |
| REDnode packages (`secrets.shared`, `secrets.askShared`) | The keys their manifest lists and the player allowed | Never directly: `askShared` opens REDnode's own prompt | K3 |
| REDagent | `anthropic` | Through `secrets.askShared` | K3 |
| `edgewave-voice` | `elevenlabs` | Through `secrets.askShared` | K3 |
| EDGEmat's MCP server and extension | `gemini`, `openai` | **Set Image Service Key...** | EDGEmat's own issue, after K1 |
| EDGEwave (VS Code) | `elevenlabs` | Its key prompt | Later |
