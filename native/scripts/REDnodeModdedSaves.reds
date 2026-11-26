// REDnode 0.75.0: Load modded saves without the mod check (the launcher's switch, off by default).
//
// Game 2.5 marks a save made with mods as modded, and its load paths branch on that mark: the load
// menu (title screen and pause menu) asks each entry's IsModded(), and the title screen's Continue
// asks the menu's m_isModded. A modded save goes through LoadModdedSave(), the game's mod check
// and its "Mod Verification" popup. With the switch on, both answer not modded, so a save loads
// as an unmodded one does.
//
// The switch is read when the player loads (REDnode_PlainModdedLoad, from the plugin, which hears
// it from the host at each hello), not when the menu opens, so a menu opened before the host
// connected still follows it. Wraps only, never a replace: another mod may replace the same
// methods (a second @replaceMethod is a compile error that stops every script in the game).

public static native func REDnode_PlainModdedLoad() -> Bool

// Load menu, on the title screen and in the pause menu.
@wrapMethod(LoadListItem)
public final func IsModded() -> Bool {
  if REDnode_PlainModdedLoad() {
    return false;
  }
  return wrappedMethod();
}

// Continue on the title screen.
@wrapMethod(SingleplayerMenuGameController)
protected func HandleMenuItemActivate(data: ref<PauseMenuListItemData>) -> Bool {
  if REDnode_PlainModdedLoad() {
    this.m_isModded = false;
  }
  return wrappedMethod(data);
}
