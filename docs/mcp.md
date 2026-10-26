# Kernel MCP server

The REDnode host can serve its tools to AI agents over [MCP](https://modelcontextprotocol.io), the Model Context Protocol. With it, Claude Code on your PC can read your mods' logs, see your overlay windows, look up game types and call the game while it runs. [REDagent](https://github.com/Edgemodders/REDagent), the assistant inside the game, uses the same tools.

Status: **in use since REDnode 0.4.0.** First passed in game on 2026-10-12 (REDagent phase C1); tools added since are listed below with the version that brought them.

## Set it up

Since REDnode 0.40.0 an assistant asks to connect and you allow it in the game: no token to copy (#19, asked for by EDGEchat).

| Step | How |
|---|---|
| 1. Turn it on | In the game, open the REDnode launcher (**F10**, then the REDNODE tab), and its settings with the gear at the right of the Theme row. Switch **MCP server** on. For developers running the host from the repo, it is on already |
| 2. Add REDnode to Claude Code, once | With the EDGE plugin, it is there already as `plugin:edge:rednode`. Without it: `claude mcp add --transport http --scope user rednode http://127.0.0.1:41820/mcp` |
| 3. Connect | In Claude Code, `/mcp`, pick `rednode`, then **Authenticate**. Your browser shows "Approve in Cyberpunk 2077" and a code such as `FPZ-4201` |
| 4. Allow it in the game | REDnode's **Connect** window shows the same code with the assistant's name. Press **F10**, check the codes match, and press **Allow**. The browser goes back to Claude Code, which is now connected |
| 5. Use it | Ask, for example, "using the rednode tools, what is V's health?" |

The connection stays across game restarts: Claude Code keeps its token and renews it. The launcher's settings list **Connected assistants** under the MCP server switch; **Revoke** ends one, and it must ask again.

The server listens only on `127.0.0.1`, port 41820, and every request needs a token. It only answers while the game, and with it the host, is running.

How the sign-in works, for other MCP clients: standard OAuth 2.1 with dynamic client registration. A request without a valid token gets `401` with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`; the client registers at `/register` (redirect URIs must be `http://localhost`, `127.0.0.1` or `[::1]`), sends the player's browser to `/authorize` (authorization code with PKCE S256 only), and exchanges the code at `/token`. Access tokens last 24 hours and refresh tokens 180 days, each refresh token working once; REDnode keeps only their SHA-256 hashes, in `mcp-clients.json` in its data folder. Every request must name `127.0.0.1:41820` or `localhost:41820` as its `Host`, and a browser's `Origin` must be the server itself, so a web page cannot start a sign-in. One request waits at a time and lapses after two minutes; a code is good once, for a minute.

**Copy setup** still gives a fixed token for clients without OAuth: run the copied command (`claude mcp add ... --header "Authorization: Bearer ..."`) in a terminal. Don't add it beside the plugin's `rednode`, or you have two.

## Tools

| Tool | Gives | Changes anything |
|---|---|---|
| `logs` | What Node mods printed, newest last: all, one mod, or errors only. The same lines as the Mod log app | No |
| `apps` | The installed apps and mods: open or running, a mod's state, process, memory and last error, its pins, its `requires` checked against the game folder, and its window ids. With `open`, `close` or `restart`, changes one as the launcher does; with `pin-launcher`, `unpin-launcher`, `pin-hud` or `unpin-hud`, pins it as the Mod Manager does | Only with an action |
| `game_state` | Whether REDnode is linked to the game, what the game shows (menu, photo mode, scene, main menu), the overlay mode | No |
| `perf` | The game's frame rate, the overlay's cost per frame, the host's memory and each mod process's memory | No |
| `gameapi_lookup` | Game types and functions with the TypeScript signatures `api` uses, and REDnode's notes. An exact name (`StatsSystem` or `gameStatsSystem`) gives the declaration; part of a name searches | No |
| `window_text` | The text an overlay window shows, including inside UI kit components and input fields | No |
| `window_image` | A picture of an overlay window: its own pixels, before REDnode places it on the game. Not the game behind it, its place on screen, or the cursor | No |
| `window_console` | What an overlay window's page logged (`console.log`, `console.error` and the like) and its uncaught errors: the last 200 messages since it opened. `level` keeps that level and above; `limit` the newest few (default 50). Node mods log to `logs` instead. REDnode 0.16.0 or later | No |
| `game_image` | A picture of the game's screen now: the game alone, or with `overlay: true` the overlay windows and cursor on it, as the player sees it. Scaled to at most `maxWidth` (default 1280). HDR is converted to SDR, so its colors are approximate. Fails while the game is loading or minimized. Plugin 0.13.0 or later | No |
| `tweakdb` | TweakDB from the running game: a flat's type and value (`get`), a record as an object reference for `api_read` (`record`), or the ids of every record of a type (`records`, at most 500 unless `limit` says more). Ids are `"0x..."` hashes. REDnode 0.19.0 or later. Read only: changes go through a package's `tweakdb.set`, which REDnode can undo | No |
| `archives_reload` | Swaps archives into the running game through RED Hot Tools, as a package's `archives.reload` does, then refreshes what V wears so it shows the new version (`refresh: false` skips it, REDnode 0.26.20 or later): full paths to `.archive`, `.xl` or `.yaml` files, or names of archives in `archive/pc/mod`. Needs RED Hot Tools and a loaded save. Archives that change the game's sound paks are swapped with the game paused and its sound index loaded again (REDnode 0.26.8 or later); a sound that just played may keep its old version until the game loads it again (for a weapon, equip it again). Answers with what was swapped and what failed. REDnode 0.26.0 or later | **Yes**: it replaces files in the game's mod folder, and a broken archive can crash the game |
| `api_read` | A live game call that reads, without asking: the same as `api_call`, for functions named like reads (starting with `Get`, `Is`, `Has`, `Can` or `Find`, but not one that also changes, such as `GetOrCreate…`) and every method of a TweakDB record. It refuses the rest. REDnode 0.26.16 or later | No |
| `game_facts` | Quest facts by name (`names`); an unset fact reads 0. See [Quest API](quests.html). REDnode 0.32.0 or later | No |
| `game_facts_set` | Sets quest facts (`facts`: names and whole numbers) and answers their new values. REDnode 0.32.0 or later | **Yes**: it changes the player's save |
| `game_journal` | Journal entries by path (`paths`, `kind`): each one's state and whether it is tracked, or `null`. With no paths, the tracked entry and its path. REDnode 0.32.0 or later | No |
| `game_journal_set` | Changes a journal entry's state (`state`, with the game's notification) or tracks it (`track`). REDnode 0.32.0 or later | **Yes**: it changes the player's save |
| `game_teleport` | Moves V to `x`, `y`, `z` (and `yaw` in degrees) or to a world node (`nodeRef`). REDnode 0.32.0 or later | **Yes**: it moves V |
| `api_call` | A live game call, as `api` makes it: a global function, a static function (`class`), or a method (`self`). Game objects come back as `{ "$ref": n, "$type": "..." }` | **Yes**: it can change the player's game, such as money or health |
| `api_get` | A property of a game object | No |
| `<package>__<function>` | A mod's own tool: each function a package's service file marks `@tool` in its JSDoc, with the author's description and parameters, named by the package id and the function (dashes become `_`). See [Mod services](services.html). REDnode 0.36.0 or later | Only those not marked `@readonly`, which ask the player first |
| `mod_services` | Every running mod's tools: package, function, description, parameters and whether it only reads, including mods started after the client read its tool list. REDnode 0.36.0 or later | No |
| `mod_read` | Calls a mod's read-only tool by `package` and `function`, with `args` by name, without asking; refuses the rest. REDnode 0.36.0 or later | No |
| `mod_call` | Calls any mod's tool by `package` and `function`, with `args` by name. REDnode 0.36.0 or later | **Yes**: whatever the mod does; it asks the player first |

### Mods' tools and the Tools Manager

The server builds its tool list fresh for every request, so a mod's tools are there as soon as the mod runs, and gone when it stops. It is stateless and cannot tell a client that the list changed: a client sees new tools the next time it reads the list (Claude Code: a new session, or `/mcp` reconnect). Meanwhile `mod_services` lists them and `mod_read` or `mod_call` reaches them.

The **Tools Manager**, in the optional [Admin Tools](admin-tools.md) pack (built into REDnode 0.36.0), lists every tool an assistant sees, grouped as REDnode's own and each mod's: what it does, its parameters, and whether it reads, asks first or acts. A switch per tool and per mod takes it away from every assistant at once, and the switches are kept across starts; **Off for new packages** makes a newly installed mod's tools start switched off. The switches are kept by REDnode itself, so they stay as set if the pack is removed. It also shows which assistants have connected (Claude Code by the name it gives, REDagent and other packages by their name) and their recent calls of mods' tools. Each call is also written in the mod's own log.

A REDnode package can use the same tools: it lists `"permissions": ["mcp"]` in its `rednode-app.json`, the player allows it in the Mod Manager, and `kernel.mcp()` in the `rednode` package gives it the address and its own token. The server then runs for it even with the **MCP server** switch off; that switch only controls access from outside, such as Claude Code. REDagent uses the tools this way.

Claude Code asks before it uses a tool, unless you allow it. Allow the read-only tools freely. From REDnode 0.26.16, `api_call` and `archives_reload` (and from 0.32.0 `game_facts_set`, `game_journal_set` and `game_teleport`, from 0.36.0 `mod_call` and every mod tool not marked `@readonly`) carry `_meta: { "anthropic/requiresUserInteraction": true }`, as EDGEdeck's deploy, undo and remove do: Claude Code asks you before every call of them, in every permission mode, auto mode included, with no "don't ask again". Reads go through `api_read`, which never asks.

### How `api_read` tells a read

The game's own `const` flag cannot: in 2.31, 1,865 `const` functions are not getters (such as `SetAIRole` and `SendMinigameFailedToAllNPCs`), and two thirds of the functions named like getters are not `const`. So the name decides:

| Rule | Example |
|---|---|
| Runs a name starting with `Get`, `Is`, `Has`, `Can` or `Find` | `GetItemInSlot`, `GetItemInEquipSlot`, `IsQuickHackPanelOpen` |
| Refuses it when a change word is joined to it with `Or`, `And` or `Then`: `Create`, `Add`, `Set`, `Remove`, `Spawn` and others (the list is `CHANGE_WORDS` in `packages/overlay/mcp.js`) | `GetOrCreateBlackboard`, `GetOrAddVendor` |
| Runs every method of a TweakDB record (`gamedata..._Record`), known from the `$type` a tool returned | `DisplayName` on a record from `tweakdb` |

Of the 9,504 function names in 2.31 that start like reads, it refuses 7, all `GetOrCreate…` or `GetOrAdd…`. Until REDnode 0.32.1 it refused any name with a change word anywhere after the start, 543 names, most of them reads where the word is a noun (`GetItemInEquipSlot`, `GetStartTime`, `IsOpen`), which then went through `api_call` and asked. A function named like a read could still change something (unverified for most of them). The rule is only in the MCP server: the `rednode` package's `api` is not limited.

The server also gives the agent short instructions: what REDnode is, what each tool is for, and the game API's rules (the game instance is `{}`, 64-bit numbers are strings, references die when a save loads).

## MCP sign-in: test (#19)

Built 2026-10-26 in REDnode 0.40.0: `packages/overlay/oauth.js` (the endpoints and the tokens), the checks in `mcp.js`'s handler (`Host`, `Origin`, the 401 header), the built-in **Connect** window (`packages/overlay/connect`, shown over the game without F10 while a request waits), **Connected assistants** with **Revoke** in the launcher's settings. Checked outside the game with a scratch server running the whole flow as Claude Code does (scratchpad `oauth/check.mjs`, 23 checks: metadata, registration, refused redirects, Origin and Host, one request at a time, the same code in page and game, allow and deny, PKCE, a code used once, refresh rotation, hashed storage, a restart, revoke). **Not checked:** Claude Code's own sign-in against it, and the Connect window in the game.

The test adds a second, header-less server entry, so Claude Code signs in instead of sending the plugin's token. Game 2.5, REDnode 0.40.0.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. Load a save. Launcher settings: **MCP server** is on. In a terminal: `claude mcp add --transport http --scope user rednode-signin http://127.0.0.1:41820/mcp`. **Mark**.
2. In a Claude Code session, `/mcp`, pick `rednode-signin`: it says it needs authentication. Pick **Authenticate**. The browser shows "Approve in Cyberpunk 2077" and a code. **Mark**.
3. In the game, without pressing anything, the **Connect** window shows the same code and "Claude Code (rednode-signin)" or similar. **Mark**.
4. **F10**, press **Allow**. The browser goes back to Claude Code, and `/mcp` shows `rednode-signin` connected. Ask Claude "with rednode-signin, what does game_state say?" **Mark**.
5. Launcher settings: **Connected assistants** lists it. **Mark**.
6. Quit the game, start it again, load a save. Ask the same question: it works with no new sign-in. **Mark**.
7. Press **Revoke** beside it. Ask again: Claude Code says it needs authentication. **Mark**.
8. Authenticate again, and press **Deny** in the game: Claude Code says the sign-in was denied. **Mark**.
9. Authenticate again and answer nothing: after two minutes the Connect window closes and the browser says the request lapsed. **Mark**.
10. Clean up: `claude mcp remove rednode-signin --scope user`. Quit the game.

### MCP sign-in: first run (2026-10-26)

Game 2.5, REDnode 0.40.0, dev PC. Steps 1 to 7 passed: Claude Code registered, the browser and the Connect window showed the same code (KHP-7797), Allow connected it, the launcher listed it, the connection held across a game restart with no new sign-in, and Revoke ended it.

Step 8 failed: the browser said "Unknown client". **Revoke** deleted the registration, but Claude Code keeps the client id it was given and signs in with it again without registering (the log has no new registration after the revoke). REDnode 0.40.1 fixes it:

- Revoke ends the client's tokens and its unused codes, and keeps its registration, so its next sign-in asks the player again.
- A registration is dropped only when it never connected within a day, or when it has not been used for as long as a refresh token lasts (180 days).
- A client id REDnode has forgotten (a dropped registration or a lost data file) is taken back when it has REDnode's form and asks for a loopback redirect. Anyone on the PC can register anyway, and the player still allows each sign-in.

The scratch check now also covers a sign-in and a Deny after a revoke, and a forgotten id (30 checks).

### MCP sign-in: retest on 0.40.1 (2026-10-26): passed

Game 2.5, REDnode 0.40.1, dev PC, the same `rednode-signin` entry. Every step passed (log and timer marks agree):

| Step | Log |
|---|---|
| Authenticate | Claude Code registered again (it did not reuse the id 0.40.0 had deleted), code MHT-7588 |
| Deny | "the player denied", the window closed, Claude Code said the sign-in was denied |
| No answer | the request lapsed after 2 minutes and the window closed |
| Allow | connected; `game_state` answered |
| Revoke, then Authenticate | asked to connect with no new registration (the 0.40.0 bug is gone), denied |

Seen: after Revoke, Claude Code's `/mcp` still showed `rednode-signin` as connected until the next question, which then got a 401 and showed it disconnected. Not a bug: the status is Claude Code's last known one, and a stateless HTTP server cannot tell a client its token was revoked; the next request finds out.

**Not checked in game:** taking back a forgotten client id (Claude Code registered again instead); the scratch check covers it.

## C1 test

Built 2026-10-12, host 0.4.0. Tested against a stand-in for the game with an MCP client that calls every tool (15 checks), packaged and unpackaged, with GPU sharing on and off: the token is required, and every tool answers.

In the game, in this order. Claude Code runs on the same PC; switch to it with **Alt+Tab**:

1. Start the game and load a save.
2. **F10**, open the launcher and its settings (the gear at the right of the Theme row), switch **MCP server** on, and press **Copy setup**.
3. Alt+Tab to a terminal, paste the command and run it. Then run `claude mcp list`: `rednode` shows as connected.
4. Start a **new** Claude Code session (MCP servers load when a session starts), and ask in turn:
   1. "Using the rednode tools, what are V's health, level and money?" It should look up the functions, then call the game. Claude Code asks before each `api_call`; allow them.
   2. "Show me the errors in the REDnode mod log." Switch Crash mod on and press **Throw an error** first, so there is one.
   3. "Capture the Hello mod window and tell me what it shows."
   4. "What does the game show right now, and what does the overlay cost?" Ask once in gameplay and once with the inventory open.
   5. "Close the Coords HUD, then open it again." Watch it go and come back in the game.
   6. "Give V 50 eddies." Claude Code should ask first; allow it, and check the money in Vitals.
5. Quit the game. In Claude Code, `claude mcp list` now shows `rednode` as failing to connect, which is expected while the game is closed.

**Result, 2026-10-12: passed.** Modded profile with CET, 3840 x 2160, host 0.4.0. `claude mcp list` showed `rednode: http://127.0.0.1:41820/mcp (HTTP) - ✔ Connected`. In a new Claude Code session, every question worked: V's health, level and money through `gameapi_lookup` and `api_call`; the Crash mod's error from `logs`; a description of the Hello mod window from `window_image`; the game state and the overlay's cost, in gameplay and with the inventory open; Coords closed and opened again through `apps` (the host log shows both, two seconds apart); and 50 eddies given after Claude Code asked. The host logged no failed MCP request, and the plugin no crash inside a game call.

## For developers

| Item | Where |
|---|---|
| The server | [packages/overlay/mcp.js](https://github.com/Edgemodders/REDnode/blob/main/packages/overlay/mcp.js): `@modelcontextprotocol/sdk` 1.32.1, Streamable HTTP, stateless, JSON responses, DNS rebinding protection |
| The game type lookup | [packages/overlay/gameapi-lookup.js](https://github.com/Edgemodders/REDnode/blob/main/packages/overlay/gameapi-lookup.js), reading the generated `game.d.ts` and `gameapi/notes`. Packaged, both ship in `host/resources/gameapi` |
| Switches | `--mcp=on` or `--mcp=off` on the host's command line overrides the launcher. The port can be changed in the host's `settings.json` (`mcp.port`) |
