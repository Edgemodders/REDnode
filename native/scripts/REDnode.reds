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

// The pause menu (Esc in the world), for the overlay's "Hide in the pause menu" (0.67.2).
// Its Save, Load and Settings are pages inside this scenario; its credits, mods and pitch
// screens are scenarios of their own that come back to it. The plugin also ends it when the
// game leaves its menus, so a way out these do not see cannot leave it on.
@wrapMethod(MenuScenario_PauseMenu)
protected cb func OnEnterScenario(prevScenario: CName, userData: ref<IScriptable>) -> Bool {
  REDnode_Emit("REDnode.PauseMenu", 1);
  return wrappedMethod(prevScenario, userData);
}

@wrapMethod(MenuScenario_BaseMenu)
protected cb func OnLeaveScenario(nextScenario: CName) -> Bool {
  if IsDefined(this as MenuScenario_PauseMenu)
    && !Equals(nextScenario, n"MenuScenario_CreditsPickerPause")
    && !Equals(nextScenario, n"MenuScenario_Mods_Pause")
    && !Equals(nextScenario, n"MenuScenario_Pitch_Pause") {
    REDnode_Emit("REDnode.PauseMenu", 0);
  }
  return wrappedMethod(nextScenario);
}

// The game session ends: the game calls each scriptable system's OnDetach then, at the start
// of a load and when the game goes back to the main menu. A second signal for world (#25).
public class REDnodeSessionSystem extends ScriptableSystem {
  public func OnDetach() -> Void {
    REDnode_Emit("REDnode.SessionEnd", 0);
  }
}
