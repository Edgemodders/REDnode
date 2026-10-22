// The ink driver (I2a, docs/ink.md): packages' trees of the game's own UI widgets, on
// Codeware's ink layers. A Node mod describes a tree with the rednode package's `ink`; the
// host sends its changes here in batches, one bridge call each, and this file builds and
// changes the widgets on the game thread. It keeps each tree, so when the game removes the
// widgets (a save load rebuilds the HUD) it builds them again with no help from Node.
//
//   ink.apply  {"package":"p","ops":[...]}, the ops in order:
//                {"op":"mount","mount":"m1","layer":"hud"}
//                {"op":"add","mount":"m1","key":"n2","parent":"n1" (or "" for the mount),
//                 "tag":"text","props":{...}}
//                {"op":"set","mount":"m1","key":"n2","props":{...}}
//                {"op":"remove","mount":"m1","key":"n2"}    the node and all under it
//                {"op":"unmount","mount":"m1"}
//              -> {"errors":[...]}: a failed op or prop is reported and the rest go on
//   ink.clear  {"package":"p"}   removes every mount of the package (the host, when it stops)
//   ink.state  {}                each mount: its package, node count and whether it is on screen
//
// Each mount is a full-size canvas of its own on the layer, named rednode:<package>:<mount>,
// so a package's widgets stay together and leave together. Layers: "hud" (Codeware's
// inkHUDLayer). The ink API needs Codeware (decided after I1, 2026-10-22).
//
// Props, as the package sends them (it turns the modder's words into these):
//   text "s"  fontSize n  font ["path","style"]  tint [r,g,b,a]  opacity n  visible b
//   size [w,h]  anchor "TopLeft"  anchorPoint [x,y]  translation [x,y]  margin [l,t,r,b]
//   name "n"  fitToContent b  atlas "path"  part "name"
// A name starting with a capital letter is a method of the widget, called with the value as
// its arguments (an array, or one value): the escape hatch for what the props do not cover.

#include "jvalue.hpp"
#include "overlay.hpp"

#include <atomic>
#include <map>
#include <string>
#include <unordered_map>
#include <vector>

namespace rednode::overlay::detail
{
namespace
{
using namespace RED4ext;
using json::Value;
using Obj = Handle<IScriptable>;

constexpr size_t MaxNodes = 2000;    // per package
constexpr uint64_t CheckFrames = 30; // how often mounts are checked, and built again when gone
constexpr size_t MaxErrors = 50;     // per ink.apply answer

struct Node
{
    std::string parent; // a node key, or empty for the mount's canvas
    std::string tag;
    Value props; // an object: every prop the node has now
    WeakHandle<IScriptable> widget;
};

struct Mount
{
    std::string package;
    std::string key;
    std::string layer;
    WeakHandle<IScriptable> window;
    WeakHandle<IScriptable> canvas;
    std::vector<std::string> order; // node keys, parents before children
    std::unordered_map<std::string, Node> nodes;
    uint32_t builds = 0;
    std::string lastError; // logged once until it changes
};

// Never destroyed: weak handles must not be let go at DLL unload, when the game may be gone
// (as reflect.cpp's references). ClearInk empties it when the game stops.
std::map<std::string, Mount>& g_mounts = *new std::map<std::string, Mount>();
std::atomic<bool> g_hostGone{false};

Value Text(std::string aText)
{
    Value v;
    v.kind = Value::Kind::String;
    v.text = std::move(aText);
    return v;
}

Value Args(std::vector<Value> aItems = {})
{
    Value v;
    v.kind = Value::Kind::Array;
    v.items = std::move(aItems);
    return v;
}

Value EmptyObject()
{
    Value v;
    v.kind = Value::Kind::Object;
    return v;
}

std::string MountId(const std::string& aPackage, const std::string& aMount)
{
    return aPackage + "\n" + aMount;
}

std::string Field(const Value& aValue, const char* aKey)
{
    const Value* v = aValue.Get(aKey);
    return v && v->kind == Value::Kind::String ? v->text : std::string();
}

bool Call(Obj& aSelf, const std::string& aFn, const Value& aArgs, std::string& aError, Obj* aOut = nullptr)
{
    return CallNative(aSelf, nullptr, aFn, aArgs, aOut, aError);
}

// A tag to its ink class, by script name; "inkSomething" passes as it is (ink.widget).
std::string InkClass(const std::string& aTag)
{
    static const std::unordered_map<std::string, std::string> classes = {
        {"canvas", "inkCanvas"}, {"column", "inkVerticalPanel"}, {"row", "inkHorizontalPanel"},
        {"flex", "inkFlex"},     {"text", "inkText"},            {"rect", "inkRectangle"},
        {"image", "inkImage"},   {"circle", "inkCircle"},        {"border", "inkBorder"},
    };
    if (auto it = classes.find(aTag); it != classes.end())
        return it->second;
    return aTag;
}

const char* LayerName(const std::string& aLayer)
{
    return aLayer == "hud" ? "inkHUDLayer" : nullptr;
}

// A player exists: a save is loaded, and the HUD is the game's, not the main menu's.
bool InGame()
{
    Obj none;
    Obj player;
    std::string error;
    return CallNative(none, nullptr, "GetPlayer", Args({EmptyObject()}), &player, error) && player;
}

// The layer's window: Codeware's GameInstance.GetInkSystem().GetLayer(name).GetVirtualWindow().
Obj LayerWindow(const std::string& aLayer, std::string& aError)
{
    const char* name = LayerName(aLayer);
    if (!name)
    {
        aError = "no ink layer \"" + aLayer + "\" (the layers so far: hud)";
        return {};
    }
    Obj none;
    Obj system;
    if (!CallNative(none, "GameInstance", "GetInkSystem", Args(), &system, aError) || !system)
    {
        aError = "the ink API needs Codeware, which is not installed or not ready (" + aError + ")";
        return {};
    }
    Obj layer;
    if (!Call(system, "GetLayer", Args({Text(name)}), aError, &layer) || !layer)
    {
        aError = std::string("Codeware has no layer ") + name + (aError.empty() ? "" : ": " + aError);
        return {};
    }
    Obj window;
    if (!Call(layer, "GetVirtualWindow", Args(), aError, &window) || !window)
    {
        aError = std::string(name) + " has no window now" + (aError.empty() ? "" : ": " + aError);
        return {};
    }
    return window;
}

// Adds a child by its script class name (inkText); the native name (inkTextWidget) if not.
Obj AddWidget(Obj& aParent, const std::string& aTag, std::string& aError)
{
    const std::string cls = InkClass(aTag);
    Obj widget;
    std::string first;
    if (Call(aParent, "AddChild", Args({Text(cls)}), first, &widget) && widget)
        return widget;
    std::string second;
    if (Call(aParent, "AddChild", Args({Text(cls + "Widget")}), second, &widget) && widget)
        return widget;
    aError = "could not add a " + aTag + " (" + cls + ")" + (first.empty() ? "" : ": " + first);
    return {};
}

struct Setter
{
    const char* prop;
    const char* fn;
    bool spread;     // the value is an array of the arguments
    bool textParams; // the function takes text parameters after the value; REDnode passes none
};

constexpr Setter Setters[] = {
    {"text", "SetText", false, true},
    {"fontSize", "SetFontSize", false, false},
    {"font", "SetFontFamily", true, false},
    {"tint", "SetTintColor;Uint8Uint8Uint8Uint8", true, false},
    {"opacity", "SetOpacity", false, false},
    {"visible", "SetVisible", false, false},
    {"size", "SetSize;FloatFloat", true, false},
    {"anchor", "SetAnchor", false, false},
    {"anchorPoint", "SetAnchorPoint;FloatFloat", true, false},
    {"translation", "SetTranslation;FloatFloat", true, false},
    {"margin", "SetMargin;FloatFloatFloatFloat", true, false},
    {"name", "SetName", false, false},
    {"fitToContent", "SetFitToContent", false, false},
    {"atlas", "SetAtlasResource", false, false},
    {"part", "SetTexturePart", false, false},
};

bool ApplyProp(Obj& aWidget, const std::string& aKey, const Value& aValue, std::string& aError)
{
    for (const auto& s : Setters)
    {
        if (aKey != s.prop)
            continue;
        Value args = s.spread && aValue.kind == Value::Kind::Array ? aValue : Args({aValue});
        if (s.textParams)
            args.items.emplace_back(); // no text parameters
        return Call(aWidget, s.fn, args, aError);
    }
    if (!aKey.empty() && aKey[0] >= 'A' && aKey[0] <= 'Z')
        return Call(aWidget, aKey, aValue.kind == Value::Kind::Array ? aValue : Args({aValue}), aError);
    aError = "no ink property \"" + aKey + "\"";
    return false;
}

void Note(std::vector<std::string>& aErrors, std::string aError)
{
    if (aErrors.size() < MaxErrors)
        aErrors.push_back(std::move(aError));
}

Obj ParentOf(Mount& aMount, const Node& aNode)
{
    if (aNode.parent.empty())
        return aMount.canvas.Lock();
    auto it = aMount.nodes.find(aNode.parent);
    return it == aMount.nodes.end() ? Obj{} : it->second.widget.Lock();
}

bool BuildNode(Mount& aMount, const std::string& aKey, std::vector<std::string>& aErrors)
{
    Node& node = aMount.nodes[aKey];
    Obj parent = ParentOf(aMount, node);
    if (!parent)
    {
        Note(aErrors, aKey + ": its parent is not on screen");
        return false;
    }
    std::string error;
    Obj widget = AddWidget(parent, node.tag, error);
    if (!widget)
    {
        Note(aErrors, aKey + ": " + error);
        return false;
    }
    node.widget = widget;
    for (const auto& [k, v] : node.props.fields)
    {
        std::string e;
        if (!ApplyProp(widget, k, v, e))
            Note(aErrors, aKey + "." + k + ": " + e);
    }
    return true;
}

// Removes a widget from its parent (ink's RemoveChild); nothing when either is gone.
void RemoveWidget(Obj& aParent, Obj& aWidget)
{
    if (!aParent || !aWidget)
        return;
    Value ref = RefArg(aWidget);
    std::string error;
    Call(aParent, "RemoveChild", Args({ref}), error);
    DropRefArg(ref);
}

// Puts the mount on screen: its canvas on the layer, then every node in order.
bool Build(Mount& aMount, std::vector<std::string>& aErrors)
{
    if (!InGame())
        return false; // no save loaded yet; UpdateInk tries again
    std::string error;
    Obj window = LayerWindow(aMount.layer, error);
    if (!window)
    {
        Note(aErrors, error);
        return false;
    }
    Obj canvas = AddWidget(window, "canvas", error);
    if (!canvas)
    {
        Note(aErrors, "the mount's canvas: " + error);
        return false;
    }
    std::string e;
    ApplyProp(canvas, "name", Text("rednode:" + aMount.package + ":" + aMount.key), e);
    ApplyProp(canvas, "anchor", Text("Fill"), e);
    aMount.window = window;
    aMount.canvas = canvas;
    aMount.builds += 1;
    size_t built = 0;
    for (const auto& key : aMount.order)
        built += BuildNode(aMount, key, aErrors) ? 1 : 0;
    Log("Ink: %s's mount %s on %s: %zu of %zu widgets built (build %u)", aMount.package.c_str(), aMount.key.c_str(),
        aMount.layer.c_str(), built, aMount.order.size(), aMount.builds);
    return true;
}

void Unmount(Mount& aMount)
{
    Obj window = aMount.window.Lock();
    Obj canvas = aMount.canvas.Lock();
    RemoveWidget(window, canvas);
}

size_t NodesOf(const std::string& aPackage)
{
    size_t n = 0;
    for (const auto& [id, m] : g_mounts)
        n += m.package == aPackage ? m.nodes.size() : 0;
    return n;
}

void Merge(Value& aInto, const Value& aProps)
{
    for (const auto& [k, v] : aProps.fields)
    {
        bool found = false;
        for (auto& [ik, iv] : aInto.fields)
        {
            if (ik == k)
            {
                iv = v;
                found = true;
                break;
            }
        }
        if (!found)
            aInto.fields.emplace_back(k, v);
    }
}

// The node and every node under it, in the mount's order.
std::vector<std::string> Subtree(const Mount& aMount, const std::string& aKey)
{
    std::vector<std::string> out;
    for (const auto& key : aMount.order)
    {
        for (std::string k = key; !k.empty();)
        {
            if (k == aKey)
            {
                out.push_back(key);
                break;
            }
            auto it = aMount.nodes.find(k);
            k = it == aMount.nodes.end() ? std::string() : it->second.parent;
        }
    }
    return out;
}

void RunOp(const std::string& aPackage, const Value& aOp, std::vector<std::string>& aErrors)
{
    const std::string op = Field(aOp, "op");
    const std::string mountKey = Field(aOp, "mount");
    const std::string key = Field(aOp, "key");
    const std::string id = MountId(aPackage, mountKey);
    if (mountKey.empty())
        return Note(aErrors, op + ": no mount given");

    if (op == "mount")
    {
        if (auto it = g_mounts.find(id); it != g_mounts.end())
        {
            Unmount(it->second);
            g_mounts.erase(it);
        }
        Mount& m = g_mounts[id];
        m.package = aPackage;
        m.key = mountKey;
        m.layer = Field(aOp, "layer").empty() ? "hud" : Field(aOp, "layer");
        if (!LayerName(m.layer))
        {
            Note(aErrors, mountKey + ": no ink layer \"" + m.layer + "\" (the layers so far: hud)");
            g_mounts.erase(id);
            return;
        }
        Build(m, aErrors); // not in a game yet: UpdateInk builds it later
        return;
    }

    auto it = g_mounts.find(id);
    if (it == g_mounts.end())
        return Note(aErrors, op + " " + key + ": no mount " + mountKey);
    Mount& m = it->second;

    if (op == "unmount")
    {
        Unmount(m);
        g_mounts.erase(it);
        return;
    }
    if (key.empty())
        return Note(aErrors, op + ": no node key given");

    if (op == "add")
    {
        if (m.nodes.contains(key))
            return Note(aErrors, key + ": added twice");
        if (NodesOf(aPackage) >= MaxNodes)
            return Note(aErrors, key + ": a package can have at most 2000 ink widgets");
        Node node;
        node.parent = Field(aOp, "parent");
        node.tag = Field(aOp, "tag");
        if (const Value* props = aOp.Get("props"); props && props->kind == Value::Kind::Object)
            node.props = *props;
        else
            node.props = EmptyObject();
        if (!node.parent.empty() && !m.nodes.contains(node.parent))
            return Note(aErrors, key + ": no parent " + node.parent);
        m.nodes[key] = std::move(node);
        m.order.push_back(key);
        if (m.canvas.Lock())
            BuildNode(m, key, aErrors);
        return;
    }

    auto n = m.nodes.find(key);
    if (n == m.nodes.end())
        return Note(aErrors, op + ": no node " + key);

    if (op == "set")
    {
        const Value* props = aOp.Get("props");
        if (!props || props->kind != Value::Kind::Object)
            return;
        Merge(n->second.props, *props);
        Obj widget = n->second.widget.Lock();
        if (!widget)
            return; // applied when the mount is built again
        for (const auto& [k, v] : props->fields)
        {
            std::string e;
            if (!ApplyProp(widget, k, v, e))
                Note(aErrors, key + "." + k + ": " + e);
        }
        return;
    }

    if (op == "remove")
    {
        Obj parent = ParentOf(m, n->second);
        Obj widget = n->second.widget.Lock();
        RemoveWidget(parent, widget); // its children go with it
        for (const auto& k : Subtree(m, key))
            m.nodes.erase(k);
        std::erase_if(m.order, [&](const std::string& k) { return !m.nodes.contains(k); });
        return;
    }

    Note(aErrors, "no ink op \"" + op + "\"");
}

void RemoveMounts(const std::string* aPackage)
{
    for (auto it = g_mounts.begin(); it != g_mounts.end();)
    {
        if (aPackage && it->second.package != *aPackage)
        {
            ++it;
            continue;
        }
        Unmount(it->second);
        it = g_mounts.erase(it);
    }
}

std::string ErrorsJson(const std::vector<std::string>& aErrors)
{
    std::string out = "{\"errors\":[";
    for (size_t i = 0; i < aErrors.size(); ++i)
        out += (i ? "," : "") + JsonString(aErrors[i]);
    return out + "]}";
}
} // namespace

bool IsInkMethod(const std::string& aMethod)
{
    return aMethod == "ink.apply" || aMethod == "ink.clear" || aMethod == "ink.state";
}

std::string Ink(const std::string& aMethod, const json::Value& aParams, std::string& aError)
{
    if (aMethod == "ink.state")
    {
        std::string out = "[";
        bool first = true;
        for (const auto& [id, m] : g_mounts)
        {
            out += first ? "" : ",";
            first = false;
            out += "{\"package\":" + JsonString(m.package) + ",\"mount\":" + JsonString(m.key) +
                   ",\"layer\":" + JsonString(m.layer) + ",\"nodes\":" + std::to_string(m.nodes.size()) +
                   ",\"onScreen\":" + (m.canvas.Lock() ? "true" : "false") + ",\"builds\":" + std::to_string(m.builds) +
                   "}";
        }
        return out + "]";
    }

    const std::string package = Field(aParams, "package");
    if (package.empty())
    {
        aError = "package is required";
        return {};
    }
    if (aMethod == "ink.clear")
    {
        RemoveMounts(&package);
        return "true";
    }

    const Value* ops = aParams.Get("ops");
    if (!ops || ops->kind != Value::Kind::Array)
    {
        aError = "ops must be an array";
        return {};
    }
    std::vector<std::string> errors;
    for (const auto& op : ops->items)
        RunOp(package, op, errors);
    if (!errors.empty())
        Log("Ink: %s: %zu error(s), the first: %s", package.c_str(), errors.size(), errors.front().c_str());
    return ErrorsJson(errors);
}

void UpdateInk(uint64_t aFrame)
{
    if (g_hostGone.exchange(false))
        RemoveMounts(nullptr);
    if (g_mounts.empty() || aFrame % CheckFrames)
        return;
    // Mounts the game removed (a save load rebuilds the HUD) are built again once a game runs.
    bool inGame = false;
    bool checked = false;
    for (auto& [id, m] : g_mounts)
    {
        if (m.canvas.Lock())
            continue;
        if (!checked)
        {
            inGame = InGame();
            checked = true;
        }
        if (!inGame)
            return;
        std::vector<std::string> errors;
        Build(m, errors);
        const std::string error = errors.empty() ? std::string() : errors.front();
        if (error != m.lastError && !error.empty())
            Log("Ink: %s's mount %s: %s", m.package.c_str(), m.key.c_str(), error.c_str());
        m.lastError = error;
    }
}

void InkHostGone()
{
    g_hostGone = true;
}

void ClearInk()
{
    g_mounts.clear();
}
} // namespace rednode::overlay::detail
