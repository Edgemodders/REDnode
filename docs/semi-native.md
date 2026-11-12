# Semi-native apps

Status: **design agreed with the owner on 2026-11-12; nothing built yet.** Raised by the owner on 2026-11-10 with EDGEhack's Netrunner bench add-on, and on the schedule after [#24](https://github.com/Edgemodders/REDnode/issues/24). The spikes come first, and the cursor spike (S1) decides whether the rest goes ahead as drawn here.

## What they are

A semi-native app is a REDnode app that looks and feels like part of the game's own UI, but is drawn by REDnode as a web page. The player never presses F10 for it.

| Quality | What it means |
|---|---|
| Shown by the game or by code | It appears on a game event (a click on one of the game's own ink buttons, a recipe selected in the crafting menu, a menu opening) or when a mod's own code shows it. It is never one of the F10 overlay's windows |
| One cursor, where the game has one | On the game's screens with a cursor (the pause menu, the main menu, the inventory, the crafting bench): while the cursor is outside the app it belongs to the game, and when it crosses into the app the app gets it, with no F10 or key, and the cursor looks the same all the way |
| Mapped inputs in the world | In gameplay there is no cursor, as in the game itself. A key or button (or another trigger) shows the app, and while it shows it answers its own mapped keys and controller buttons, the way the game's quickhack wheel and interaction prompts do |
| Input is optional | An app need not take any input at all: a holocall, a video, a visual effect only shows. Taking input is something an app asks for (the cursor on game screens, mapped keys in the world). An app that asks for none never stops the cursor or a key from reaching the game, so its clicks pass straight through, as a HUD widget's do |
| The game's look | Its elements look exactly like the game's ink: the same colors, text, frames and cursor. It can use REDnode's ink markup (`.ink.html`) drawn in HTML |
| More than ink can do | Being a web page, it can also draw anything ink cannot: three.js scenes, canvas animation, video, mini-games, holocalls |
| Managed like any package | It is listed in the Mod Manager, switched on and off and given permissions there, and its logs, debugger and hot reload work like any other package's |

## How it differs from what exists

| | F10 overlay window | HUD widget | REDnode ink (`ink` API) | **Semi-native app** |
|---|---|---|---|---|
| Drawn by | Chromium, composited by the plugin | Chromium | The game's ink | Chromium |
| Shown | While the player is in the overlay (or pinned to the HUD) | Always, hidden in menus and scenes as asked | When the package builds it | **On a game event or a call** |
| Takes input | In F10's interactive mode only | Never | Through the game's own input | **On game screens, when the cursor is over it; in the world, its mapped keys and buttons while it shows. No F10** |
| Cursor | REDnode's arrow, drawn by the plugin | None | The game's own | **On game screens, the game's, continued over the app; in the world, none** |
| Look | Any (the UI kit) | Any | The game's, exactly | The game's, copied; plus anything a page can draw |

So the parts that are new are showing on a trigger, input with no F10 (mapped keys in the world), and the cursor crossing over on game screens. HUD widgets already show outside F10 and never take input, and overlay windows already take input in interactive mode. A semi-native app sits between them.

## What we already have

| Piece | Where it is today | What it gives semi-native apps |
|---|---|---|
| Transparent, borderless pages of any shape | O1 to O4 (`docs/overlay.md`) | The app's surface |
| Clicks pass through transparent areas | The plugin's alpha map (0.12.1) | The hit test that says whether the cursor is "in" the app |
| Windows shown outside F10, hidden with menus, scenes or photo mode | HUD widgets, `hideWith`, the plugin's `ui-state` | Showing without the overlay, and hiding rules |
| A cursor drawn from a texture by the compositor | `native/src/overlay/cursor.hpp` (0.26.7) | Drawing the game's cursor over the app |
| Placing things per frame from game-thread reads | World pins (WP1, WP2: `ReadCamera`, `pins.cpp`) | The pattern for reading the game cursor's place every frame |
| Reading the game's ink: layers, trees, the widget under a point | UT2 (`ink.layers`, `ink.read`, `ink.at`, `inkread.cpp`) | Finding the game's cursor layer and the buttons to listen on |
| A script class that hears ink callbacks | `REDnodeInkListener` (`native/scripts/REDnodeInk.reds`) | Listening on a game button's `OnRelease`, if it can be registered on the game's own widgets (S4) |
| Script events into REDnode | `REDnode_Emit`, `REDnode_EntityText` | A mod's own redscript calling REDnode to show an app |
| The game's colors and text styles | The game look (`docs/ink.md`, "The game look"), from `main_colors.inkstyle` | The look in HTML |
| Ink markup | UT1 (`ink.parse`, `ink.load`, `.ink.html`) | One markup for an ink screen and its HTML copy |
| Full-screen pages, solo mode, pointer lock | #32, O10, pointer lock | Mini-games and full-screen moments |

## How it would work

### Two places an app can show

An app follows the game's own rule for input: a cursor only where the game shows one (decided with the owner on 2026-11-12).

| | Over a game screen with a cursor (the pause menu, the main menu, the inventory, the crafting bench, a popup with a cursor) | In the world (gameplay) |
|---|---|---|
| The game's cursor | Exists. The game draws it as ink and moves it from the mouse. The Windows cursor is hidden and free (the cursor-flicker run, `docs/overlay.md`) | None. The mouse turns the camera, and the game holds the Windows cursor at the screen's centre |
| How the app takes input | The game's cursor carries on over the app (the cursor crossover) | No cursor. The app is shown by a key or button (or a game event or a call), and while it shows it answers its mapped keys and controller buttons, as the game's quickhack wheel and interaction prompts do. The camera and movement stay the game's unless the app needs those keys too (S3) |
| Examples | A panel beside the crafting menu's recipe list, a quickhack preview in the cyberdeck screen | A holocall (display only), a contextual panel with key prompts, a mini-game played with keys or a controller |

An app that only displays (a holocall, an animation) needs no input at all and works in both places from the start. An app that wants a cursor in the world can open a game screen that has one, or use F10's interactive mode as overlay windows do today.

### Showing

A package declares the app in its manifest, `"kind": "native"` (proposed), and shows and hides it from its code. The triggers would come in this order, from the cheapest:

| Trigger | How | Risk |
|---|---|---|
| A call from the package | `app.show()` / `app.hide()` in the `rednode` package, from a Node mod or the page itself | None: it is a window open and hide |
| A key or controller button in the world | The app's manifest names its key (rebindable by the player, as the overlay's F10 could be), and the plugin shows the app on it | Low for keys (the plugin already hears F10 before the game). Controller buttons are not read by the plugin today (S3) |
| A game state | The `ui-state` the plugin already sends (menu, scene, photo mode), and which menu is open | Telling one menu from another is not read today (`IsInMenu` only). I1 found the menu list and scenarios, so it looks feasible (unverified) |
| A click on a game button | Find the button with UT2's reads, register a `REDnodeInkListener` on it for `OnRelease` | Unverified: whether a listener registered from outside on the game's widget fires, and how to find the button again after the menu rebuilds it (S4) |
| A mod's own redscript | A mod's `.reds` calls a REDnode function (like `REDnode_Emit`, with a package name and data), and REDnode passes it to the package | Low. It needs the modder to write redscript, but it can hook anything the game does |

### The cursor (game screens only)

The proposal is the owner's model. While the cursor straddles the app's edge, the game draws its own cursor under the app, and the app draws an exact copy over it, clipped to the app's opaque pixels. Where the app is transparent you see the game's cursor, and where it is opaque you see the copy. Lined up, they read as one cursor.

That works only if the copy is in the **same place in the same frame** and has the **same look** (the same image, hover state and click animation). The game's cursor is an ink widget (`CursorGameController`, with contexts such as hover, and click and hold animations), and the overlay is drawn after the whole game frame, so it always covers the game's cursor. What the spike has to settle:

| Question | Why it matters |
|---|---|
| Where is the game's cursor each frame, in screen pixels? | REDnode's own arrow is moved by summing raw mouse input, which drifts from the game's cursor (the game applies its own speed). The copy has to read the game's place, probably from the cursor widget or `inkCursorInfo.pos` on the game thread, as pins read the camera |
| Is that place read in the same frame the game draws it? | One frame late shows as a seam on the app's edge while moving |
| What does the cursor look like, and can we draw it? | Its images are in the player's game files (the cursor layer's `cursorResource`). REDnode cannot ship them, so it would read them from the player's game through REDbridge at first use, as Sound Search does with sounds |
| Can the game's cursor be hidden and shown? | The game has `inkMenuLayer_SetCursorVisibility` and a cursor widget we can set to opacity 0. That is the fallback: hide the game's cursor while it is over the app and draw the copy whole, so a lag or a look mismatch never shows twice |
| Whose hover state shows over the app? | Over the app, game widgets under it may still think they are hovered (the game's cursor turns to its hover look, and things under the app highlight). Over the app the copy should follow the app's own hover, not the game's |

There are three ways to draw it, in the order to try:

| | How | For | Against |
|---|---|---|---|
| **A. Copy over the straddle** (the owner's model) | The game's cursor is always drawn; the copy is drawn clipped to the app's opaque pixels | Seamless at the edge, the game's own cursor everywhere else | Needs a per-frame match of place and look |
| **B. Hand over at the edge** | While the cursor's point is over the app, hide the game's cursor and draw the copy whole | Forgiving: no seam to see | The swap is visible when the cursor straddles the edge (half the cursor over a transparent area) |
| **C. Draw the app under the game's cursor** | Composite the app between the game's other ink layers and its cursor layer, so the game's cursor is drawn on top by the game | The real cursor, perfect | Means hooking the game's UI render order. Research only, and likely too deep |

### Input

All of this applies only to an app that asks for input. An app that asks for none (a holocall, a video, an effect) takes nothing from the game, wherever it shows.

| While | Mouse movement | Buttons and wheel | Keys |
|---|---|---|---|
| The cursor is over the app's opaque pixels (over a game screen) | To the game (so its cursor keeps moving) **and** to the page | To the page only. The game must not get the click | To the game, unless the page has a focused text field or asked for keys (as Keyboard Lock does today) |
| The cursor is outside the app | To the game | To the game | To the game |
| An app shows in the world | To the game (the camera, as always) | To the game, unless the app maps them | The app's mapped keys and controller buttons to the page and not to the game; every other key to the game. Its close key (Esc or the one that opened it) hides it |

In the world, the mapped inputs should behave like the game's own contextual UI: while the quickhack wheel or an interaction prompt shows, its keys do its job and the rest of the game goes on. Which keys an app may take, and what happens when one is also a game action (F is Interact, R is Reload), is S3's question.

Splitting one mouse input into "movement to the game, buttons not" is new. Interactive mode blocks everything. If the game reads buttons and movement from the same raw input packets, the plugin has to change the packet (clear its buttons) rather than drop it (S2).

### The look

| Part | How |
|---|---|
| Colors, text sizes, weights | From the game look's table (`main_colors.inkstyle`), already in the `ink` API, made into CSS for the UI kit's `game` theme (the UI kit's game look was planned beside I4 in `docs/ink.md`) |
| Fonts | The game's fonts cannot ship with REDnode. Read them from the player's game files at first use (through REDbridge) and give them to the page as a local font (unverified: the game's font resources and whether they convert) |
| Frames, icons, textures | From the player's game the same way (REDbridge's `texture_to_png`), kept in a cache in the player's data folder, never in a package or a release |
| Ink markup in HTML | A renderer that draws an `.ink.html` tree as HTML elements with the game look, so one markup file gives an ink screen or a semi-native page. The docs simulation already draws ink trees in HTML (`docs/assets/examples/sim/runner.js`), which is a start |
| Scale | The game scales its UI to the screen. The app scales with it (the reference size the overlay already uses) |

## Spikes

Each spike is a test app and a small plugin change, run in game, before the build is planned in detail.

| Spike | Question | Decides |
|---|---|---|
| **S1 The cursor over a game screen** (first, deciding) | Over the inventory, with a test panel: where the game's cursor is each frame, the copy's offset and lag against the game's (measured with MCP `game_image` while moving), the game cursor's contexts (default, hover, click), hiding and showing it, reading its images through REDbridge | A, B or neither. If neither, semi-native apps over game screens keep REDnode's own cursor and an "enter" gesture, which loses the main point: the owner and Claude decide then whether to go on |
| **S2 Clicks to the app, movement to the game** | Can the plugin let the game's cursor keep moving while the app takes the buttons and wheel? How does the game read the mouse in menus (raw input messages, a buffer, window messages)? Do game widgets under the app react? | The input design. If the split fails, the fallback is to stop the game's cursor over the app and move the copy from raw input (B with REDnode's own movement) |
| **S3 Mapped inputs in the world** | Show a test app on a key, then give it a few keys while it shows: can the plugin take those keys from the game and let every other one through (it already takes F10)? What about a key that is also a game action? Controller buttons: the plugin does not read the controller today, so how does the game read it (XInput or another API), and can a button be taken from the game the same way? Or is it cleaner to go through the game's own input actions and contexts, as the quickhack wheel does (Codeware's input callbacks, unverified)? | How an app in the world answers keys and buttons without breaking the game's own |
| **S4 Listening on a game button** | Register a `REDnodeInkListener` on a game widget found with `ink.at` or `ink.read` (a button in the crafting menu), and hear its clicks. Find it again after the menu rebuilds | Whether "show on a game button's click" needs no redscript from the modder |
| **S5 The game's font and textures** (can wait for the build) | Read the game's font and a few frames and icons through REDbridge into the cache, and draw a game button in HTML beside the game's own | Whether the look can be exact, or close |

## Plan

Proposed phases, each tested in game before the next:

| Phase | What | Done when |
|---|---|---|
| **SN0 Spikes** | S1, then S2 to S4 (S5 can come with SN2) | The cursor way is chosen, or the owner decides the idea changes |
| **SN1 Show and display** | `"kind": "native"`, `app.show()`/`app.hide()`, showing on menus and game states, in the Mod Manager. No input yet | A holocall-style test app shows on a call and on a menu opening, with no F10 |
| **SN2 The look** | The UI kit's game theme, the game's font and textures from the player's game, `.ink.html` drawn as HTML | A game button in HTML next to the game's own looks the same |
| **SN3 The cursor over game screens** | The chosen cursor way and the input split | Over the crafting menu, the cursor crosses into a test panel, clicks it, and leaves, with no seam and no click reaching the game |
| **SN4 Mapped inputs in the world and game triggers** | S3's way (an app's own key to show it, its mapped keys and controller buttons while it shows), and showing on a game button's click (S4) or a mod's redscript | A mini-game in the world shows on its key, plays with keys and a controller while the rest of the game goes on, and closes; a crafting-menu button shows an app |
| **SN5 The Netrunner bench sample** | A sample built on all of it for EDGEhack's add-on (if the owner still wants it in native ink, a semi-native version as a second sample) | Docs page, examples, release |

## Decided with the owner

Agreed on 2026-11-12, every recommendation as drafted:

| Question | Decision |
|---|---|
| While F10's interactive mode is on, are semi-native apps shown? | Yes, under the overlay's windows, and not clickable then (the overlay owns the cursor in interactive mode) |
| Does F10's hidden mode hide them? | Yes, as it hides pins: the player's one switch to clear the screen of REDnode |
| Do they show in photo mode and scenes? | Hidden by default, as HUD widgets are, with `hideWith` to change it |
| Controller | In the world, in scope with S3 (mapped buttons). On game screens, after the mouse works: the game moves its cursor with the stick in menus, so A may carry over (unverified) |
| A cursor in the world | None, as in the game (decided with the owner on 2026-11-12). An app that needs one opens a game screen that has one, or is an F10 window |
| The kind's name | `"kind": "native"` |
| Can a semi-native app be dragged or resized? | No title bar. Only if the app moves itself (as `fill` pages do with `rn-window`) |
| Permission | One new switch, `native`, since an app that takes clicks from the game's own screens should be the player's choice |
