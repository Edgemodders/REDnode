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

Runs when the puppet leaves the world: a load starts, from the pause menu too, or the game goes back to the main menu. REDnode wraps it (`REDnode.reds`, REDnode 0.47.0) to turn `game.state().world` off before the world goes, and sends the `PlayerPuppet.OnDetach` game event. It sends it only when `GetPlayer` still gives this puppet, so other puppets do not count. Whether it runs for every way of leaving the world is **unverified**.
