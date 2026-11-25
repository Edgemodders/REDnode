// REDnode #61: game events for fights (docs/world.md, "Fight events (#61)").
//
// "combat"     V's combat state changed: the game's own listener on the player state machine's
//              Combat value (PlayerPuppet.OnCombatStateChanged). Sent with REDnode_Emit, value 1
//              in combat and 0 out of it, only when it changes.
// "npcDowned"  A person was defeated (ScriptedPuppet.HandleDefeated) or killed (HandleDeath), the
//              two places the game finds and rewards the killer. Sent with REDnode_EntityText: the
//              person's entity id and a JSON text the rednode package reads (game.on("npcDowned")).
//              Each person sends "defeated" once and "killed" once, so one defeated and then
//              finished off sends both; a person brought back (OnResurrected) can send them again.
//
// Nothing is sent while nothing happens: no polling, no timers.

// 0 not sent yet, 1 out of combat, 2 in combat (no negative default: the game's compiler refuses one).
@addField(PlayerPuppet)
private let m_rednodeCombat: Int32;

// Bits: 1 defeated sent, 2 killed sent.
@addField(ScriptedPuppet)
private let m_rednodeDowned: Int32;

@wrapMethod(PlayerPuppet)
protected cb func OnCombatStateChanged(newState: Int32) -> Bool {
  let result = wrappedMethod(newState);
  let now = newState == 1 ? 2 : 1;
  if now != this.m_rednodeCombat {
    this.m_rednodeCombat = now;
    REDnode_Emit("combat", now == 2 ? 1 : 0);
  }
  return result;
}

@wrapMethod(ScriptedPuppet)
protected func HandleDeath(instigator: wref<GameObject>) -> Void {
  wrappedMethod(instigator);
  this.REDnodeDowned(true, instigator);
}

@wrapMethod(ScriptedPuppet)
protected final func HandleDefeated() -> Void {
  wrappedMethod();
  this.REDnodeDowned(false, null);
}

@wrapMethod(ScriptedPuppet)
protected func OnResurrected() -> Void {
  wrappedMethod();
  this.m_rednodeDowned = 0;
}

@addMethod(ScriptedPuppet)
private func REDnodeDowned(killed: Bool, instigator: wref<GameObject>) -> Void {
  let npc = this as NPCPuppet;
  if !IsDefined(npc) {
    return;
  }
  if killed {
    if (this.m_rednodeDowned & 2) != 0 {
      return;
    }
    this.m_rednodeDowned = this.m_rednodeDowned | 2;
  } else {
    if this.m_rednodeDowned != 0 {
      return;
    }
    this.m_rednodeDowned = 1;
  }

  // The killer the game rewarded (RewardKiller sets it), else the death's instigator, else the last hit's.
  let killer = this.GetKiller() as GameObject;
  if !IsDefined(killer) {
    killer = instigator;
  }
  if !IsDefined(killer) {
    killer = npc.GetLastHitInstigator();
  }
  let by = "none";
  if IsDefined(killer as PlayerPuppet) {
    by = "player";
  } else {
    if ScriptedPuppet.IsPlayerCompanion(killer) {
      by = "companion";
    } else {
      if IsDefined(killer) {
        by = "other";
      }
    }
  }

  let record = this.GetRecord();
  let recordName = "";
  let recordNumber = "";
  let affName = "";
  let affNumber = "";
  let affEnum = "";
  if IsDefined(record) {
    recordName = TDBID.ToStringDEBUG(record.GetID());
    recordNumber = REDnodeFights.Number(record.GetID());
    let aff = record.Affiliation();
    if IsDefined(aff) {
      affName = TDBID.ToStringDEBUG(aff.GetID());
      affNumber = REDnodeFights.Number(aff.GetID());
      affEnum = NameToString(aff.EnumName());
    }
  }

  let text = "{\"killed\":" + (killed ? "true" : "false")
    + ",\"by\":\"" + by + "\""
    + ",\"record\":\"" + REDnodeFights.Clean(recordName) + "\""
    + ",\"recordId\":\"" + recordNumber + "\""
    + ",\"affiliation\":\"" + REDnodeFights.Clean(affName) + "\""
    + ",\"affiliationId\":\"" + affNumber + "\""
    + ",\"affiliationEnum\":\"" + REDnodeFights.Clean(affEnum) + "\"}";
  REDnode_EntityText("npcDowned", this.GetEntityID(), text);
}

public abstract class REDnodeFights {
  // A TweakDB id as its number in decimal: the rednode package turns it into "0x..." and a name.
  public static func Number(id: TweakDBID) -> String {
    return ToString(TDBID.ToNumber(id));
  }

  // Keeps the JSON text valid: names never hold these, but a debug name could.
  public static func Clean(s: String) -> String {
    let out = StrReplaceAll(s, "\\", "/");
    return StrReplaceAll(out, "\"", "'");
  }
}
