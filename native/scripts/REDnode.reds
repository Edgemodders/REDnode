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
// main menu. Only for the main player, while the game still has it: the inventory's preview
// character is a puppet too. Turns game.state().world off before the world goes (#25).
@wrapMethod(PlayerPuppet)
protected cb func OnDetach() -> Bool {
  if GetPlayer(this.GetGame()) == this {
    REDnode_Emit("PlayerPuppet.OnDetach", 0);
  }
  return wrappedMethod();
}
