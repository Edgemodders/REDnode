# Sound API

Status: **S1 Play** passed in game on 2026-10-16 (REDnode 0.24.0), and its pan fix in REDnode 0.24.1 the same day. Open: the scanner's slow motion. Agreed with the user on 2026-10-14: REDnode builds its own audio engine first, for tighter integration with the EDGE platform and other plugins. [Audioware](https://github.com/cyb3rpsych0s1s/audioware) stays the fallback, as a dependency through `requires`, only if building our own proves prohibitive. Order: after the [TweakDB API](tweakdb.md) and overlay phase O11 Spaces.

## Clean-room rule

Audioware's repository has no license file and declares none (checked on 2026-10-14, release 1.9.9), which by default reserves every right. So:

- REDnode never reads, copies or ports Audioware's source code.
- The feature spec below comes only from [Audioware's public documentation](https://cyb3rpsych0s1s.github.io/audioware/) and its behavior in game, written in our own words. Each spec item says where it came from.
- REDnode's engine is built from that spec and from public libraries with clear licenses.

## What works today

| | Status |
|---|---|
| `game.audio.play(name)` | Plays one of the game's own sound events as a 2D UI sound. Tested in game; six names are confirmed (see `gameapi/notes/gameGameAudioSystem.md`) |
| UI kit sounds | `<rn-button sound="...">` and the kit's press and hover sounds, through the plugin's `audio.play` |
| The rest of the game's `AudioSystem` | 49 functions reachable through `api`: `Play` and `Stop` on an entity or emitter, `PlayOnEmitter`, `Parameter`, `GlobalParameter`, `Switch`, `State`, radio and playlists. **Untested** beyond `Play` |
| Your own audio files | S1 (REDnode 0.24.0, test pending): `audio.play` in the rednode package plays a package's WAV, OGG, MP3 and FLAC files through REDnode's own engine. See [Your own sounds](overlay-apps.md#your-own-sounds) |
| Audio from an overlay page | **Unverified** whether Chromium plays it in the host. If it does, it ignores the game's volume and pause |
| Tier 1 (in the game, synchronous) | None: Tier 1 is designed but not built |

## Feature spec

From Audioware's documentation (D) and what a modder needs (N). "Match" is to have in REDnode's first full version; "later" can follow.

| Feature | Source | Plan |
|---|---|---|
| Play an audio file from a package by an id, without REDmod. WAV, OGG, MP3 and FLAC | D | Match |
| A manifest of sounds per package (id to file, with settings) | D: a YAML file per mod folder | Match, in `rednode-app.json` or a `sounds` file beside it |
| Categories that follow the game's volume sliders: effects (SfxVolume), dialogue (DialogueVolume), music (MusicVolume), all scaled by MasterVolume | D: four tracks, sfx, onos, voices, music | Match |
| How audio is held: loaded once, loaded each time, or streamed | D: in-memory, on-demand, streaming | Match |
| Per-sound settings: volume, start delay, start offset, a region of the file, loop, playback rate (multiplier or semitones), stereo panning, fade in and fade out with an easing curve | D | Match |
| Settings given in code at play time, not only in the manifest | D: dynamic settings | Match: the options of `audio.play` |
| Sound on an entity (NPC, device, vehicle), louder when near, panned by direction, V as the listener | D: spatialization with registered emitters | Match |
| An entity's sounds end when it despawns; fade when it is defeated | D | Match, with the World API's entity events (W1) |
| Reverb from the game's reverb mix and environment presets | D | Later |
| Player EQ presets: on the phone, underwater | D | Later |
| Voice lines with subtitles, per locale and V's gender, with no fallback locale | D: needs Codeware's localization | Later. Decide whether REDnode shows subtitles itself or through the game |
| Hear the game's own sound events as they are queued, and mute or replace them | D: native integration, hooking the game's audio calls | Later, as a Tier 1 feature. Muting core events (switches, parameters) can break game audio (D) |
| Pause with the game's pause and menus; follow slow motion | N (not in the pages read) | Match. **Research** what the game exposes |
| A typed wrapper of the game's own events (`AudioSystem`): play and stop at V, an entity or a position; parameters, switches, states, radio | N | Match: works today through `api`, needs testing and types |
| Preview game sounds outside the game, and convert them for a package | N, EDGE platform | Later, through REDbridge's `audio.toWav` |
| Agents can list and play sounds | N, EDGE platform | Later: an MCP tool |

## Design

| Decision | Proposal | Why |
|---|---|---|
| Where the engine runs | In the REDnode plugin (C++), inside the game | It reads the camera and entity positions on the game thread every frame, so spatial sound stays in sync, and it pauses with the game. Tier 1 can use it later. The overlay host (Chromium's Web Audio) would be less code, but positions would arrive a frame late over the pipe, and sound would stop with the host |
| Audio library | [miniaudio](https://miniaud.io) (public domain or MIT-0, one C file): decoding WAV, MP3 and FLAC (OGG through its stb_vorbis companion), mixing, Windows output (WASAPI), 3D positioning with distance falloff and doppler | A permissive license that fits REDnode's own; no Rust toolchain in the plugin |
| A second engine beside Wwise | Yes, as Audioware does (D) | Feeding new sounds into Wwise means hooking it deeply. A second engine that follows the game's settings sounds like one game to the player |
| API | An `audio` module in the `rednode` package: `audio.play(id or path, { at, volume, loop, fadeIn, ... })` returns a handle with `stop({ fadeOut })` and `set(...)`; `audio.game.play(event, { at })` for the game's own events | One module for both kinds; Node mods and overlay apps alike |
| Coexisting with Audioware | Both engines can run side by side; a package uses one or the other | Players may have Audioware mods installed |

## Phases

| Phase | Builds | Test proves |
|---|---|---|
| **S1 Play** | The engine in the plugin; files from a package's folder; categories following the game's volume sliders; pause with the game; the settings of the spec; the `audio` module | A package plays an OGG that gets quieter with the game's effects slider and stops while the game is paused |
| **S2 Space** | Sound on entities and positions: distance, direction, doppler; cleanup on despawn; the typed wrapper of the game's own events | A sound on a spawned box gets louder as V walks to it and moves left and right as V turns |
| **S3 Effects and voices** | Reverb, EQ presets, voice lines with subtitles | Later |
| **S4 Game events** | Hearing, muting and replacing the game's own sound events, with Tier 1 | Later |

## EDGEwave and the Sound API

[EDGEwave](https://github.com/Edgemodders/EDGEwave) is EDGE's sound editor in VS Code: a modder edits, mixes and adds effects to a sound, then puts it into the game through REDmod or an archive. Agreed with the user on 2026-10-18: the two are halves of one job, not rivals.

| | EDGEwave | REDnode's Sound API |
|---|---|---|
| When | Before the game starts: the result is packed, and REDmod or the archive puts it in place | While the game runs: a package's code decides what plays, when and where |
| Result | Fixed: an event always sounds the new way | Conditional: only in this quest, near this object, while V is on a call |

Where the phases meet:

| REDnode | EDGEwave | Together |
|---|---|---|
| S1 Play, S2 Space | A6 plays game events and a package's sounds in the running game through REDnode | EDGEwave uses REDnode |
| S3 effects | A2 Mix's effect chains (high-pass, low-pass, EQ, distortion, compressor, reverb) and presets (Radio, Holocall, PA speaker, Muffled through a wall), rendered into the WAV in Web Audio (`src/audio/mix.ts`) | S3 applies the same chains live. **Decided:** S3's `effects` setting takes EDGEwave's effect objects as they are (`{ type: "lowpass", hz, q }`, `{ type: "reverb", seconds, mix }` and so on), and the presets keep EDGEwave's names and values, so a chain copied from EDGEwave works in `audio.play`. miniaudio has filters and EQ but no reverb, distortion or compressor, so those are REDnode's own; whether they sound like Web Audio's is unverified |
| S3 voice lines | No route: voice lines are `.wem` files, which need Wwise. EDGEwave's research list names "REDnode's Sound API" as a way around it | EDGEwave edits the line; a REDnode package plays it as WAV or OGG with subtitles |
| S4 game events | A3's REDmod routes replace an event (dropping its Wwise logic) or silence it (`mod_skip`), for the whole game | S4 does it live and per package, with Tier 1 hooks on the game's audio calls |

## Sound Tools: SP1 to SP4

Agreed with the user on 2026-10-19, after sound archives could be hot-swapped (H1d, [World API](world.md#h1d-test-results)): **REDnode Sound Tools**, an optional app pack for modders with three apps. It also answers EDGEwave's request for a Sound Tracer ([REDnode #14](https://github.com/Edgemodders/REDnode/issues/14)), the listening half of S4. The hooks and play calls go into REDnode itself, so any package can use them; the apps ship as the pack.

| App | What it does |
|---|---|
| **Sound Tracer** | Lists the game's sounds live, in two columns kept apart. **Played** shows the event name and hash, what posted it, its distance from V and the time. **Loaded** shows the sound id the game looked up. It has filter, pause, clear and copy a row, a **Play** button on each row, and a box where a pasted event name or sound id plays again. It only listens. Played without Loaded after a swap means the sound came from a reference kept from before; this tests the user's theory in the H1d results |
| **Sound Search** | Search by event name, event hash or sound id; the results are events with their variations. **Play** an event or one variation, and save results to a **Scratch** tab, kept across starts, to play later. Names come from WolvenKit's list through REDbridge (`sound.events`, game 1.6, so newer events show as hashes); ids and variations come from the game's live index, so they follow hot swaps |
| **Hot swap** | The Hot swap test app, made ready for players |

How the pack is made and shipped, decided with the user on 2026-10-20:

| Question | Decision |
|---|---|
| Where its source lives | In this repo, in its own folder, `packs/sound-tools/`, outside the REDnode build: `npm run overlay:package` and the player zip do not take it in. The apps move there from `packages/overlay/apps` (Sound Tracer, Hot swap test); Sound Search starts there |
| How it ships | Its own zip and its own Nexus page, with its own version and changelog section. The zip lays the apps out as `red4ext/plugins/REDnode/apps/<app>/`, so it installs into an existing REDnode (by hand, Vortex or Mod Organizer 2) without touching REDnode's own files |
| Requirements on its page | REDnode (the first release with SP2's and SP3's APIs), RED Hot Tools (for Hot swap), REDbridge (optional, for event names) |
| A too-old REDnode | Each app's manifest asks for `"requires": { "rednode": ">=<version>" }`, so the Mod Manager names the problem. Unverified: whether `requires` finds REDnode's own DLL version; checked in SP4 |
| Release gate | The same rule as REDnode's: no pack release until its apps' in-game tests have passed and a REDnode release carries the APIs they use |

Two kinds of id play differently:

| Kind | Played through |
|---|---|
| An **event** (a name, and its Wwise hash) | The game's `GameAudioSystem.Play(eventName, entityID?, emitterName?)`: the game's own mix and Wwise logic. It needs the name |
| A **sound** (one variation, such as 746693166) | Its bytes from the `.opuspak` (pak, offset and size from the live index), decoded from Opus and played by REDnode's engine: the raw recording, without the game's effects |

| Phase | Builds | Stops for |
|---|---|---|
| **SP1 Spike** | Find where events are posted with their names, and confirm the sound lookup (`0x279890` in 2.31) for loads; check `GameAudioSystem.Play` by name; read one variation's bytes and play them (does the archive keep the paks uncompressed, or does REDbridge extract them) | An in-game check |
| **SP2 Sound Tracer** | The hooks and `audio.trace` came with SP1. SP2 adds event names in the host (REDbridge's list, loaded when a trace starts, so no package needs the bridge permission for them), every post and load written to `rednode-sound-trace.log`, and the app: a window that never scrolls, two scrolling columns of the newest 2,000 rows, filter, pause, clear, copy, **Play** on each row and a paste box. What posted an event and its distance from V wait for a way from a Wwise game object to an entity (SP1 found they differ) | An in-game test |
| **SP3 Sound Search** | Search, play, the Scratch tab. An event's variations come from the index's event groups (found in SP2b) | An in-game test |
| **SP4 The pack** | Hot swap made ready for players; the pack's own zip and Nexus page source; a **Sound Tools** docs page (install, each app, workflows such as Tracer to Search to an EDGEwave override to a hot swap) with screenshots rendered from the apps, and placeholders for in-game shots until the user takes them; example app pages; a note on #14 | The user's release |

### SP1 spike: what the exe showed

Static reading of the 2.31 exe on 2026-10-19 (the helpers stay in the scratchpad; no game code is committed):

| Question | Answer |
|---|---|
| Can REDnode read a sound by id itself? | **Yes.** The 1,879 sound paks sit uncompressed in `archive/pc/content/audio_2_soundbanks.archive`, so a sound is a plain slice of that file: the index gives its pak, offset, RIFF header size and length, and an Ogg Opus stream follows the header. The katana sound (746693166: pak 881, offset 260133, 15,649 bytes) decoded to 1.87 s of mono audio in 67 ms with `opus-decoder` (MIT), with no REDbridge |
| Where are events posted? | Wwise's `PostEvent` by id at `+0x1ac8e70`: it looks the event up in Wwise's table, queues it and returns a new playing id (0 if Wwise is not running). The game's own wrapper (`+0x1ac8d90`) and Wwise's by-name versions (`+0x1ac9090`, `+0x1ac91c0`) all call it, so one hook sees every post. The by-name versions hash with `GetIDFromString` (`+0x1ac68a0`: lower case, FNV-1 32) |
| Where are sounds loaded? | The lookup at `+0x279890`, `bool (sound id, entry out)`. Its two callers are the pak tick's acquire (from memory) and the streaming IO hook's open, so one hook sees every load |
| Names for event ids | WolvenKit's list through REDbridge (`sound.events`, from game 1.6) for the spike. The game keeps its own table too: `audioAudioEventArray` pairs each event's `redId` (a CName) with its `wwiseId`. Reading it from the running game would name every 2.31 event (not researched yet) |
| Playing an event by name | The plugin's `audio.play` (from P1) already posts an event through `GameAudioSystem.Play` with no entity |
| `soundState`'s sound fields | They were shifted: what 0.26.8 printed as the offset (179386 for the katana) is the decoded size. The index in memory keeps the file's column order, so 0.26.9 names them `offset`, `headerSize`, `length` and `decodedBytes` |

### SP1 spike: built (REDnode 0.26.9)

| Part | What |
|---|---|
| `opus.cpp` | `LocateSoundTrace`: PostEvent and the lookup by their prologues (each unique in 2.31); the lookup must read the index count the opus tables found |
| `soundtrace.cpp` | The hooks, through RED4ext's hooking (REDnode's first), attached at the first `trace.start` and kept until the plugin stops; they record only while tracing. A detour calls the game's function first, then copies four numbers into a ring under a slim lock. The game thread sends the records about ten times a second as a `sound-trace` event |
| `game-sounds.js` (host) | A sound by id: the index and pak from the first archive in `archive/pc/mod` that has them (name order, unverified as the game's own order), else the game's own; decoded to WAV in a temp cache |
| `main.js` (host) | `sound.playGame`, `sound.event`, `sound.trace` for packages; the trace runs while any package traces and stops with the last one |
| `rednode` package | `audio.playGame(id)`, `audio.event(name)`, `audio.trace(onTrace)`, experimental |
| `apps/sound-spike` | The test app (not in the player zip): trace with live counts and the latest rows, a summary in the Mod log (most posted events with names, game objects, whether V's entity id is one of them), play an event, play a sound by id |
| Unit tests | The patterns on fake code, and on the real exe with `REDNODE_GAME_EXE` |

Checked in the mock game, unpackaged and packaged: the trace starts, sends batches and stops with the package; an event posts; the katana sound plays from the game's archive and ends; an unknown id is refused with the index's name. Unverified until the game: attaching the hooks while the game runs (RED4ext suspends the other threads for it, unverified), how many posts and loads a second, whether the ring drops records, what a Wwise game object id is, and how both play paths sound.

### SP1 test

REDnode 0.26.9 on the laptop (the plugin log's first line says "REDnode 0.26.9 loading"). The Sound spike app is in the update and starts closed. REDbridge gives the names: if the app says "No event names", use **Get REDbridge** in the Mod Manager and switch the app off and on.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step. Step 1 comes before it can be reached.
1. Load a save. In the Mod Manager switch on **Sound spike** and allow it the **bridge** permission in the launcher. Its first line says how many event names it loaded. Switch on the Test timer, **Start**, **Mark**.
2. Press **Start trace**. Stand still for 10 seconds, then walk, draw the katana, swing it, put it away, and open and close the inventory, about 30 seconds in all. Watch the counts line; note any stutter. Press **Stop trace**. **Mark**.
3. **Start trace** again. Shoot a gun near people or drive for about 30 seconds. **Stop trace**. **Mark**.
4. Type `ui_menu_onpress` in the event box and press **Play event**: a menu click? Then type an event name from the Mod log's "most posted" line and play it: what did you hear? **Mark**.
5. Type `746693166` in the sound box and press **Play sound**: the katana sound, without the game's effects? **Mark**.
6. Quit the game. Send `rednode-mods.log`, the plugin log (`rednode-*.log` of this session) and `rednode-overlay.log`.

### SP1 test: results

Run on 2026-10-20 on the laptop, REDnode 0.26.9. **Passed.** The user ran one trace of about two minutes (walking, the katana, the inventory) instead of steps 2 and 3, then the play steps.

| Check | Result |
|---|---|
| Attaching the hooks while the game runs | Both attached in under 1 ms at the first **Start trace** (`Sound trace: hooks attached in 0 ms`), and detached when the plugin stopped. No crash, no faults, a clean exit |
| Cost | None seen: 47 to 53 fps in the same spot before and during the trace; the user noticed no stutter |
| Rates | 117 s: 407 posts (about 3.5 a second) of 83 different events from 321 game objects, none failed; 314 loads of 141 sounds; **0 dropped** (the ring holds 16,384) |
| Loads not in the index | 50 of the 314 loads asked for a sound the opus index does not have. Likely sounds kept inside Wwise's own banks rather than the opus paks (unverified) |
| What a game object is | Not an entity id. V's entity id is 1; the game objects were numbers from 950 to about 1,250. They look like ids the game's audio code hands out to emitters (unverified), so "what posted it" and "distance from V" need the mapping from game object to entity first |
| Names | None: the app loaded its names at start, before the user allowed it the bridge permission, and never tried again. The ids alone came through. SP2 fixes it in the host (below) |
| Play event | `ui_menu_onpress` played the menu click through the game |
| Play sound | 746693166 played the raw katana sound (1.87 s, started in 245 ms with the decode); a mistyped id (74669316) was refused: not in the game's sound index |

The user's notes for SP2:

| Note | In SP2 |
|---|---|
| The window was too short for its contents, so the whole window scrolled, and the rows could not be scrolled | The window never scrolls; each column is its own scrolling list |
| Keep the history from growing without limit | Each column keeps the newest 2,000 rows |
| Are the rows logged anywhere? | They were not: the spike logged only the counts and its summary. SP2's host writes every post and load to `red4ext/logs/rednode-sound-trace.log`, with names |

### SP2 Sound Tracer: built (REDnode 0.26.10)

| Part | What |
|---|---|
| `apps/sound-tracer` | The app, an overlay page with the UI kit (780 x 600, closed at start, no permissions). **Played** lists events with their time, name (or `#id`), id and game object; **Loaded** lists sound ids, greyed when not in the opus index. Each row has **Play** and **Copy**. The window never scrolls: each column scrolls on its own, keeps its newest 2,000 rows, and follows the newest row unless scrolled up. Filter, Pause (new rows wait and come in on Resume), Clear, and a box at the bottom that plays a pasted event name, event id (once the trace has shown its name) or sound id |
| Names (host) | `main.js` loads REDbridge's `sound.events` when a trace starts and adds `names` to each batch, so `audio.trace`'s posts carry `name`. A package needs no bridge permission for them. Without REDbridge the rows show ids, and the overlay log says why |
| Trace log (host) | Every post and load, with names and clock times, goes to `red4ext/logs/rednode-sound-trace.log`; the last session's file is kept as `rednode-sound-trace.prev.log` |
| `ui.copy(text)` | New in the `rednode` package: writes the Windows clipboard through the host, for mods and pages (an overlay window's own `navigator.clipboard` is not reliable). Write only |
| The spike app | Takes names from the batches too |

Checked in the mock game (the host with REDbridge's 17,586 names: a known event named in the batches and the log; the clipboard written; the old log kept) and in the example page's simulation (the window does not scroll, the columns do, filter, pause, paste and row buttons). Not yet seen in the game.

### SP2 test

REDnode 0.26.10 on the laptop (the plugin log's first line says "REDnode 0.26.10 loading"). REDbridge must be installed for names (Get REDbridge in the Mod Manager). Then:

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. Load a save. In the Mod Manager switch on **Sound Tracer**; it opens without asking for a permission. **Mark**.
2. Press **Start trace**. Walk, draw the katana, swing it, put it away, open and close the inventory, about 30 seconds. Does the window stay put while both columns fill and scroll? After a few seconds, does the line under the buttons count named events? **Mark**.
3. Scroll the Played column up: it should stay where you put it while rows come in. Scroll back to the bottom: it follows again. Type `katana` in the filter, then clear it. **Mark**.
4. Press **Pause**, wait about 5 seconds, press **Resume**: the rows from the pause appear. **Mark**.
5. Press **Play** on a named row in Played, then on a row in Loaded. What did you hear? **Mark**.
6. Press **Copy** on a row in Loaded, paste it into the box at the bottom (Ctrl+V) and press Enter: the same sound plays. **Mark**.
7. Press **Stop trace** and quit the game. Send `rednode-sound-trace.log`, `rednode-mods.log`, the plugin log (`rednode-*.log` of this session) and `rednode-overlay.log`.

### SP2 first run: what the user saw (0.26.10)

On 2026-10-20 on the laptop, before the full steps (no logs sent). The user's earlier notes about the window and the rows that could not scroll were about the **Sound spike** app, not the Tracer; the Tracer was built to them anyway. A screenshot of the spike in 0.26.10 showed 26 of 27 events named, so the host's names work in the game.

| Seen | Cause | In 0.26.11 |
|---|---|---|
| The Tracer was too narrow: a sideways scroll bar | The two columns were `3fr 2fr`, which cannot shrink below their rows' content, so long rows pushed the window body wider than the window | Columns of `minmax(0, …)`, lists that never scroll sideways, ids that never shrink; the window is 900 wide. Measured with no sideways overflow at 900 and at 780 |
| **Play** on a Played row was silent | `audio.event` posted the event with no entity. A menu click needs none, but footsteps, foley and weapons are positional and need an emitter to be heard | `audio.event` posts on V by default (`AudioSystem.Play` with V's entity id); `{ on: "none" }` keeps the old way. Unverified until the retest: some events may still need switches or states the game sets first |
| Loaded sounds play, but long ones cannot be stopped | No stop | A **Stop** beside each **Play** (on while that row's sound plays; for an event, until stopped) and **Stop all** at the bottom. `audio.event` returns `stop()`, through the game's `AudioSystem.Stop` on the same entity |

Also found while checking: the new Stop code clashed with an existing name in the page, which would have stopped the whole app from loading; caught by the preview, fixed before the build.

### SP2 retest (REDnode 0.26.12, or 0.26.13)

REDnode 0.26.13 retires the **Sound spike** app (agreed with the user on 2026-10-20: the Tracer does all it did) and, for the user's note that its window scrolled whole, adds `ui.list` to the UI builder: a scrolling list of lines that fills a window's free height (sample `apps/list-mod`). The retest steps below are the same on 0.26.13; delete `red4ext/plugins/REDnode/apps/sound-spike` from the game folder, since extracting an update does not remove it.

REDnode 0.26.12 adds what the user asked next: the Tracer had no close button (its window lacked the kit's `closable` attribute, copied from the UI kit app). Sound Tracer 0.2.1 has one. Closing it switches the app off, which stops the trace and its sounds; and since an event posted on V plays in the game, the host now stops every event a package posted (through `AudioSystem.Stop`) when the package stops, for any package. Checked in the mock game: a mod that posted an ambience and crashed had it stopped.

REDnode 0.26.12 on the laptop (the plugin log's first line says "REDnode 0.26.12 loading"). Steps 1 to 4 and 6 are the SP2 test's; 5 and 7 are new.

0. Switch on **Test timer** in the launcher, press **Start**, and press **Mark** after each step.
1. Load a save. In the Mod Manager switch on **Sound Tracer**. Is the whole window visible, with no sideways scroll bar? **Mark**.
2. Press **Start trace**. Walk, draw the katana, swing it, put it away, open and close the inventory, about 30 seconds. Does the window stay put while both columns fill and scroll? Does the line under the buttons count named events? **Mark**.
3. Scroll the Played column up: it should stay where you put it while rows come in. Scroll back to the bottom: it follows again. Type `katana` in the filter, then clear it. **Mark**.
4. Press **Pause**, wait about 5 seconds, press **Resume**: the rows from the pause appear. **Mark**.
5. Press **Play** on three named rows in Played: a footstep or foley one, a katana one, an ambience one. Which could you hear? Press **Stop** on any that keeps playing. Then press **Play** on a long row in Loaded and **Stop** it, and try **Stop all**. **Mark**.
6. Press **Copy** on a row in Loaded, paste it into the box at the bottom (Ctrl+V) and press Enter: the same sound plays. **Mark**.
7. Press **Play** on an ambience row in Played and leave it playing. Close the Tracer with the **✕** in its title bar: the trace stops and the ambience stops with it. **Mark**.
8. Quit the game. Send `rednode-sound-trace.log`, `rednode-mods.log`, the plugin log (`rednode-*.log` of this session) and `rednode-overlay.log`.

### SP2 retest: results (0.26.13)

Run on 2026-10-20 on the laptop. **Passed except one point**: the window fits, the columns scroll and follow, names show (17,586 from REDbridge, which took 25 s to start cold, so the first rows of the first trace had ids only), the filter, Pause and Resume, Play and Stop on Loaded rows, Stop all, Copy and paste, and the close button, which ended the trace. The **Live log mod** passed too (`ui.list`). The plugin and host logs show no errors.

| Seen | Cause | Next |
|---|---|---|
| **Play** on Played rows still silent, posted on V | Many traced events cannot sound on their own. Read from the game's own sound index (`sfx_container.opusinfo`, whose end lists each event's Wwise id with the sound ids it plays): of the 116 events in the trace, 80 have recordings there; most of the rest are `…_stop` events, which play nothing, and `vo_global_tv` (SP1's most posted) has none, its voice coming from elsewhere. The others likely need the emitter's own state (a surface, a movement) that V does not have (unverified) | 0.26.14 plays an event's own recordings through REDnode's engine (below) |
| A 372 ms hitch when the first trace started | The first `trace.start` finds the sound pak tables by byte pattern on the game thread (266 ms) before attaching the hooks | Later: run that search off the game thread. Once per session |

The user asked for a way to hear an event without being near where the game plays it. The index's event groups give exactly that, with no name needed: every one of its 73,139 sounds belongs to some event's group (20,569 groups; footsteps and NPC foley have 10 to 15 recordings each).

### SP2b: an event's recordings (REDnode 0.26.14)

| Part | What |
|---|---|
| `game-sounds.js` | Reads the index's event groups with the sounds; `eventSounds(gameDir, event)` by name or Wwise id |
| Host | `sound.playGame` takes `event` (and an optional `variation`); without one, an event's recordings come in turn per package. `sound.eventSounds`. Each trace batch carries `recordings`, how many recordings each posted event has |
| `rednode` package | `audio.playGame({ event, variation? })`, answering with `sound`, `variation` and `variations`; `audio.eventSounds(event)`; trace posts' `recordings` |
| Sound Tracer 0.3.0 | **▶** on a Played row plays the event's recordings in turn, raw, heard only by the player, wherever the sound is in the game; greyed when it has none. **G** keeps the old way, posted through the game on V. The paste box takes an event name or id first, then a sound id |

Checked in the mock game against the dev PC's real game index (`lcm_fs_bare_feet_concrete_walk`: 14 recordings, played in turn; the katana sound 746693166 is the first of event 1337780739's three; `vo_global_tv` refused with the reason) and in the docs simulation. This settles SP3's question of how an event finds its variations.

### SP2b test (REDnode 0.26.14)

0. Switch on **Test timer**, press **Start**, and press **Mark** after each step.
1. Load a save. Open the **Sound Tracer** and press **Start trace**. Walk around people for about 20 seconds. **Mark**.
2. On three Played rows with a name, a footstep or foley one (`lcm_…`), a car or metro one (`v_…`) and any other, press **▶** a few times each: do you hear a recording each press, a different one in turn? The line at the bottom says which recording. **Mark**.
3. Find a greyed **▶** (a `…_stop` row, or `vo_global_tv`): hover it for the reason. Press **G** on a named row to compare with the game's own post. **Mark**.
4. Type `lcm_fs_bare_feet_concrete_walk` in the box at the bottom and press Enter a few times: footsteps, a different one each time. **Mark**.
5. Quit the game. Send `rednode-mods.log`, the plugin log and `rednode-overlay.log`.

**Requested of EDGEwave** ([EDGEwave #2](https://github.com/Edgemodders/EDGEwave/issues/2)): a fifth Into the Game route, **As a REDnode sound**, writing the render into a REDnode package's folder with a `sounds` entry in its manifest. S1 already plays it; nothing to pack.

## Research before S1

| Question | How to find out |
|---|---|
| Where the game keeps its volume sliders and how to read them (and hear changes) | The game's settings system in `gameapi`; test in game |
| How to tell the game is paused, in a menu, or in slow motion | The UI state REDnode already tracks for `hideWith`, and the time system |
| The listener's position: the camera or V | The camera system; compare with how the game's own 3D sounds pan |
| Whether miniaudio's WASAPI output coexists with the game's own output on every common setup (exclusive mode, Bluetooth headsets) | A spike in the plugin |
| Whether overlay pages can play audio at all, and whether REDnode should allow it | A test in the overlay host |

## S1 research spike: built

REDnode 0.23.0 answers the first four questions in game. The fifth (audio in overlay pages) waits for S1 itself.

| Piece | What it does |
|---|---|
| `native/src/overlay/audio.cpp` | REDnode's own output on miniaudio 0.11.25 (public domain or MIT-0), started on first use, stopped with the overlay. One bridge method for now, `audio.tone` (`hz`, `ms`, `volume`), which answers the output device and its format. The plugin log gets an `Audio: output started on "<device>"` line |
| `packages/overlay/apps/sound-test` | A Node mod with a window. **Play test tone** and **Low** play a 440 Hz and a 220 Hz tone. **Read settings** lists every setting under the game's `/audio` group with its value and type. Every half second it reads whether the game is paused, the time dilation and the camera position, and logs each change |

The sample reads the settings through `GameInstance.GetSettingsSystem().GetGroup('/audio')`, the pause through `TimeSystem.IsPausedState()`, the dilation through `TimeSystem.GetActiveTimeDilation`, and the camera through `CameraSystem.GetActiveCameraWorldTransform`. Which of these answer usefully in game is what the test finds out.

REDnode 0.23.1 fixes what the first try showed. The settings system's groups and settings are new objects made by each call, and the plugin held them only weakly, so they were gone before the next call ("that game object no longer exists"). Objects a call makes that nothing in the game holds are now kept until the mod lets go of them. The camera's position comes back through `api.$out`, because `GetActiveCameraWorldTransform` writes into a parameter the game does not mark as out. The sample now waits for a loaded save before it calls the game.

### Test

Switch on **Test timer** and **Sound test** in the launcher. Press **Start** on the timer, and **Mark** after each step.

| Step | Do | Look for |
|---|---|---|
| 1 | Load a save. In the Sound test window, press **Read settings** | A list of audio settings with names and numbers (the master, music, effects and dialogue volumes, among others) |
| 2 | Open the game's Settings, Sound. Move the master volume and the effects volume to different values. Back in the game, press **Read settings** again | The two values changed in the list |
| 3 | Press **Play test tone**, then **Low**, with game sound playing around you | Two short beeps, clean, without crackling, and the game's own sound keeps playing. Note if the game's sound dips or stops |
| 4 | Open the pause menu, wait a moment, close it. Then open the map and close it | The window's "time" line says paused, then not paused (the Mod log has each change) |
| 5 | Slow time if you can (a Sandevistan, or the slow motion at a dodge or a scanner). Otherwise skip | The dilation number changes below 1 |
| 6 | Walk a few steps, then turn the camera around | The camera line's numbers change as you walk, and stay put as you only turn |
| 7 | Alt+Tab out of the game and back, then press **Play test tone** | The tone still plays |
| 8 | If you have headphones or a second output, switch Windows' output to it, then press **Play test tone** | Note where the tone plays: the new output or the old one |

Then quit the game, so the logs are complete.

### S1 spike: results

Tested in game on 2026-10-16 with REDnode 0.23.1, game 2.31. Steps 1 to 4, 6 and 7 passed. Step 5 found a gap. Step 8 was skipped.

| Step | Result |
|---|---|
| 1 Settings | Passed. `/audio` has three groups: `volume` (`MasterVolume`, `SfxVolume`, `DialogueVolume`, `MusicVolume`, `CarRadioVolume`, `RadioportVolume`, each an Int from 0 to 100), `dynamicrange` (`SpeakerSetup`, a ListString such as `Headphones`; `EnableControllerSpeaker`) and `misc` (`MuteDetectionUISounds`, `StreamerMode`, `MuteInBackground`, Bools) |
| 2 Changes | Passed. After the player set master to 50 and effects to 55 in Settings, the next read showed 50 and 55 |
| 3 Tone | Passed. Both tones played cleanly beside the game's sound, which kept playing. The output was the Windows default device, "Optoma UHD (NVIDIA High Definition Audio)", 48 kHz, 8 channels; miniaudio spread the mono tone over it |
| 4 Pause | Partly. `TimeSystem.IsPausedState()` stayed false the whole time, also in the pause menu. `GetActiveTimeDilation('', false)` read 0 while a menu was open, and the overlay's `menu` state turned true for each menu. In one of the two menus the dilation stayed 1; which one is **unverified** |
| 5 Slow motion | Gap. The scanner slowed the game, but `GetActiveTimeDilation('', false)` stayed 1. The scanner's slow motion is not the global dilation. A Sandevistan was not tried |
| 6 Camera | Passed. `GetActiveCameraWorldTransform(api.$out)` gave the camera's position: it changed while walking and stayed put while only turning |
| 7 Alt+Tab | Passed. The tone played after Alt+Tab and back |
| 8 Output switch | Skipped. Whether REDnode's output follows a change of the Windows default device is **unverified** |

Two more findings. Right after a save loaded, the first settings read timed out (the overlay's state no longer said main menu, but the game did not answer yet); a read 2 minutes later worked. And the 0.23.0 try showed that the settings system makes new objects at each call, which led to 0.23.1's fix.

**What this means for S1:**

| Question | Answer for S1 |
|---|---|
| Volume sliders | Read `/audio/volume` through the settings system. Categories: master times one of effects, dialogue or music (and the two radios). Read again when the player leaves the Settings menu (the overlay sees the menu close), or listen with `ConfigVarListener` (**unverified**) |
| Mute in background | Honor `/audio/misc/MuteInBackground` with the plugin's own focus tracking ("the game left the front") |
| Pause | Not `IsPausedState`. Pause REDnode's sounds while the global dilation is 0, or while a menu is open, as a package setting (`pauseWith`) |
| Slow motion | The Sandevistan is the global dilation: 0.3 while active (found in S1's test). The scanner's slow motion is not; where it shows is open. Pitch that follows slow motion is not in S1 |
| Listener | The active camera's transform, for S2 |
| Output | miniaudio on the default device works beside Wwise, including an 8-channel HDMI device. Following a device change is still to test. Since 0.24.1 REDnode mixes in stereo and plays on the device's front pair (see the S1 results) |

## S1 Play: built

REDnode 0.24.0. How to use it: [Your own sounds](overlay-apps.md#your-own-sounds).

| Piece | What it does |
|---|---|
| `native/src/overlay/audio.cpp` | The engine on miniaudio 0.11.25, with stb_vorbis for OGG. The mix is stereo, played on the device's front left and right speakers (0.24.1). Files open on a loader thread. Three groups (effects, dialogue, music) under the engine's master volume. Each frame on the game thread: sounds pause while a menu or loading screen is up (the overlay's own game state) and the ones that ended are announced as `sound-end` events. Mute in background follows the game window's focus. Bridge methods `sound.play`, `sound.stop`, `sound.set`, `sound.list`, `sound.mix` |
| `packages/overlay/main.js` | Finds a sound's file (a manifest name or a path, which must stay inside the package's folder), merges the manifest's settings with the call's, turns semitones into a rate, and checks that a package only stops and changes its own sounds. Reads the game's sliders and Mute in background through the settings system before the first sound, and again after a menu closes or a save loads (`Sound: the game's volumes are ...` in the overlay log). Stops a package's sounds when it stops. A manifest's `sounds` are checked when the package is found |
| `packages/rednode/src/audio.ts` | `audio.play`, `audio.stopAll`, `audio.playing`, and a `Sound` with `stop`, `set` and `ended` |
| `apps/sound-test` | 0.2.0: buttons for each format and setting, the list of what plays, and the game's and V's time dilation for the Sandevistan check |
| `tools/sounds/make-sample-sounds.py` | Synthesizes the sample's four files, so they are REDnode's own |
| `native/tests/audio_test.cpp` | Decodes the four files with the plugin's set-up: format, length, not silent. Since 0.24.1 also pan on the stereo mix, and the stereo mix reaching only the front pair of a 7.1 device |

Not in S1: easing curves for fades (miniaudio fades are linear), pitch that follows slow motion, sound on entities and positions (S2). The sliders are applied as linear gain; whether that matches how the game's own sound scales is for the test.

### S1 test

Switch on **Test timer** and **Sound test** in the launcher, press **Start**, and press **Mark** after each step.

| Step | Do | Look for |
|---|---|---|
| 1 | Load a save. Press **Music (OGG)** | Music fades in over a second and a half and loops without a gap or click at the loop point (every 8 seconds). The list shows it playing |
| 2 | Press **Beep (WAV)**, **Chime (FLAC)** and **Voice (MP3)**, one after another, with the music on | Each plays once over the music. The voice is a synthetic "ah, oh" |
| 3 | Press **Voice +12 semitones**, **Chime left**, **Chime right**, **Beep in 2 s** | The voice an octave higher and twice as fast; the chime in the left ear, then the right; the beep two seconds after the press |
| 4 | Press **Music quieter**, wait, then **Music louder** | The music fades down over a second, then back up |
| 5 | Open the pause menu for a few seconds, then close it. Do the same with the map | The music stops while the menu is open and goes on from where it was when it closes |
| 6 | In Settings, Sound, lower **Music volume** to about 30, close the menus | The music is quieter. Then lower **Sound effects volume** and press **Chime (FLAC)**: the chime is quieter too. Put both back |
| 7 | In Settings, Sound, lower **Master volume** to about 30, close the menus, press **Beep (WAV)** | Music and beep are quieter. Compare by ear with the game's own sound: do ours and the game's drop by about the same amount? Put it back |
| 8 | Turn on **Mute in background** in Settings, Sound if it is off. Alt+Tab out for a few seconds with the music on, then come back | The music is silent while the game is in the background, and plays again when it is back |
| 9 | Press **Stop all** | Everything fades out over half a second. The list says nothing is playing |
| 10 | Press **Music (OGG)**, then switch the Sound test off in the launcher | The music stops (fades out) when the package stops |
| 11 | If you can: use a Sandevistan with the Sound test on | Note the "global dilation" and "V's dilation" lines while it is active |

Then quit the game, so the logs are complete.

### S1 Play: results

Tested in game on 2026-10-16 with REDnode 0.24.0, game 2.31. The Test timer was not used, so the log lines are not tied to steps. Steps 1 to 10 passed by ear, except the pan in step 3. Step 11 was not done.

| Step | Result |
|---|---|
| 1 Music | Passed. Fade in and a clean loop |
| 2 Formats | Passed. WAV, FLAC and MP3 over the OGG music |
| 3 Settings | Pitch (+12 semitones) and the 2 s delay passed. **Pan failed:** "Chime left" and "Chime right" sounded the same, both a little to the right |
| 4 Fades | Passed |
| 5 Menus | Passed. The music stopped in the pause menu and the map, and went on from where it was |
| 6 Sliders | Passed by ear. A chime pressed while the Settings menu was open waited for the menu to close, as `pauseInMenu` says: the log has three chimes from the menu ending together when it closed |
| 7 Master | Passed by ear: ours and the game's sound dropped together. The linear gain is close enough for now |
| 8 Mute in background | Passed. The overlay log read `muted in the background`; the music was silent while the game was in the background |
| 9 Stop all | Passed |
| 10 Package stops | Passed. The music stopped when the Sound test was switched off |
| 11 Sandevistan | Done afterwards, the same day. The global dilation read 0.30 for 2 to 3 seconds on each of two activations, then 1.00. V's dilation stayed 1.00 and V did not ignore the global dilation. So the global dilation is the signal for the Sandevistan; V's own value does not show that V moves at normal speed |

**Why pan failed.** The device was the 8-channel HDMI output. miniaudio's engine mixed at the device's 8 channels, and its panner works only on a stereo mix: for other channel counts it copies the sound through unchanged. Our mono files were spread over all 8 speakers, whatever the pan.

**The fix, REDnode 0.24.1.** The plugin opens the device itself, mixes in stereo, and maps the mix to the device's front left and right speakers with miniaudio's "simple" channel mode. Its default mode would also fill the centre and surround speakers from a stereo mix. Every speaker layout has the front pair, and a downmix to headphones keeps it. S2's direction is then left and right only, like most games on headphones; surround output can come later as a setting. The unit test now checks pan on the stereo mix and the stereo-to-7.1 conversion. The plugin log line now reads `..., 8 channels, mixed in stereo to the front pair`.

**Open from this run.**

| Question | Status |
|---|---|
| The volume reads | Answered by a retest the same day (below): the reads are right. The earlier 45 and 60 readings were the player's own settings |
| Slow motion | The Sandevistan: answered (step 11). The scanner's slow motion: still not found; the global dilation stays 1 |
| A change of the Windows default device | Open |

### S1 check, REDnode 0.24.1

Switch on **Test timer** first, press **Start**, and press **Mark** after each step.

| Step | Do | Look for |
|---|---|---|
| 1 | Load a save, switch on **Sound test**. Press **Chime left**, then **Chime right**, then **Chime (FLAC)** | Left speaker only, right speaker only, then both. The plugin log says `mixed in stereo to the front pair` |
| 2 | In Settings, Sound, set **Music volume** to 30 and leave the others. Close the menus | The overlay log reads `master 100, effects 100, dialogue 100, music 30`. Put it back |
| 3 | Hold the scanner for a few seconds with the Sound test on | Note whether "V's dilation" changes (the global dilation did not in the spike) |

Then quit the game, so the logs are complete.

**Result, 2026-10-16.** Step 1 passed: left only, right only, then both; the plugin log says `8 channels, mixed in stereo to the front pair`. Step 2 left no answer: the overlay log has no new volume read after the Settings visit, and only step 1 was marked, so whether the music slider was changed is not known. Step 3: the scanner did not slow time in this run, and NPCs walked at normal speed while V seemed slower. The player suspects one of their mods; the scanner's slow motion stays open.

**Music retest, 2026-10-16.** REDnode 0.24.1, marked with the Test timer. Step 1, a beep, made the host read the volumes: all 100. Step 2, Music set to 30 in Settings: the read after the menu closed showed `music 30` and the rest at 100. Step 3, Music back: `music 100`. The volume reads follow each slider. A run with no sound played reads nothing: the host reads the volumes only once a package has played a sound (0.24.1). REDnode 0.24.2 also reads them when a save loads and logs every read.
