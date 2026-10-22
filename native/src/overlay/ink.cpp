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
//                {"op":"move","mount":"m1","key":"n2","index":0}  among its siblings (I2c)
//              "add" takes an "index" among its siblings too; without one it goes last
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
//   padding [l,t,r,b]  hAlign "Left"  vAlign "Top"  sizeRule "Stretch"  sizeCoefficient n
//   letterCase "UpperCase"  textAlign "Center"
//   styleSheet "path.inkstyle"  bind {"tintColor":"MainColors.Red"} (null unties one): the game
//   look (I2b) ties a widget to the game's own style names. The sheet is applied first and the
//   bindings last, whatever their order.
//   pivot [x,y]  scale [x,y]
//   binding {"source":"player.health","target":"text","format":"{value} HP","decimals":0}
//           {"source":"player.health","target":"scaleX","of":"player.healthMax"} (of: a source or a
//           number): a game value the plugin reads each frame, and shows when it changes (I2c)
// A name starting with a capital letter is a method of the widget, called with the value as
// its arguments (an array, or one value): the escape hatch for what the props do not cover.

#include "jvalue.hpp"
#include "overlay.hpp"

#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <algorithm>
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
    std::vector<std::string> children; // in their order on screen
    std::string shown;                 // a bound text, as last shown
    double fraction = -1;              // a bound scale, as last shown
};

struct Mount
{
    std::string package;
    std::string key;
    std::string layer;
    WeakHandle<IScriptable> window;
    WeakHandle<IScriptable> canvas;
    std::vector<std::string> roots; // the top nodes, in their order on screen
    std::unordered_map<std::string, Node> nodes;
    std::vector<std::string> bound; // nodes with a binding
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

// A save is loaded and the HUD is the game's: the plugin's main-menu state is off (the game
// makes a player at the main menu too, so GetPlayer alone let a rebuild try there, I2a) and a
// player exists.
bool InGame()
{
    if (InMainMenu())
        return false;
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
    {"padding", "SetPadding;FloatFloatFloatFloat", true, false},
    {"hAlign", "SetHAlign", false, false},
    {"vAlign", "SetVAlign", false, false},
    {"sizeRule", "SetSizeRule", false, false},
    {"sizeCoefficient", "SetSizeCoefficient", false, false},
    {"letterCase", "SetLetterCase", false, false},
    {"textAlign", "SetHorizontalAlignment", false, false},
    {"styleSheet", "SetStyle", false, false},
    {"pivot", "SetRenderTransformPivot;FloatFloat", true, false},
};

// bind {"tintColor": "MainColors.Red", "opacity": null}: ties a widget property to a name in
// its style sheet (the game look, I2b), or unties it with null.
// aWhich: 1 unties (the nulls), 2 ties (the names), 0 both.
bool ApplyBinds(Obj& aWidget, const Value& aBinds, std::string& aError, int aWhich = 0)
{
    if (aBinds.kind != Value::Kind::Object)
    {
        aError = "bind takes an object of property names and style names";
        return false;
    }
    bool ok = true;
    for (const auto& [prop, name] : aBinds.fields)
    {
        if ((aWhich == 1 && !name.IsNull()) || (aWhich == 2 && name.IsNull()))
            continue;
        std::string e;
        const bool done = name.IsNull() ? Call(aWidget, "UnbindProperty", Args({Text(prop)}), e)
                                        : Call(aWidget, "BindProperty", Args({Text(prop), name}), e);
        if (!done)
        {
            aError += (aError.empty() ? "" : "; ") + prop + ": " + e;
            ok = false;
        }
    }
    return ok;
}

Value Number(double aValue)
{
    Value v;
    v.kind = Value::Kind::Number;
    v.number = aValue;
    v.text = std::to_string(aValue);
    return v;
}

Value Bool(bool aValue)
{
    Value v;
    v.kind = Value::Kind::Bool;
    v.boolean = aValue;
    return v;
}

Value Vector2(double aX, double aY)
{
    Value v;
    v.kind = Value::Kind::Object;
    v.fields.emplace_back("X", Number(aX));
    v.fields.emplace_back("Y", Number(aY));
    return v;
}

bool ApplyProp(Obj& aWidget, const std::string& aKey, const Value& aValue, std::string& aError)
{
    if (aKey == "bind")
        return ApplyBinds(aWidget, aValue, aError);
    if (aKey == "binding")
        return true; // read each frame by UpdateBindings
    if (aKey == "scale" && aValue.kind == Value::Kind::Array && aValue.items.size() == 2)
        return Call(aWidget, "SetScale", Args({Vector2(aValue.items[0].number, aValue.items[1].number)}), aError);
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

// Applies props in the order ink needs: the style sheet first, then the bindings dropped, then
// the other props (a color set after its tone was untied stays), then the new bindings.
void ApplyAll(Obj& aWidget, const std::string& aKey, const Value& aProps, std::vector<std::string>& aErrors)
{
    for (int pass = 0; pass < 4; ++pass)
    {
        for (const auto& [k, v] : aProps.fields)
        {
            const bool bind = k == "bind";
            const int wants = k == "styleSheet" ? 0 : bind ? 1 : 2;
            if (!(wants == pass || (bind && pass == 3)))
                continue;
            std::string e;
            const bool ok = bind ? ApplyBinds(aWidget, v, e, pass == 1 ? 1 : 2) : ApplyProp(aWidget, k, v, e);
            if (!ok)
                Note(aErrors, aKey + "." + k + ": " + e);
        }
    }
}

Obj ParentOf(Mount& aMount, const Node& aNode)
{
    if (aNode.parent.empty())
        return aMount.canvas.Lock();
    auto it = aMount.nodes.find(aNode.parent);
    return it == aMount.nodes.end() ? Obj{} : it->second.widget.Lock();
}

std::vector<std::string>& Siblings(Mount& aMount, const Node& aNode)
{
    return aNode.parent.empty() ? aMount.roots : aMount.nodes[aNode.parent].children;
}

bool BuildNode(Mount& aMount, const std::string& aKey, std::vector<std::string>& aErrors)
{
    Node& node = aMount.nodes[aKey];
    node.shown.clear(); // a new widget: bound values are shown again
    node.fraction = -1;
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
    ApplyAll(widget, aKey, node.props, aErrors);
    return true;
}

// A node and every node under it, in order on screen.
size_t BuildTree(Mount& aMount, const std::string& aKey, std::vector<std::string>& aErrors)
{
    if (!BuildNode(aMount, aKey, aErrors))
        return 0;
    size_t built = 1;
    const auto children = aMount.nodes[aKey].children;
    for (const auto& child : children)
        built += BuildTree(aMount, child, aErrors);
    return built;
}

// Puts a widget at its node's place among its siblings (ink's ReorderChild).
void PlaceWidget(Mount& aMount, const std::string& aKey, std::vector<std::string>& aErrors)
{
    Node& node = aMount.nodes[aKey];
    const auto& siblings = Siblings(aMount, node);
    const auto at = std::find(siblings.begin(), siblings.end(), aKey) - siblings.begin();
    Obj parent = ParentOf(aMount, node);
    Obj widget = node.widget.Lock();
    if (!parent || !widget)
        return;
    Value ref = RefArg(widget);
    std::string e;
    if (!Call(parent, "ReorderChild", Args({ref, Number(double(at))}), e))
        Note(aErrors, aKey + ": " + e);
    DropRefArg(ref);
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
    for (const auto& key : aMount.roots)
        built += BuildTree(aMount, key, aErrors);
    Log("Ink: %s's mount %s on %s: %zu of %zu widgets built (build %u)", aMount.package.c_str(), aMount.key.c_str(),
        aMount.layer.c_str(), built, aMount.nodes.size(), aMount.builds);
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
                if (k == "bind" && iv.kind == Value::Kind::Object && v.kind == Value::Kind::Object)
                    Merge(iv, v); // bindings add up; a null unties one
                else
                    iv = v;
                found = true;
                break;
            }
        }
        if (!found)
            aInto.fields.emplace_back(k, v);
    }
    if (const Value* binds = aInto.Get("bind"); binds && binds->kind == Value::Kind::Object)
    {
        for (auto& [ik, iv] : aInto.fields)
        {
            if (ik == "bind")
                std::erase_if(iv.fields, [](const auto& f) { return f.second.IsNull(); });
        }
    }
}

// The node and every node under it.
void Subtree(const Mount& aMount, const std::string& aKey, std::vector<std::string>& aOut)
{
    aOut.push_back(aKey);
    if (auto it = aMount.nodes.find(aKey); it != aMount.nodes.end())
    {
        for (const auto& child : it->second.children)
            Subtree(aMount, child, aOut);
    }
}

void Track(Mount& aMount, const std::string& aKey)
{
    const Value* binding = aMount.nodes[aKey].props.Get("binding");
    const bool has = binding && binding->kind == Value::Kind::Object;
    const bool listed = std::find(aMount.bound.begin(), aMount.bound.end(), aKey) != aMount.bound.end();
    if (has && !listed)
        aMount.bound.push_back(aKey);
    if (!has && listed)
        std::erase(aMount.bound, aKey);
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
        Node& added = m.nodes[key];
        auto& siblings = Siblings(m, added);
        const Value* index = aOp.Get("index");
        const bool inside = index && index->kind == Value::Kind::Number && index->number >= 0 &&
                            size_t(index->number) < siblings.size();
        siblings.insert(inside ? siblings.begin() + std::ptrdiff_t(index->number) : siblings.end(), key);
        Track(m, key);
        if (m.canvas.Lock() && BuildNode(m, key, aErrors) && inside)
            PlaceWidget(m, key, aErrors); // AddChild put it last
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
        if (props->Get("binding"))
        {
            n->second.shown.clear();
            n->second.fraction = -1;
            Track(m, key);
        }
        Obj widget = n->second.widget.Lock();
        if (!widget)
            return; // applied when the mount is built again
        ApplyAll(widget, key, *props, aErrors);
        return;
    }

    if (op == "remove")
    {
        Obj parent = ParentOf(m, n->second);
        Obj widget = n->second.widget.Lock();
        RemoveWidget(parent, widget); // its children go with it
        std::erase(Siblings(m, n->second), key);
        std::vector<std::string> gone;
        Subtree(m, key, gone);
        for (const auto& k : gone)
        {
            m.nodes.erase(k);
            std::erase(m.bound, k);
        }
        return;
    }

    if (op == "move")
    {
        const Value* index = aOp.Get("index");
        if (!index || index->kind != Value::Kind::Number || index->number < 0)
            return Note(aErrors, key + ": move needs an index");
        auto& siblings = Siblings(m, n->second);
        std::erase(siblings, key);
        const size_t at = std::min(size_t(index->number), siblings.size());
        siblings.insert(siblings.begin() + std::ptrdiff_t(at), key);
        PlaceWidget(m, key, aErrors);
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

// ---------- bindings (I2c) ----------
//
// Game values a node shows with no round trip to Node. Each source is read at most once a
// frame, and only while some node binds it. The game objects they come from are found again
// every 2 s, or when they are gone (a save load).

struct Sources
{
    WeakHandle<IScriptable> player;
    Value statsId;
    Value money; // the eddies' item id
    WeakHandle<IScriptable> pools;
    WeakHandle<IScriptable> stats;
    WeakHandle<IScriptable> shop;
    WeakHandle<IScriptable> time;
    uint64_t foundAt = 0;
    bool found = false;
};
Sources& g_sources = *new Sources();
std::unordered_map<std::string, double>& g_values = *new std::unordered_map<std::string, double>(); // this frame's
uint64_t g_valuesFrame = 0;
double g_bindMicros = 0;
uint64_t g_bindFrames = 0;
uint64_t g_bindLogAt = 0;

Obj System(const char* aGetter)
{
    Obj none;
    Obj system;
    std::string e;
    CallNative(none, "GameInstance", aGetter, Args({EmptyObject()}), &system, e);
    return system;
}

bool FindSources(uint64_t aFrame)
{
    if (g_sources.found && g_sources.player.Lock() && aFrame - g_sources.foundAt < 120)
        return true;
    g_sources.found = false;
    g_sources.foundAt = aFrame;
    Obj none;
    Obj player;
    std::string e;
    if (!CallNative(none, nullptr, "GetPlayer", Args({EmptyObject()}), &player, e) || !player)
        return false;
    Value entity;
    if (!CallNativeValue(player, nullptr, "GetEntityID", Args(), entity, e))
        return false;
    if (!CallNativeValue(none, nullptr, "Cast;EntityID;StatsObjectID", Args({entity}), g_sources.statsId, e))
        return false;
    CallNativeValue(none, "MarketSystem", "Money", Args(), g_sources.money, e);
    g_sources.player = player;
    g_sources.pools = System("GetStatPoolsSystem");
    g_sources.stats = System("GetStatsSystem");
    g_sources.shop = System("GetTransactionSystem");
    g_sources.time = System("GetTimeSystem");
    g_sources.found = true;
    return true;
}

bool ReadNumber(Obj& aSelf, const char* aFn, const Value& aArgs, double& aOut)
{
    Value v;
    std::string e;
    if (!aSelf || !CallNativeValue(aSelf, nullptr, aFn, aArgs, v, e) || v.kind != Value::Kind::Number)
        return false;
    aOut = v.number;
    return true;
}

// One source's value this frame, read once.
bool Source(const std::string& aName, uint64_t aFrame, double& aOut)
{
    if (g_valuesFrame != aFrame)
    {
        g_values.clear();
        g_valuesFrame = aFrame;
    }
    if (auto it = g_values.find(aName); it != g_values.end())
    {
        aOut = it->second;
        return true;
    }
    if (!FindSources(aFrame))
        return false;
    Obj player = g_sources.player.Lock();
    Obj pools = g_sources.pools.Lock();
    Obj stats = g_sources.stats.Lock();
    const Value& id = g_sources.statsId;
    bool ok = false;
    double v = 0;
    if (aName == "player.health")
        ok = ReadNumber(pools, "GetStatPoolValue", Args({id, Text("Health"), Bool(false)}), v);
    else if (aName == "player.healthMax")
        ok = ReadNumber(pools, "GetStatPoolMaxPointValue", Args({id, Text("Health")}), v);
    else if (aName == "player.stamina")
        ok = ReadNumber(pools, "GetStatPoolValue", Args({id, Text("Stamina"), Bool(true)}), v);
    else if (aName == "player.memory")
        ok = ReadNumber(pools, "GetStatPoolValue", Args({id, Text("Memory"), Bool(true)}), v);
    else if (aName == "player.level")
        ok = ReadNumber(stats, "GetStatValue", Args({id, Text("Level")}), v);
    else if (aName == "player.streetCred")
        ok = ReadNumber(stats, "GetStatValue", Args({id, Text("StreetCred")}), v);
    else if (aName == "player.money")
    {
        Obj shop = g_sources.shop.Lock();
        if (shop && player && g_sources.money.kind == Value::Kind::Object)
        {
            Value who = RefArg(player);
            ok = ReadNumber(shop, "GetItemQuantity", Args({who, g_sources.money}), v);
            DropRefArg(who);
        }
    }
    else if (aName == "player.x" || aName == "player.y" || aName == "player.z")
    {
        Value pos;
        std::string e;
        if (player && CallNativeValue(player, nullptr, "GetWorldPosition", Args(), pos, e))
        {
            for (const char* axis : {"X", "Y", "Z"})
            {
                const Value* a = pos.Get(axis);
                if (a && a->kind == Value::Kind::Number)
                    g_values[std::string("player.") + char(axis[0] + ('x' - 'X'))] = a->number;
            }
            if (auto it = g_values.find(aName); it != g_values.end())
            {
                aOut = it->second;
                return true;
            }
        }
    }
    else if (aName == "game.hour" || aName == "game.minute")
    {
        Obj time = g_sources.time.Lock();
        Value t;
        std::string e;
        if (time && CallNativeValue(time, nullptr, "GetGameTime", Args(), t, e))
        {
            const Value* seconds = t.Get("seconds");
            if (seconds && seconds->kind == Value::Kind::Number)
            {
                const long long total = (long long)seconds->number;
                g_values["game.hour"] = double((total / 3600) % 24);
                g_values["game.minute"] = double((total / 60) % 60);
                aOut = g_values[aName];
                return true;
            }
        }
    }
    if (!ok)
        return false;
    g_values[aName] = v;
    aOut = v;
    return true;
}

std::string Format(const Value& aBinding, double aValue)
{
    const Value* d = aBinding.Get("decimals");
    const int decimals = d && d->kind == Value::Kind::Number ? std::clamp(int(d->number), 0, 6) : 0;
    char number[64];
    std::snprintf(number, sizeof(number), "%.*f", decimals, aValue);
    std::string format = Field(aBinding, "format");
    if (format.empty())
        return number;
    for (size_t at = format.find("{value}"); at != std::string::npos; at = format.find("{value}", at))
    {
        format.replace(at, 7, number);
        at += std::strlen(number);
    }
    return format;
}

void UpdateBindings(uint64_t aFrame)
{
    const auto started = std::chrono::steady_clock::now();
    size_t count = 0;
    for (auto& [id, m] : g_mounts)
    {
        for (const auto& key : m.bound)
        {
            auto it = m.nodes.find(key);
            if (it == m.nodes.end())
                continue;
            Node& node = it->second;
            const Value* binding = node.props.Get("binding");
            Obj widget = node.widget.Lock();
            if (!binding || binding->kind != Value::Kind::Object || !widget)
                continue;
            ++count;
            double value = 0;
            if (!Source(Field(*binding, "source"), aFrame, value))
                continue;
            if (Field(*binding, "target") == "scaleX")
            {
                double of = 1;
                const Value* ofValue = binding->Get("of");
                if (ofValue && ofValue->kind == Value::Kind::Number)
                    of = ofValue->number;
                else if (ofValue && ofValue->kind == Value::Kind::String && !Source(ofValue->text, aFrame, of))
                    continue;
                const double fraction = of > 0 ? std::clamp(value / of, 0.0, 1.0) : 0.0;
                if (std::abs(fraction - node.fraction) < 0.001)
                    continue;
                node.fraction = fraction;
                std::string e;
                Call(widget, "SetScale", Args({Vector2(fraction, 1)}), e);
                continue;
            }
            const std::string text = Format(*binding, value);
            if (text == node.shown)
                continue;
            node.shown = text;
            std::string e;
            ApplyProp(widget, "text", Text(text), e);
        }
    }
    if (!count)
        return;
    g_bindMicros += std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - started).count();
    g_bindFrames += 1;
    if (aFrame - g_bindLogAt >= 1800) // about every 30 s at 60 fps
    {
        Log("Ink: %zu binding(s), %zu source(s) a frame, %.1f us a frame on average", count, g_values.size(),
            g_bindMicros / double(g_bindFrames));
        g_bindLogAt = aFrame;
        g_bindMicros = 0;
        g_bindFrames = 0;
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
    std::map<std::string, int> counts;
    for (const auto& op : ops->items)
    {
        counts[Field(op, "op")] += 1;
        RunOp(package, op, errors);
    }
    // A batch that adds, removes or moves widgets is logged with its ops, to see that a
    // change sends only what changed (I2c); changes of props alone stay quiet.
    if (counts["add"] || counts["remove"] || counts["move"])
    {
        Log("Ink: %s: %d add, %d remove, %d move, %d set", package.c_str(), counts["add"], counts["remove"],
            counts["move"], counts["set"]);
    }
    if (!errors.empty())
        Log("Ink: %s: %zu error(s), the first: %s", package.c_str(), errors.size(), errors.front().c_str());
    return ErrorsJson(errors);
}

void UpdateInk(uint64_t aFrame)
{
    if (g_hostGone.exchange(false))
        RemoveMounts(nullptr);
    if (g_mounts.empty())
        return;
    if (!InMainMenu())
        UpdateBindings(aFrame);
    if (aFrame % CheckFrames)
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
    g_sources = Sources{};
    g_mounts.clear();
}
} // namespace rednode::overlay::detail
