// REDnode #57 step 1: the game's list of saves, for tests an assistant runs (docs/world.md,
// "Saves and loading (#57)").
//
// The game's load menu asks the system requests handler for its saves (RequestSavesForLoad) and
// hears them through two callbacks: OnSavesForLoadReady with every save's name (its place in the
// list is the saveIndex LoadSavedGame takes), and OnSaveMetadataReady once per save with its
// details. This listener takes the same callbacks and sends each as a REDnode game event with a
// JSON text (REDnode_EntityText, declared in REDnodeQuickhacks.reds):
//
// "saves.list"  ["ManualSave-3", "AutoSave-0", ...], in the game's order
// "saves.meta"  { index, name, location, quest, type, timestamp, playTime, level, valid, modded, version }
//
// A package registers it itself (RegisterToCallback on the handler, through api): nothing here
// runs until asked, and nothing is kept between asks.

public class REDnodeSavesListener extends IScriptable {

  protected cb func OnSavesForLoadReady(saves: array<String>) -> Bool {
    let text = "[";
    let i = 0;
    while i < ArraySize(saves) {
      if i > 0 {
        text += ",";
      }
      text += "\"" + REDnodeSavesListener.Escape(saves[i]) + "\"";
      i += 1;
    }
    text += "]";
    let none: EntityID;
    REDnode_EntityText("saves.list", none, text);
    return true;
  }

  protected cb func OnSaveMetadataReady(info: ref<SaveMetadataInfo>) -> Bool {
    if !IsDefined(info) {
      return true;
    }
    let text = "{\"index\":" + IntToString(info.saveIndex)
      + ",\"name\":\"" + REDnodeSavesListener.Escape(info.internalName) + "\""
      + ",\"location\":\"" + REDnodeSavesListener.Escape(info.locationName) + "\""
      + ",\"quest\":\"" + REDnodeSavesListener.Escape(info.trackedQuest) + "\""
      + ",\"type\":" + IntToString(EnumInt(info.saveType))
      + ",\"timestamp\":\"" + ToString(info.timestamp) + "\""
      + ",\"playTime\":" + FloatToString(Cast<Float>(info.playTime))
      + ",\"level\":" + FloatToString(Cast<Float>(info.level))
      + ",\"valid\":" + (info.isValid ? "true" : "false")
      + ",\"modded\":" + (info.isModded ? "true" : "false")
      + ",\"version\":\"" + REDnodeSavesListener.Escape(info.gameVersion) + "\"}";
    let none: EntityID;
    REDnode_EntityText("saves.meta", none, text);
    return true;
  }

  // Text inside a JSON string: backslashes and quotes escaped, line breaks as spaces.
  private static func Escape(s: String) -> String {
    let out = StrReplaceAll(s, "\\", "\\\\");
    out = StrReplaceAll(out, "\"", "\\\"");
    out = StrReplaceAll(out, "\n", " ");
    return StrReplaceAll(out, "\r", " ");
  }
}
