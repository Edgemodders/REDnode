# PlayerPuppet

The player character, V. Scripts usually get it with `GetPlayer(gameInstance)`.

## OnGameAttached

Runs when the player puppet is attached to the game world. It does **not** mean a save has loaded, and it runs more than once per session:

| Player action | Runs |
|---|---|
| Game reaches the main menu | Yes, once |
| Load a save, from the main menu or the pause menu | Yes, once per load |
| Open the load-save list | No |
| Save the game | No |

Tested on 2.31 with a `@wrapMethod` probe. See [P1 results](https://edgemodders.github.io/REDnode/p1-results.html).

## OnDetach

Runs when the puppet leaves the world: a load starts, from the pause menu too, or the game goes back to the main menu. REDnode wraps it (`REDnode.reds`) to turn `game.state().world` off before the world goes, and sends the `PlayerPuppet.OnDetach` game event: value 1 when `GetPlayer` still gives this puppet, 2 when the game has no player any more. Not for another puppet while V is still there.

Found in REDnode's tests (laptop, game 2.5, 2026-10-30): it runs at the start of every load, from the main menu or the pause menu, at the return to the main menu and at quit, **on one of the game's worker threads**, and by then `GetPlayer` already gives nothing (value 2 every time). A scriptable system's `OnDetach` follows about 30 ms later on the game thread. The game thread itself is held by the load for about 0.3 s after it.
