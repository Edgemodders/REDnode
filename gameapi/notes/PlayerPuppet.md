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

Runs when the puppet leaves the world: a load starts, from the pause menu too, or the game goes back to the main menu (**unverified**). REDnode wraps it (`REDnode.reds`) to turn `game.state().world` off before the world goes, and sends the `PlayerPuppet.OnDetach` game event: value 1 when `GetPlayer` still gives this puppet, 2 when the game has no player any more. Not for another puppet while V is still there.

In REDnode 0.47.0's test (laptop, game 2.5, 2026-10-30) the wrap sent nothing at three loads and two returns to the main menu, when it sent only for value 1: either `GetPlayer` no longer gives the puppet when it runs, or it does not run then. 0.47.1 sends value 2 as well, and REDnode's scriptable system sends `REDnode.SessionEnd` from its own `OnDetach`; the retest says which comes.
