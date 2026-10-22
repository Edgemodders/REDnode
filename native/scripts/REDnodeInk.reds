// REDnode I1: the ink spike (docs/ink.md, "I1 Spike: plan").
// Keeps the root widgets of a few HUD and menu controllers, so Node mods can reach the
// game's own UI through the rednode package's api without Codeware, and a listener class
// that turns ink callbacks into game events.
//
//   REDnodeInk.Names()          the roots kept now, by name (only those still alive)
//   REDnodeInk.Root(name)       one of them, as a weak reference, or null
//   REDnodeInkListener          built with api.$new("REDnodeInkListener", { id }) and
//                               registered with RegisterToCallback(n"OnRelease", it,
//                               n"OnRelease"); its handlers send the game events
//                               REDnodeInk.press, .release, .hoverOver and .hoverOut,
//                               with its id as the value. Ink holds it weakly: the
//                               Node mod keeps its reference while it listens
// Each root kept or let go sends REDnodeInk.root with the number of roots kept, and a
// root seen before the system runs sends REDnodeInk.noSystem.

public class REDnodeInk extends ScriptableSystem {
  private let m_names: array<CName>;
  private let m_roots: array<wref<inkCompoundWidget>>;

  private static func Get() -> ref<REDnodeInk> {
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    if !IsDefined(container) {
      return null;
    }
    return container.Get(n"REDnodeInk") as REDnodeInk;
  }

  public static func Keep(name: CName, root: ref<inkCompoundWidget>) -> Void {
    let system = REDnodeInk.Get();
    if !IsDefined(system) {
      REDnode_Emit("REDnodeInk.noSystem", 0);
      return;
    }
    let i = ArrayFindFirst(system.m_names, name);
    if i >= 0 {
      system.m_roots[i] = root;
    } else {
      ArrayPush(system.m_names, name);
      ArrayPush(system.m_roots, root);
    }
    REDnode_Emit("REDnodeInk.root", ArraySize(system.m_names));
  }

  public static func Forget(name: CName) -> Void {
    let system = REDnodeInk.Get();
    if !IsDefined(system) {
      return;
    }
    let i = ArrayFindFirst(system.m_names, name);
    if i >= 0 {
      ArrayErase(system.m_names, i);
      ArrayErase(system.m_roots, i);
    }
    REDnode_Emit("REDnodeInk.root", ArraySize(system.m_names));
  }

  public static func Names() -> array<CName> {
    let alive: array<CName>;
    let system = REDnodeInk.Get();
    if !IsDefined(system) {
      return alive;
    }
    let i = 0;
    while i < ArraySize(system.m_names) {
      if IsDefined(system.m_roots[i]) {
        ArrayPush(alive, system.m_names[i]);
      }
      i += 1;
    }
    return alive;
  }

  public static func Root(name: CName) -> wref<inkCompoundWidget> {
    let system = REDnodeInk.Get();
    if !IsDefined(system) {
      return null;
    }
    let i = ArrayFindFirst(system.m_names, name);
    if i < 0 {
      return null;
    }
    return system.m_roots[i];
  }
}

public class REDnodeInkListener extends IScriptable {
  public let id: Int32;

  protected cb func OnPress(e: ref<inkPointerEvent>) -> Bool {
    REDnode_Emit("REDnodeInk.press", this.id);
    return false;
  }

  protected cb func OnRelease(e: ref<inkPointerEvent>) -> Bool {
    REDnode_Emit("REDnodeInk.release", this.id);
    return false;
  }

  protected cb func OnHoverOver(e: ref<inkPointerEvent>) -> Bool {
    REDnode_Emit("REDnodeInk.hoverOver", this.id);
    return false;
  }

  protected cb func OnHoverOut(e: ref<inkPointerEvent>) -> Bool {
    REDnode_Emit("REDnodeInk.hoverOut", this.id);
    return false;
  }
}

// The HUD: three controllers that live through gameplay, so the spike can see which root
// suits a mod's widgets (size, place, and whether it hides with the HUD).

@wrapMethod(healthbarWidgetGameController)
protected cb func OnInitialize() -> Bool {
  let result = wrappedMethod();
  REDnodeInk.Keep(n"hud.healthbar", this.GetRootCompoundWidget());
  return result;
}

@wrapMethod(healthbarWidgetGameController)
protected cb func OnUninitialize() -> Bool {
  REDnodeInk.Forget(n"hud.healthbar");
  return wrappedMethod();
}

@wrapMethod(MinimapContainerController)
protected cb func OnInitialize() -> Bool {
  let result = wrappedMethod();
  REDnodeInk.Keep(n"hud.minimap", this.GetRootCompoundWidget());
  return result;
}

@wrapMethod(QuestTrackerGameController)
protected cb func OnInitialize() -> Bool {
  let result = wrappedMethod();
  REDnodeInk.Keep(n"hud.quests", this.GetRootCompoundWidget());
  return result;
}

@wrapMethod(QuestTrackerGameController)
protected cb func OnUninitialize() -> Bool {
  REDnodeInk.Forget(n"hud.quests");
  return wrappedMethod();
}

// Menus: the hub (inventory, character, map and the other tabs) and the pause menu,
// kept while they are open.

@wrapMethod(MenuHubGameController)
protected cb func OnInitialize() -> Bool {
  let result = wrappedMethod();
  REDnodeInk.Keep(n"menu.hub", this.GetRootCompoundWidget());
  return result;
}

@wrapMethod(MenuHubGameController)
protected cb func OnUninitialize() -> Bool {
  REDnodeInk.Forget(n"menu.hub");
  return wrappedMethod();
}

@wrapMethod(PauseMenuGameController)
protected cb func OnInitialize() -> Bool {
  let result = wrappedMethod();
  REDnodeInk.Keep(n"menu.pause", this.GetRootCompoundWidget());
  return result;
}

@wrapMethod(PauseMenuGameController)
protected cb func OnUninitialize() -> Bool {
  REDnodeInk.Forget(n"menu.pause");
  return wrappedMethod();
}
