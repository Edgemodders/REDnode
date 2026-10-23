// REDnode Q-A: watching quest facts (docs/quests.md).
// A Node mod makes one listener per fact with api.$new("REDnodeFactListener", { fact }) and
// registers it with QuestsSystem.RegisterListener(fact, listener, n"OnFact"). The quests
// system calls OnFact with the new value; the listener sends the game event
// "quests.fact:<name>" with that value. The mod keeps its reference while it watches.

public class REDnodeFactListener extends IScriptable {
  public let fact: String;

  public func OnFact(value: Int32) -> Void {
    REDnode_Emit("quests.fact:" + this.fact, value);
  }
}
