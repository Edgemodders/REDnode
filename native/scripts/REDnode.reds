// REDnode P1 probe.
// Exercises both tiers once when the player is attached to the world.
// Remove red4ext/plugins/REDnode from the game folder to disable it.

public static native func REDnode_Ping(value: Int32) -> Int32
public static native func REDnode_Emit(name: String, value: Int32) -> Void

@wrapMethod(PlayerPuppet)
protected cb func OnGameAttached() -> Bool {
  let result: Bool = wrappedMethod();

  // Tier 1 path: synchronous native call. The script uses the return value.
  let pong: Int32 = REDnode_Ping(21);

  // Tier 2 path: queued, then logged on the game thread by the pump and sent
  // to the overlay host, where Node mods get it with game.on("PlayerPuppet.OnGameAttached").
  REDnode_Emit("PlayerPuppet.OnGameAttached", pong);

  return result;
}

// V leaves the world: a load starts (from the pause menu too) or the game goes back to the
// main menu. Turns game.state().world off before the world goes (#25). Sent for the main
// player (value 1), or when the game has already let go of its player (value 2): 0.47.0
// sent only the first, and the laptop's test showed none at any load. Not for another
// puppet while V is still there.
@wrapMethod(PlayerPuppet)
protected cb func OnDetach() -> Bool {
  let main: ref<GameObject> = GetPlayer(this.GetGame());
  if !IsDefined(main) {
    REDnode_Emit("PlayerPuppet.OnDetach", 2);
  } else {
    if main == this {
      REDnode_Emit("PlayerPuppet.OnDetach", 1);
    }
  }
  return wrappedMethod();
}

// The game session ends: the game calls each scriptable system's OnDetach then, at the start
// of a load and when the game goes back to the main menu. A second signal for world (#25).
public class REDnodeSessionSystem extends ScriptableSystem {
  public func OnDetach() -> Void {
    REDnode_Emit("REDnode.SessionEnd", 0);
  }
}
