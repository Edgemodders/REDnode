// Reading the game's own UI (UT2, docs/ink.md "UT2: build"): what the UI Workbench's Inspect
// tab shows. Reads only: nothing here changes a widget. On the game thread, as the ink driver.
//
//   ink.layers {}
//     -> {"layers":[{"name":"inkHUDLayer","active":true,"interactive":false,"input":"...",
//          "size":[w,h],"window":"w1","children":n,
//          "entries":[{"name":"healthbar","enabled":true,"window":"w5","root":"w6",
//                      "controller":"healthbarWidgetGameController","library":"0x..."}]}]}
//     Every ink layer Codeware lists, in its order, with its window; the HUD layer also lists its
//     entries (each HUD piece the game spawned, with its own window when it has one).
//   ink.read {"id":"w12"} or {"layer":"inkHUDLayer"} or {"ref":{"$ref":n}}, "depth":99, "max":5000
//     -> {"root":{node},"nodes":N,"cut":false,"ms":t}
//     node: {"id","class","name","visible","opacity","box":[x,y,w,h],"controller","text","count",
//            "children":[node...]}; children is left out past the depth or the max (count says how many)
//   ink.inspect {"id":"w12"}
//     -> one widget in full: its class chain, path, box, controllers, where it came from (the
//        library file's hash, its layer, the HUD entry) and every property, plus "ref" for api.
//   ink.at {"x":..,"y":..}
//     -> {"hits":[{"id","class","name","box","layer","entry","depth","path"}],"looked":N,"ms":t}
//     The visible widgets whose box holds the point, on every active layer, deepest first.
//   ink.boxes {}
//     -> {"widgets":[{"id","class","name","box","layer","entry","depth"}],"looked":N,"ms":t}
//     Every visible widget with a box, deepest first: a page that picks finds what is under the
//     cursor on each move from these, without asking the game each time.
//
// Widget ids ("w12") stay the same for a widget while it lives, so a tree can be read again.
// Boxes come from inkWidgetUtils.LocalToGlobal at the widget's corner and at its size; for a
// HUD entry with a window of its own, the game draws that window into the entry's slot, so its
// boxes are placed at the slot and scaled by the slot's size over the window's (0.53.4; RED Hot
// Tools' Ink Inspector adds only the slot's place, and 0.53.3 did too: boxes in dpad_hint came
// out too large and too far right). ink.layers gives each entry's slot, window size and scale.
// The structs (ink::Layer, ink::HUDLayer's entries, ink::Widget) are RED4ext.SDK's for game 2.5.

#include "jvalue.hpp"
#include "overlay.hpp"

#include <RED4ext/Scripting/Natives/CResource.hpp>
#include <RED4ext/Scripting/Natives/inkHUDLayer.hpp>
#include <RED4ext/Scripting/Natives/inkHudWidgetSpawnEntry.hpp>
#include <RED4ext/Scripting/Natives/inkLayer.hpp>
#include <RED4ext/Scripting/Natives/inkLayerProxy.hpp>
#include <RED4ext/Scripting/Natives/inkWidget.hpp>

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <shared_mutex>
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

constexpr int MaxDepth = 99;
constexpr size_t MaxRead = 20000;  // nodes in one ink.read
constexpr size_t MaxLooked = 40000; // widgets ink.at looks at
constexpr size_t MaxHits = 60;
constexpr size_t MaxText = 120; // characters of a text widget's text in a tree

// Widget ids. Never destroyed (weak handles must not be let go at DLL unload); ClearInkRead
// empties them while the game still runs.
std::unordered_map<IScriptable*, uint32_t>& g_ids = *new std::unordered_map<IScriptable*, uint32_t>();
std::unordered_map<uint32_t, WeakHandle<IScriptable>>& g_widgets =
    *new std::unordered_map<uint32_t, WeakHandle<IScriptable>>();
uint32_t g_nextId = 1;

const CClass* ClassOf(const char* aName)
{
    return CRTTISystem::Get()->GetClass(aName);
}

bool IsA(const Obj& aObject, const char* aClass)
{
    const CClass* c = ClassOf(aClass);
    return aObject && c && aObject->GetType()->IsA(c);
}

std::string ClassName(const Obj& aObject)
{
    return aObject ? std::string(aObject->GetType()->GetName().ToString()) : std::string();
}

std::string IdOf(const Obj& aWidget)
{
    if (!aWidget)
        return {};
    IScriptable* raw = aWidget.GetPtr();
    if (auto it = g_ids.find(raw); it != g_ids.end())
    {
        auto found = g_widgets.find(it->second);
        if (found != g_widgets.end() && found->second.Lock().GetPtr() == raw)
            return "w" + std::to_string(it->second);
    }
    if (g_widgets.size() > 200000)
    {
        for (auto it = g_widgets.begin(); it != g_widgets.end();)
            it = it->second.Lock() ? std::next(it) : g_widgets.erase(it);
        for (auto it = g_ids.begin(); it != g_ids.end();)
            it = g_widgets.contains(it->second) ? std::next(it) : g_ids.erase(it);
    }
    const uint32_t id = g_nextId++;
    g_widgets[id] = WeakHandle<IScriptable>(aWidget);
    g_ids[raw] = id;
    return "w" + std::to_string(id);
}

Obj FromId(const std::string& aId)
{
    if (aId.size() < 2 || aId[0] != 'w')
        return {};
    auto it = g_widgets.find(uint32_t(std::strtoul(aId.c_str() + 1, nullptr, 10)));
    return it == g_widgets.end() ? Obj{} : it->second.Lock();
}

std::string Num(double aValue)
{
    char text[32];
    std::snprintf(text, sizeof(text), "%.6g", aValue);
    return text;
}

Value Number(double aValue)
{
    Value v;
    v.kind = Value::Kind::Number;
    v.number = aValue;
    char text[32];
    std::snprintf(text, sizeof(text), "%.9g", aValue);
    v.text = text;
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

Value Args(std::vector<Value> aItems = {})
{
    Value v;
    v.kind = Value::Kind::Array;
    v.items = std::move(aItems);
    return v;
}

Value Text(std::string aText)
{
    Value v;
    v.kind = Value::Kind::String;
    v.text = std::move(aText);
    return v;
}

ink::Widget* AsWidget(const Obj& aObject)
{
    static const CClass* widget = ClassOf("inkWidget");
    return aObject && widget && aObject->GetType()->IsA(widget) ? reinterpret_cast<ink::Widget*>(aObject.GetPtr())
                                                                : nullptr;
}

// A property's place in an object, by name, when it has the given kind.
template<typename T>
T* PropertyOf(const Obj& aObject, const char* aName)
{
    if (!aObject)
        return nullptr;
    const CName name(aName);
    for (const CClass* c = aObject->GetType(); c; c = c->parent)
    {
        for (const CProperty* p : c->props)
        {
            if (p->name == name)
                return p->GetValuePtr<T>(aObject.GetPtr());
        }
    }
    return nullptr;
}

// A compound widget's children, in their order (its inkMultiChildren's array).
std::vector<Obj> Children(const Obj& aWidget)
{
    std::vector<Obj> out;
    static const CClass* compound = ClassOf("inkCompoundWidget");
    if (!aWidget || !compound || !aWidget->GetType()->IsA(compound))
        return out;
    auto* holder = PropertyOf<Handle<IScriptable>>(aWidget, "children");
    if (!holder || !*holder)
        return out;
    auto* list = PropertyOf<DynArray<Handle<IScriptable>>>(*holder, "children");
    if (!list)
        return out;
    out.reserve(list->Size());
    for (const auto& child : *list)
    {
        if (child)
            out.push_back(child);
    }
    return out;
}

Obj ParentOf(ink::Widget* aWidget)
{
    std::shared_lock lock(aWidget->parentLock);
    return Obj(aWidget->parentWidget.Lock());
}

// The point of a widget's own space on screen (inkWidgetUtils.LocalToGlobal).
bool ToGlobal(const Obj& aWidget, double aX, double aY, double& aOutX, double& aOutY)
{
    Obj none;
    Value arg = RefArg(aWidget);
    Value out;
    std::string error;
    const bool ok =
        CallNativeValue(none, "inkWidgetUtils", "LocalToGlobal", Args({arg, Vector2(aX, aY)}), out, error);
    DropRefArg(arg);
    const Value* x = ok ? out.Get("X") : nullptr;
    const Value* y = ok ? out.Get("Y") : nullptr;
    if (!x || !y)
        return false;
    aOutX = x->number;
    aOutY = y->number;
    return true;
}

struct Box
{
    double x = 0, y = 0, w = 0, h = 0;
    bool known = false;

    bool Holds(double aX, double aY) const
    {
        return known && aX >= x && aY >= y && aX < x + w && aY < y + h;
    }
};

// Where a window's own space lands on screen: none for a layer's window; for a HUD entry with a
// window of its own, the game draws that window into the entry's slot, at the slot's place and
// scaled to the slot's size (0.53.2's run: boxes in dpad_hint were too large and too far right
// with the place alone).
struct Place
{
    double x = 0, y = 0, sx = 1, sy = 1;
};

// A widget's box on screen, in a window placed by aPlace.
Box BoxOf(const Obj& aWidget, const Place& aPlace = {})
{
    Box box;
    ink::Widget* w = AsWidget(aWidget);
    double x0, y0, x1, y1;
    if (!w || !ToGlobal(aWidget, 0, 0, x0, y0) || !ToGlobal(aWidget, w->size.X, w->size.Y, x1, y1))
        return box;
    box.x = aPlace.x + std::min(x0, x1) * aPlace.sx;
    box.y = aPlace.y + std::min(y0, y1) * aPlace.sy;
    box.w = std::abs(x1 - x0) * aPlace.sx;
    box.h = std::abs(y1 - y0) * aPlace.sy;
    box.known = true;
    return box;
}

std::string BoxJson(const Box& aBox)
{
    return aBox.known ? "[" + Num(aBox.x) + "," + Num(aBox.y) + "," + Num(aBox.w) + "," + Num(aBox.h) + "]" : "null";
}

std::string TextOf(const Obj& aWidget)
{
    if (!IsA(aWidget, "inkTextWidget"))
        return {};
    Obj self = aWidget;
    Value out;
    std::string error;
    if (!CallNativeValue(self, nullptr, "GetText", Args(), out, error) || out.kind != Value::Kind::String)
        return {};
    return out.text;
}

// The library file a widget was spawned from: its own layer proxy's resource, or the nearest
// parent's. Its hash ("0x..."), or empty.
std::string LibraryOf(const Obj& aWidget)
{
    Obj at = aWidget;
    for (int depth = 0; at && depth < 200; ++depth)
    {
        ink::Widget* w = AsWidget(at);
        if (!w)
            break;
        if (w->layerProxy)
        {
            // Its class is only declared in the SDK: held as the resource base it is.
            auto resource = reinterpret_cast<const WeakHandle<ISerializable>*>(&w->layerProxy->resource)->Lock();
            if (resource)
            {
                char hash[24];
                std::snprintf(hash, sizeof(hash), "0x%016llx",
                              static_cast<unsigned long long>(reinterpret_cast<CResource*>(resource.GetPtr())->path.hash));
                return hash;
            }
        }
        at = ParentOf(w);
    }
    return {};
}

std::string LayerOf(const Obj& aWidget)
{
    ink::Widget* w = AsWidget(aWidget);
    if (!w || !w->layerProxy)
        return {};
    auto layer = w->layerProxy->layer.Lock();
    return layer ? std::string(layer->GetType()->GetName().ToString()) : std::string();
}

// ---------- layers ----------

struct Entry
{
    std::string name;
    Obj window; // its own window, or null when it is in the layer's
    Obj root;
    Obj slot;
};

struct Layer
{
    Obj window;
    Handle<ink::Layer> native; // the game's layer, from the window's layer proxy; null if it has none
    ink::Layer* layer = nullptr;
    std::string name;
    std::vector<Entry> entries;
};

// The game's layer behind a window, through the window's layer proxy (RED4ext.SDK's structs).
// The window's own proxy first, then its first children's (unverified which of them has one).
Handle<ink::Layer> NativeLayer(const Obj& aWindow)
{
    ink::Widget* w = AsWidget(aWindow);
    if (w && w->layerProxy)
    {
        if (auto layer = w->layerProxy->layer.Lock())
            return layer;
    }
    int looked = 0;
    for (const auto& child : Children(aWindow))
    {
        ink::Widget* c = AsWidget(child);
        if (c && c->layerProxy)
        {
            if (auto layer = c->layerProxy->layer.Lock())
                return layer;
        }
        if (++looked == 4)
            break;
    }
    return {};
}

std::vector<Layer> Layers(std::string& aError)
{
    std::vector<Layer> out;
    Obj none;
    Obj system;
    if (!CallNative(none, "GameInstance", "GetInkSystem", Args(), &system, aError) || !system)
    {
        aError = "reading the game's UI needs Codeware, which is not installed or not ready (" + aError + ")";
        return out;
    }
    Value list;
    if (!CallNativeValue(system, nullptr, "GetLayers", Args(), list, aError) || list.kind != Value::Kind::Array)
    {
        aError = "Codeware did not list the ink layers" + (aError.empty() ? std::string() : ": " + aError);
        return out;
    }
    // Codeware lists the game's inkLayerWrapper objects (found in game 2.5 with Codeware 1.21):
    // the layer's name and window come from the wrapper's own functions, the layer itself from
    // the window. A list of the layers themselves is taken as well.
    static const CClass* wrapperClass = ClassOf("inkLayerWrapper");
    static const CClass* layerClass = ClassOf("inkLayer");
    static const CClass* hudClass = ClassOf("inkHUDLayer");
    for (const auto& item : list.items)
    {
        Obj object = RefObject(item);
        DropRefArg(item);
        if (!object)
            continue;
        Layer l;
        if (wrapperClass && object->GetType()->IsA(wrapperClass))
        {
            std::string error;
            Value name;
            if (CallNativeValue(object, nullptr, "GetLayerName", Args(), name, error) &&
                name.kind == Value::Kind::String)
                l.name = name.text;
            CallNative(object, nullptr, "GetVirtualWindow", Args(), &l.window, error);
            l.native = NativeLayer(l.window);
        }
        else if (layerClass && object->GetType()->IsA(layerClass))
        {
            l.native = Handle<ink::Layer>(*reinterpret_cast<const Handle<ink::Layer>*>(&object));
            l.window = Obj(*reinterpret_cast<const Handle<IScriptable>*>(&l.native->window));
        }
        else
        {
            continue;
        }
        l.layer = l.native.GetPtr();
        if (l.layer && l.name.empty())
            l.name = l.layer->GetType()->GetName().ToString();
        if (l.layer && hudClass && l.layer->GetType()->IsA(hudClass))
        {
            auto* hud = reinterpret_cast<ink::HUDLayer*>(l.layer);
            for (const auto& e : hud->entries)
            {
                Entry entry;
                entry.name = e.hudEntryName.ToString();
                entry.window = Obj(*reinterpret_cast<const Handle<IScriptable>*>(&e.window));
                entry.root = Obj(*reinterpret_cast<const Handle<IScriptable>*>(&e.rootWidget));
                entry.slot = Obj(*reinterpret_cast<const Handle<IScriptable>*>(&e.slotWidget));
                if (entry.window && l.window && entry.window.GetPtr() == l.window.GetPtr())
                    entry.window = {};
                l.entries.push_back(std::move(entry));
            }
        }
        out.push_back(std::move(l));
    }
    return out;
}

Obj WindowOf(const Layer& aLayer)
{
    return aLayer.window;
}

// A HUD entry's own window on screen: its slot's place, and the slot's size over the window's
// (no scale when either size is unknown). The slot is a widget of the layer's window.
Place PlaceOf(const Entry& aEntry, Box* aSlot = nullptr)
{
    Place place;
    if (!aEntry.slot)
        return place;
    const Box slot = BoxOf(aEntry.slot);
    if (aSlot)
        *aSlot = slot;
    if (!slot.known)
        return place;
    place.x = slot.x;
    place.y = slot.y;
    ink::Widget* window = AsWidget(aEntry.window);
    if (window && window->size.X > 0 && window->size.Y > 0 && slot.w > 0 && slot.h > 0)
    {
        place.sx = slot.w / window->size.X;
        place.sy = slot.h / window->size.Y;
    }
    return place;
}

std::string LayersJson(std::string& aError)
{
    auto layers = Layers(aError);
    if (!aError.empty())
        return {};
    std::string out = "{\"layers\":[";
    bool first = true;
    for (const auto& l : layers)
    {
        out += first ? "" : ",";
        first = false;
        Obj window = WindowOf(l);
        // Without the game's layer (a window with no layer proxy): what the window says, active unknown.
        ink::Widget* w = AsWidget(window);
        const RED4ext::Vector2 size = l.layer ? l.layer->size : w ? w->size : RED4ext::Vector2{};
        out += "{\"name\":" + JsonString(l.name) +
               ",\"active\":" + (!l.layer ? "null" : l.layer->active ? "true" : "false") +
               ",\"interactive\":" + (!l.layer ? "null" : l.layer->isInteractive ? "true" : "false") +
               ",\"input\":" + (l.layer ? JsonString(l.layer->inputContext.ToString()) : "null") + ",\"size\":[" +
               Num(size.X) + "," + Num(size.Y) + "],\"window\":" + (window ? JsonString(IdOf(window)) : "null") +
               ",\"children\":" + std::to_string(Children(window).size());
        if (!l.entries.empty())
        {
            out += ",\"entries\":[";
            auto* hud = reinterpret_cast<ink::HUDLayer*>(l.layer);
            for (size_t i = 0; i < l.entries.size(); ++i)
            {
                const auto& e = l.entries[i];
                const auto& raw = hud->entries[uint32_t(i)];
                Obj controller(*reinterpret_cast<const Handle<IScriptable>*>(&raw.gameController));
                char library[24];
                std::snprintf(library, sizeof(library), "0x%016llx",
                              static_cast<unsigned long long>(raw.widgetResource.path.hash));
                out += std::string(i ? "," : "") + "{\"name\":" + JsonString(e.name) +
                       ",\"enabled\":" + (raw.enabled ? "true" : "false") +
                       ",\"window\":" + (e.window ? JsonString(IdOf(e.window)) : "null") +
                       ",\"root\":" + (e.root ? JsonString(IdOf(e.root)) : "null") +
                       ",\"controller\":" + (controller ? JsonString(ClassName(controller)) : "null") +
                       ",\"library\":" + JsonString(library);
                // Where its own window is drawn: the slot's box and the window's size, and the scale.
                if (e.window)
                {
                    Box slot;
                    const Place place = PlaceOf(e, &slot);
                    ink::Widget* ew = AsWidget(e.window);
                    out += ",\"slot\":" + BoxJson(slot) + ",\"windowSize\":" +
                           (ew ? "[" + Num(ew->size.X) + "," + Num(ew->size.Y) + "]" : std::string("null")) +
                           ",\"scale\":[" + Num(place.sx) + "," + Num(place.sy) + "]";
                }
                out += "}";
            }
            out += "]";
        }
        out += "}";
    }
    return out + "]}";
}

// The place of each HUD entry's own window, to find the one a widget is in.
struct Offsets
{
    std::unordered_map<IScriptable*, Place> byWindow;     // an entry's own window
    std::unordered_map<IScriptable*, std::string> names; // its name
};

Offsets EntryOffsets(const std::vector<Layer>& aLayers)
{
    Offsets out;
    for (const auto& l : aLayers)
    {
        for (const auto& e : l.entries)
        {
            if (!e.window)
                continue;
            out.byWindow[e.window.GetPtr()] = PlaceOf(e);
            out.names[e.window.GetPtr()] = e.name;
        }
    }
    return out;
}

// The window at the top of a widget's parents, for its entry's offset.
Obj TopOf(const Obj& aWidget)
{
    Obj at = aWidget;
    for (int depth = 0; depth < 200; ++depth)
    {
        ink::Widget* w = AsWidget(at);
        if (!w)
            break;
        Obj parent = ParentOf(w);
        if (!parent)
            return at;
        at = parent;
    }
    return at;
}

// ---------- reading a tree ----------

struct Reader
{
    size_t nodes = 0;
    size_t max = 5000;
    int depth = MaxDepth;
    bool cut = false;
    bool boxes = true;
    Place place; // the window's place, for a HUD entry's own window
};

void NodeJson(Reader& aReader, const Obj& aWidget, int aDepth, std::string& aOut)
{
    ink::Widget* w = AsWidget(aWidget);
    aReader.nodes += 1;
    const auto children = Children(aWidget);
    aOut += "{\"id\":" + JsonString(IdOf(aWidget)) + ",\"class\":" + JsonString(ClassName(aWidget));
    if (w)
    {
        aOut += ",\"name\":" + JsonString(w->name.ToString()) + ",\"visible\":" + (w->visible ? "true" : "false") +
                ",\"opacity\":" + Num(w->opacity);
        if (aReader.boxes)
            aOut += ",\"box\":" + BoxJson(BoxOf(aWidget, aReader.place));
        if (w->logicController)
            aOut += ",\"controller\":" +
                    JsonString(ClassName(Obj(*reinterpret_cast<const Handle<IScriptable>*>(&w->logicController))));
    }
    std::string text = TextOf(aWidget);
    if (!text.empty())
    {
        if (text.size() > MaxText)
            text = text.substr(0, MaxText) + "...";
        aOut += ",\"text\":" + JsonString(text);
    }
    aOut += ",\"count\":" + std::to_string(children.size());
    if (!children.empty() && aDepth < aReader.depth && aReader.nodes < aReader.max)
    {
        aOut += ",\"children\":[";
        for (size_t i = 0; i < children.size(); ++i)
        {
            if (aReader.nodes >= aReader.max)
            {
                aReader.cut = true;
                break;
            }
            aOut += i ? "," : "";
            NodeJson(aReader, children[i], aDepth + 1, aOut);
        }
        aOut += "]";
    }
    else if (!children.empty())
    {
        aReader.cut = true;
    }
    aOut += "}";
}

double Elapsed(std::chrono::steady_clock::time_point aStart)
{
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - aStart).count();
}

int IntField(const Value& aParams, const char* aKey, int aDefault)
{
    const Value* v = aParams.Get(aKey);
    return v && v->kind == Value::Kind::Number ? int(v->number) : aDefault;
}

std::string StringField(const Value& aParams, const char* aKey)
{
    const Value* v = aParams.Get(aKey);
    return v && v->kind == Value::Kind::String ? v->text : std::string();
}

// The widget a request names: "id", "ref" (an api reference) or "layer" (its window).
Obj Target(const Value& aParams, std::string& aError)
{
    if (const std::string id = StringField(aParams, "id"); !id.empty())
    {
        Obj w = FromId(id);
        if (!w)
            aError = "widget " + id + " is gone (the game removed it, or a save was loaded): read the tree again";
        return w;
    }
    if (const Value* ref = aParams.Get("ref"))
    {
        Obj w = RefObject(*ref);
        if (!AsWidget(w))
            aError = "ref is not a live ink widget";
        return AsWidget(w) ? w : Obj{};
    }
    if (const std::string name = StringField(aParams, "layer"); !name.empty())
    {
        auto layers = Layers(aError);
        for (const auto& l : layers)
        {
            if (l.name == name)
            {
                Obj window = WindowOf(l);
                if (!window)
                    aError = name + " has no window now";
                return window;
            }
        }
        if (aError.empty())
            aError = "no ink layer " + name + " (ink.layers lists them)";
        return {};
    }
    aError = "give id, ref or layer";
    return {};
}

std::string ReadJson(const Value& aParams, std::string& aError)
{
    const auto start = std::chrono::steady_clock::now();
    Obj root = Target(aParams, aError);
    if (!root)
        return {};
    Reader reader;
    reader.depth = std::clamp(IntField(aParams, "depth", MaxDepth), 0, MaxDepth);
    reader.max = size_t(std::clamp(IntField(aParams, "max", 5000), 1, int(MaxRead)));
    const Value* boxes = aParams.Get("boxes");
    reader.boxes = !(boxes && boxes->kind == Value::Kind::Bool && !boxes->boolean);
    if (reader.boxes)
    {
        std::string ignored;
        const auto offsets = EntryOffsets(Layers(ignored));
        if (auto it = offsets.byWindow.find(TopOf(root).GetPtr()); it != offsets.byWindow.end())
            reader.place = it->second;
    }
    std::string node;
    NodeJson(reader, root, 0, node);
    Log("Ink read: %zu widgets%s in %.1f ms", reader.nodes, reader.cut ? " (cut)" : "", Elapsed(start));
    return "{\"root\":" + node + ",\"nodes\":" + std::to_string(reader.nodes) +
           ",\"cut\":" + (reader.cut ? "true" : "false") + ",\"ms\":" + Num(Elapsed(start)) + "}";
}

std::string PathOf(const Obj& aWidget, int& aDepth)
{
    std::vector<std::string> names;
    Obj at = aWidget;
    for (int depth = 0; at && depth < 200; ++depth)
    {
        ink::Widget* w = AsWidget(at);
        if (!w)
            break;
        names.push_back(w->name.ToString());
        at = ParentOf(w);
    }
    aDepth = int(names.size()) - 1;
    std::string out;
    for (auto it = names.rbegin(); it != names.rend(); ++it)
        out += (out.empty() ? "" : "/") + *it;
    return out;
}

std::string WidgetJson(const Value& aParams, std::string& aError)
{
    Obj widget = Target(aParams, aError);
    ink::Widget* w = AsWidget(widget);
    if (!w)
    {
        if (aError.empty())
            aError = "not an ink widget";
        return {};
    }
    std::string ignored;
    const auto layers = Layers(ignored);
    const auto offsets = EntryOffsets(layers);
    const Obj top = TopOf(widget);
    Place place;
    std::string entry;
    if (auto it = offsets.byWindow.find(top.GetPtr()); it != offsets.byWindow.end())
    {
        place = it->second;
        entry = offsets.names.at(top.GetPtr());
    }
    for (const auto& l : layers)
    {
        for (const auto& e : l.entries)
        {
            if (entry.empty() && e.root && e.root.GetPtr() == widget.GetPtr())
                entry = e.name;
        }
    }
    int depth = 0;
    const std::string path = PathOf(widget, depth);
    std::string classes = "[";
    for (const CClass* c = widget->GetType(); c; c = c->parent)
        classes += (classes.size() > 1 ? "," : "") + JsonString(c->GetName().ToString());
    classes += "]";
    std::string controllers = "[";
    if (w->logicController)
        controllers += JsonString(ClassName(Obj(*reinterpret_cast<const Handle<IScriptable>*>(&w->logicController))));
    for (const auto& c : w->secondaryControllers)
    {
        if (c)
            controllers += (controllers.size() > 1 ? "," : "") +
                           JsonString(ClassName(Obj(*reinterpret_cast<const Handle<IScriptable>*>(&c))));
    }
    controllers += "]";
    Obj parent = ParentOf(w);
    std::string children = "[";
    for (const auto& c : Children(widget))
        children += (children.size() > 1 ? "," : "") + JsonString(IdOf(c));
    children += "]";
    Value ref = RefArg(widget); // handed to the caller, for api
    std::string out = "{\"id\":" + JsonString(IdOf(widget)) + ",\"class\":" + JsonString(ClassName(widget)) +
                      ",\"classes\":" + classes + ",\"name\":" + JsonString(w->name.ToString()) +
                      ",\"path\":" + JsonString(path) + ",\"depth\":" + std::to_string(depth) +
                      ",\"parent\":" + (parent ? JsonString(IdOf(parent)) : "null") + ",\"children\":" + children +
                      ",\"box\":" + BoxJson(BoxOf(widget, place)) + ",\"visible\":" + (w->visible ? "true" : "false") +
                      ",\"controllers\":" + controllers + ",\"layer\":" + JsonString(LayerOf(widget)) +
                      ",\"entry\":" + (entry.empty() ? "null" : JsonString(entry)) +
                      ",\"library\":" + JsonString(LibraryOf(widget)) + ",\"ref\":{\"$ref\":" +
                      Num(ref.Get("$ref")->number) + "}";
    const std::string text = TextOf(widget);
    if (!text.empty())
        out += ",\"text\":" + JsonString(text);
    return out + ",\"properties\":" + PropertiesJson(widget) + "}";
}

// ---------- the widgets under a point ----------

struct Hit
{
    Obj widget;
    Box box;
    int depth = 0;
    std::string layer;
    std::string entry;
};

struct Picker
{
    double x = 0, y = 0;
    bool all = false; // ink.boxes: every visible widget with a box, wherever it is
    size_t looked = 0;
    std::vector<Hit> hits;
};

void Look(Picker& aPicker, const Obj& aWidget, int aDepth, const Place& aPlace, const std::string& aLayer,
          const std::string& aEntry)
{
    if (aPicker.looked >= MaxLooked)
        return;
    ink::Widget* w = AsWidget(aWidget);
    if (!w || !w->visible)
        return;
    aPicker.looked += 1;
    const Box box = BoxOf(aWidget, aPlace);
    if (aPicker.all ? box.known && box.w > 0 && box.h > 0 : box.Holds(aPicker.x, aPicker.y))
        aPicker.hits.push_back({aWidget, box, aDepth, aLayer, aEntry});
    // Children can draw outside their parent's box, so every visible child is looked at.
    for (const auto& child : Children(aWidget))
        Look(aPicker, child, aDepth + 1, aPlace, aLayer, aEntry);
}

// ink.at, or ink.boxes with aAll: every visible widget's box, for a page to find what is under
// the cursor on each move without asking the game (no paths, which cost a walk up each).
std::string AtJson(const Value& aParams, bool aAll, std::string& aError)
{
    const auto start = std::chrono::steady_clock::now();
    const Value* x = aParams.Get("x");
    const Value* y = aParams.Get("y");
    if (!aAll && (!x || !y || x->kind != Value::Kind::Number || y->kind != Value::Kind::Number))
    {
        aError = "x and y are required";
        return {};
    }
    auto layers = Layers(aError);
    if (!aError.empty())
        return {};
    Picker picker;
    picker.all = aAll;
    picker.x = aAll ? 0 : x->number;
    picker.y = aAll ? 0 : y->number;
    for (const auto& l : layers)
    {
        if ((l.layer && !l.layer->active) || l.name == "inkWatermarksLayer")
            continue;
        Look(picker, WindowOf(l), 0, Place{}, l.name, {});
        for (const auto& e : l.entries)
        {
            if (!e.window)
                continue;
            Look(picker, e.window, 0, PlaceOf(e), l.name, e.name);
        }
    }
    // Deepest first; at the same depth (a HUD entry's own window beside the layer's), the smaller
    // box, the more particular widget.
    std::stable_sort(picker.hits.begin(), picker.hits.end(), [](const Hit& a, const Hit& b) {
        if (a.depth != b.depth)
            return a.depth > b.depth;
        return a.box.w * a.box.h < b.box.w * b.box.h;
    });
    if (!aAll && picker.hits.size() > MaxHits)
        picker.hits.resize(MaxHits);
    if (aAll)
        Log("Ink boxes: %zu widgets with a box, %zu looked at in %.1f ms", picker.hits.size(), picker.looked,
            Elapsed(start));
    else
        Log("Ink pick at %.0f, %.0f: %zu hit(s), %zu widgets looked at in %.1f ms", picker.x, picker.y,
            picker.hits.size(), picker.looked, Elapsed(start));
    std::string out = aAll ? "{\"widgets\":[" : "{\"hits\":[";
    for (size_t i = 0; i < picker.hits.size(); ++i)
    {
        const auto& h = picker.hits[i];
        ink::Widget* w = AsWidget(h.widget);
        out += std::string(i ? "," : "") + "{\"id\":" + JsonString(IdOf(h.widget)) +
               ",\"class\":" + JsonString(ClassName(h.widget)) + ",\"name\":" + JsonString(w->name.ToString()) +
               ",\"box\":" + BoxJson(h.box) + ",\"layer\":" + JsonString(h.layer) +
               ",\"entry\":" + (h.entry.empty() ? "null" : JsonString(h.entry)) + ",\"depth\":" +
               std::to_string(h.depth);
        if (!aAll)
        {
            int depth = 0;
            out += ",\"path\":" + JsonString(PathOf(h.widget, depth));
        }
        out += "}";
    }
    return out + "],\"looked\":" + std::to_string(picker.looked) + ",\"ms\":" + Num(Elapsed(start)) + "}";
}
} // namespace

bool IsInkReadMethod(const std::string& aMethod)
{
    return aMethod == "ink.layers" || aMethod == "ink.read" || aMethod == "ink.inspect" || aMethod == "ink.at" ||
           aMethod == "ink.boxes";
}

std::string InkRead(const std::string& aMethod, const json::Value& aParams, std::string& aError)
{
    if (aMethod == "ink.layers")
        return LayersJson(aError);
    if (aMethod == "ink.read")
        return ReadJson(aParams, aError);
    if (aMethod == "ink.inspect")
        return WidgetJson(aParams, aError);
    return AtJson(aParams, aMethod == "ink.boxes", aError);
}

void ClearInkRead()
{
    g_widgets.clear();
    g_ids.clear();
}
} // namespace rednode::overlay::detail
