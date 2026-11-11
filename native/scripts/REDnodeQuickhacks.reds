// REDnode #42: functions on quickhacks (docs/quickhacks.md), from EDGEhack's H3c.1 spike.
// A Node mod defines, per quickhack action record, a scan check (canUse) and an on-land function
// (onLand) with quickhacks.define in the rednode package. Plain redscript: no Codeware needed.
//
// The scan check. The game builds an enemy's quickhack list in one go and cannot wait for a Node mod
// (Tier 2), so this asks, remembers and refreshes:
//   1. When the game builds the list, each hack with a check and no answer yet shows locked with
//      "Checking", and the mod gets the event "quickhacks.scan" with the enemy and a snapshot.
//   2. The mod answers (REDnodeQuickhacks.Answer). The answer is remembered per enemy and hack, and
//      the list is rebuilt when it changed (QuickhackModule.RequestRefreshQuickhackMenu).
//   3. "Checking" stays up for the define's hold (1 s by default) the first time V scans that enemy,
//      whatever the answer, so it can be read (the owner's choice in the spike, 2026-11-05).
//   4. With no answer within 1.1 s, the game's own result stands; the mod's side logs why.
// On land: when a hack with an onLand function completes on a living enemy, the mod gets the event
// "quickhacks.land". It adds to what the hack does and cannot cancel it.
//
// Node mods reach this through the rednode package (quickhacks.ts):
//   REDnodeQuickhacks.Define(owner, action, check, land, text, hold)   a key, or -1
//   REDnodeQuickhacks.Remove(key), Release(owner)                      take defines away
//   REDnodeQuickhacks.Answer(entityID, key, usable)                    a scan check's answer
//   REDnodeQuickhacks.Damage(entityID, amount), AddEffect(entityID, effect)   from V
//   REDnodeQuickhacks.Counts()                                         for the test app
// The overlay host calls Release(owner) when a package stops.

public static native func REDnode_EntityText(name: String, entityID: EntityID, text: String) -> Void

public class REDnodeQuickhacks extends ScriptableSystem {
  // The defines: one per quickhack action record.
  private let m_actions: array<TweakDBID>;
  private let m_defKeys: array<Int32>;
  private let m_owners: array<String>;
  private let m_check: array<Bool>;
  private let m_land: array<Bool>;
  private let m_texts: array<String>;
  private let m_holds: array<Float>;
  private let m_nextKey: Int32;

  // The answers, per enemy and define: "<entity>|<key>". 0 none yet, 1 usable, 2 not usable, 3 gave up.
  private let m_keys: array<String>;
  private let m_ids: array<EntityID>;
  private let m_answers: array<Int32>;
  private let m_askedAt: array<Float>;
  private let m_firstAt: array<Float>;

  private let m_rebuilds: Int32;
  private let m_asks: Int32;
  private let m_gaveUp: Int32;
  private let m_lands: Int32;

  public static func Get() -> ref<REDnodeQuickhacks> {
    return GameInstance.GetScriptableSystemsContainer(GetGameInstance()).Get(n"REDnodeQuickhacks") as REDnodeQuickhacks;
  }

  private func Now() -> Float {
    return EngineTime.ToFloat(GameInstance.GetEngineTime(this.GetGameInstance()));
  }

  private func DefineOf(action: TweakDBID) -> Int32 {
    return ArrayFindFirst(this.m_actions, action);
  }

  // What the mod gets about an enemy: the define's key, then the enemy's level, health points, health
  // in percent, and its kind, joined by a bar. A plain check needs no game call.
  private func Snapshot(owner: wref<ScriptedPuppet>, id: EntityID, key: Int32) -> String {
    let game = this.GetGameInstance();
    let stats = Cast<StatsObjectID>(id);
    let level = GameInstance.GetStatsSystem(game).GetStatValue(stats, gamedataStatType.Level);
    let pools = GameInstance.GetStatPoolsSystem(game);
    let health = pools.GetStatPoolValue(stats, gamedataStatPoolType.Health, false);
    let percent = pools.GetStatPoolValue(stats, gamedataStatPoolType.Health, true);
    let kind = "";
    if IsDefined(owner) {
      kind = (owner.IsHuman() ? "1" : "0") + (owner.IsBoss() ? "1" : "0") + (owner.IsMechanical() ? "1" : "0")
        + (owner.IsDrone() ? "1" : "0") + (owner.IsAndroid() ? "1" : "0") + (owner.IsElite() ? "1" : "0")
        + (owner.IsCivilian() ? "1" : "0");
    }
    return IntToString(key) + "|" + FloatToString(level) + "|" + FloatToString(health) + "|" + FloatToString(percent) + "|" + kind;
  }

  private func Ask(owner: ref<ScriptedPuppet>, key: Int32) -> Void {
    this.m_asks += 1;
    REDnode_EntityText("quickhacks.scan", owner.GetEntityID(), this.Snapshot(owner, owner.GetEntityID(), key));
  }

  private func Lock(command: ref<QuickhackData>, text: String) -> Void {
    let action = command.m_action as ScriptableDeviceAction;
    if IsDefined(action) {
      action.SetInactiveWithReason(false, text);
    }
    command.m_isLocked = true;
    command.m_inactiveReason = text;
    command.m_actionState = EActionInactivityReson.Locked;
    command.m_action = null;
  }

  private func Remember(key: String, id: EntityID, now: Float) -> Void {
    // At most 512 answers are kept; the oldest go first.
    if ArraySize(this.m_keys) >= 512 {
      ArrayErase(this.m_keys, 0);
      ArrayErase(this.m_ids, 0);
      ArrayErase(this.m_answers, 0);
      ArrayErase(this.m_askedAt, 0);
      ArrayErase(this.m_firstAt, 0);
    }
    ArrayPush(this.m_keys, key);
    ArrayPush(this.m_ids, id);
    ArrayPush(this.m_answers, 0);
    ArrayPush(this.m_askedAt, now);
    ArrayPush(this.m_firstAt, now);
  }

  // Called each time the game has built the list of hacks for an enemy.
  public func Decide(owner: ref<ScriptedPuppet>, commands: array<ref<QuickhackData>>) -> Void {
    if ArraySize(this.m_actions) == 0 {
      return;
    }
    this.m_rebuilds += 1;
    let now = this.Now();
    for command in commands {
      let action = command.m_action as ScriptableDeviceAction;
      if !command.m_isLocked && IsDefined(action) {
        let d = this.DefineOf(action.GetObjectActionRecord().GetID());
        if d >= 0 && this.m_check[d] {
          let def = this.m_defKeys[d];
          let key = EntityID.ToDebugString(owner.GetEntityID()) + "|" + IntToString(def);
          let found = ArrayFindFirst(this.m_keys, key);
          if found < 0 {
            this.Remember(key, owner.GetEntityID(), now);
            this.Ask(owner, def);
            let wait = new REDnodeQuickhacksWait();
            wait.m_system = this;
            wait.m_key = key;
            GameInstance.GetDelaySystem(this.GetGameInstance()).DelayCallback(wait, 1.1, false);
            this.Lock(command, "Checking...");
          } else {
            let answer = this.m_answers[found];
            if answer == 0 || now - this.m_firstAt[found] < this.m_holds[d] {
              this.Lock(command, "Checking...");
            } else {
              if answer == 2 {
                this.Lock(command, this.m_texts[d]);
              }
              // Ask again, at most four times a second: the answer may have changed.
              if answer != 3 && now - this.m_askedAt[found] > 0.25 {
                this.m_askedAt[found] = now;
                this.Ask(owner, def);
              }
            }
          }
        }
      }
    }
  }

  // No answer in time: the game's own result stands, and the list is built again without "Checking".
  public func GiveUp(key: String) -> Void {
    let found = ArrayFindFirst(this.m_keys, key);
    if found < 0 {
      return;
    }
    if this.m_answers[found] == 0 {
      this.m_answers[found] = 3;
      this.m_gaveUp += 1;
    }
    QuickhackModule.RequestRefreshQuickhackMenu(this.GetGameInstance(), this.m_ids[found]);
  }

  // Called when a quickhack completes on a living person.
  public func Landed(action: ref<ScriptableDeviceAction>) -> Void {
    if ArraySize(this.m_actions) == 0 {
      return;
    }
    let d = this.DefineOf(action.GetObjectActionRecord().GetID());
    if d < 0 || !this.m_land[d] {
      return;
    }
    this.m_lands += 1;
    let id = action.GetRequesterID();
    let target = GameInstance.FindEntityByID(this.GetGameInstance(), id) as ScriptedPuppet;
    let executor = action.GetExecutor();
    let byV = IsDefined(executor) && executor.IsPlayer() ? "V" : "other";
    REDnode_EntityText("quickhacks.land", id, this.Snapshot(target, id, this.m_defKeys[d]) + "|" + byV);
  }

  private func ForgetAnswers() -> Void {
    ArrayClear(this.m_keys);
    ArrayClear(this.m_ids);
    ArrayClear(this.m_answers);
    ArrayClear(this.m_askedAt);
    ArrayClear(this.m_firstAt);
  }

  private func RemoveAt(d: Int32) -> Void {
    ArrayErase(this.m_actions, d);
    ArrayErase(this.m_defKeys, d);
    ArrayErase(this.m_owners, d);
    ArrayErase(this.m_check, d);
    ArrayErase(this.m_land, d);
    ArrayErase(this.m_texts, d);
    ArrayErase(this.m_holds, d);
  }

  // From the rednode package, through api.$static.

  // A define for one action record, owned by a package. Returns its key, or -1 when another package
  // has defined that action. The same package defining it again replaces its own.
  public static func Define(owner: String, action: TweakDBID, check: Bool, land: Bool, text: String, hold: Float) -> Int32 {
    let self = REDnodeQuickhacks.Get();
    if !IsDefined(self) {
      return -1;
    }
    let d = self.DefineOf(action);
    if d >= 0 {
      if !Equals(self.m_owners[d], owner) {
        return -1;
      }
      self.RemoveAt(d);
    }
    self.m_nextKey += 1;
    ArrayPush(self.m_actions, action);
    ArrayPush(self.m_defKeys, self.m_nextKey);
    ArrayPush(self.m_owners, owner);
    ArrayPush(self.m_check, check);
    ArrayPush(self.m_land, land);
    ArrayPush(self.m_texts, text);
    ArrayPush(self.m_holds, hold);
    self.ForgetAnswers();
    return self.m_nextKey;
  }

  // The owner of the define for an action record, or "" when none.
  public static func OwnerOf(action: TweakDBID) -> String {
    let self = REDnodeQuickhacks.Get();
    if !IsDefined(self) {
      return "";
    }
    let d = self.DefineOf(action);
    return d >= 0 ? self.m_owners[d] : "";
  }

  public static func Remove(key: Int32) -> Bool {
    let self = REDnodeQuickhacks.Get();
    if !IsDefined(self) {
      return false;
    }
    let d = ArrayFindFirst(self.m_defKeys, key);
    if d < 0 {
      return false;
    }
    self.RemoveAt(d);
    self.ForgetAnswers();
    return true;
  }

  // Takes away every define of a package (the host calls it when the package stops). Returns how many.
  public static func Release(owner: String) -> Int32 {
    let self = REDnodeQuickhacks.Get();
    if !IsDefined(self) {
      return 0;
    }
    let n = 0;
    let d = ArraySize(self.m_owners) - 1;
    while d >= 0 {
      if Equals(self.m_owners[d], owner) {
        self.RemoveAt(d);
        n += 1;
      }
      d -= 1;
    }
    if n > 0 {
      self.ForgetAnswers();
    }
    return n;
  }

  // Remembers a scan check's answer and rebuilds the list if it changed. Returns the seconds since the
  // ask, measured in the game, or -1 for an enemy and hack not asked about.
  public static func Answer(id: EntityID, key: Int32, usable: Bool) -> Float {
    let self = REDnodeQuickhacks.Get();
    if !IsDefined(self) {
      return -1.0;
    }
    let found = ArrayFindFirst(self.m_keys, EntityID.ToDebugString(id) + "|" + IntToString(key));
    if found < 0 {
      return -1.0;
    }
    let answer = usable ? 1 : 2;
    let wait = self.Now() - self.m_askedAt[found];
    let changed = self.m_answers[found] != answer;
    self.m_answers[found] = answer;
    if changed {
      QuickhackModule.RequestRefreshQuickhackMenu(self.GetGameInstance(), id);
    }
    return wait;
  }

  // Lowers the enemy's health by amount points, with V as the one who did it (the spike's way; a
  // hand-built hit event crashed the game). False when the enemy is gone.
  public static func Damage(id: EntityID, amount: Float) -> Bool {
    let game = GetGameInstance();
    if !IsDefined(GameInstance.FindEntityByID(game, id)) {
      return false;
    }
    GameInstance.GetStatPoolsSystem(game).RequestChangingStatPoolValue(Cast<StatsObjectID>(id), gamedataStatPoolType.Health, -amount, GetPlayer(game), false, false);
    return true;
  }

  // Puts a status effect on the enemy with V as the one who applied it, as the game's own hacks do.
  public static func AddEffect(id: EntityID, effect: TweakDBID) -> Bool {
    let game = GetGameInstance();
    let target = GameInstance.FindEntityByID(game, id) as GameObject;
    if !IsDefined(target) {
      return false;
    }
    return StatusEffectHelper.ApplyStatusEffect(target, effect, GetPlayer(game).GetEntityID());
  }

  public static func Counts() -> String {
    let self = REDnodeQuickhacks.Get();
    if !IsDefined(self) {
      return "no quickhacks system";
    }
    return "defines " + IntToString(ArraySize(self.m_actions)) + ", rebuilds " + IntToString(self.m_rebuilds) + ", asks " + IntToString(self.m_asks)
      + ", gave up " + IntToString(self.m_gaveUp) + ", landed " + IntToString(self.m_lands) + ", answers kept " + IntToString(ArraySize(self.m_keys));
  }
}

public class REDnodeQuickhacksWait extends DelayCallback {
  public let m_system: wref<REDnodeQuickhacks>;
  public let m_key: String;

  public func Call() -> Void {
    if IsDefined(this.m_system) {
      this.m_system.GiveUp(this.m_key);
    }
  }
}

@wrapMethod(ScriptedPuppet)
private final func TranslateChoicesIntoQuickSlotCommands(const puppetActions: script_ref<array<ref<PuppetAction>>>, commands: script_ref<array<ref<QuickhackData>>>) -> Void {
  wrappedMethod(puppetActions, commands);
  let system = REDnodeQuickhacks.Get();
  if IsDefined(system) {
    system.Decide(this, Deref(commands));
  }
}

@wrapMethod(ScriptableDeviceAction)
public func CompleteAction(gameInstance: GameInstance) -> Void {
  let dead = this.m_isTargetDead;
  wrappedMethod(gameInstance);
  if !dead && this.IsQuickHack() && IsDefined(this as PuppetAction) {
    let system = REDnodeQuickhacks.Get();
    if IsDefined(system) {
      system.Landed(this);
    }
  }
}
