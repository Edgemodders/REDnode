// Weather (#46, for EDGEdir; docs/world.md "Weather (#46)"): set the weather, give it back to the
// game's own cycle, and read what it is. On the game thread, while V is in the world.
//
// Game 2.5 has no script call that sets the weather (worldWeatherScriptInterface only reads the
// rain). Quests set it with the node questPlayEnv_SetWeather, so this does what that node does,
// found by a static reading of 2.5's code (weather.hpp has the instruction forms):
//
//   - The weather system (worldRuntimeSystemWeather) is the object the script interface keeps at
//     +0x40 (its native GetRainIntensity reads the rain from it), checked by its class.
//   - The setter's address and the "held" flag's place come from the node's own run function
//     (slot 0x108 of its vtable, from an instance made through RTTI), checked instruction by
//     instruction. The setter takes (system, state name, source name, blend seconds, priority) and
//     answers whether it changed the weather; the node then clears the flag (the game's cycle off,
//     the weather held). A reset node only sets the flag again: the cycle picks the next weather
//     in its own time.
//   - The states are the world's environment definition's weatherStates (RTTI), reached through
//     the system's +0x60 and that object's +0x120, as the game's own state lookup does; each step
//     is checked by its class. The current state's index is at +0x90 (+0x88 while +0x84 is set),
//     the source at +0x98 and the priority at +0xA0, as the setter writes them; these are read for
//     the answer only.
//
//   weather.state {} -> {"state","index","held","source","priority","states":[names],"ms"}
//   weather.set {"state":"24h_weather_rain","blend":5,"priority":0,"source":"REDnode"}
//     -> {"applied","changed","state","was","held"}
//     The state is a name the world knows (weather.state's states); a WeatherPresets record's name
//     flat gives it (WeatherPresets.Rain is 24h_weather_rain). The weather stays until a reset, a
//     quest sets its own, or a save with other weather loads. A save made while it is held keeps
//     it held: the host gives it back to the game's cycle at the next session start when no
//     package holds it.
//   weather.reset {} -> {"held":false,"was"}
//
// The game's crash handler takes a fault before __try does, so reads of memory that is not known
// to be an object are checked with VirtualQuery first (worldnodes.cpp found this).

#include "jvalue.hpp"
#include "overlay.hpp"
#include "weather.hpp"

#include <RED4ext/CNamePool.hpp>
#include <RED4ext/RED4ext.hpp>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace rednode::overlay::detail
{
namespace
{
using namespace RED4ext;
using json::Value;

constexpr size_t RunSlot = 0x108;       // questPlayEnv_SetWeather's run function, 2.5
constexpr size_t SystemInScript = 0x40; // the weather system in worldWeatherScriptInterface
constexpr size_t SettingsInSystem = 0x60, DefinitionInSettings = 0x120;
constexpr size_t Blending = 0x84, BlendIndex = 0x88, StateIndex = 0x90, Source = 0x98, Priority = 0xA0;

// Names as their hashes: a CName is 8 bytes, passed in a register as the game passes it.
using Setter_t = bool (*)(void* aSystem, uint64_t aState, uint64_t aSource, float aBlend, uint32_t aPriority);

struct Found
{
    bool tried = false;
    std::string why; // empty when found
    Setter_t setter = nullptr;
    uint32_t held = 0;
};
Found g_found;

bool Readable(const void* aAt, size_t aBytes)
{
    const auto p = reinterpret_cast<uintptr_t>(aAt);
    if (p < 0x10000 || p > 0x7FFFFFFEFFFF || aBytes == 0)
        return false;
    uintptr_t at = p;
    const uintptr_t end = p + aBytes;
    while (at < end)
    {
        MEMORY_BASIC_INFORMATION mbi{};
        if (!VirtualQuery(reinterpret_cast<void*>(at), &mbi, sizeof(mbi)) || mbi.State != MEM_COMMIT)
            return false;
        const DWORD prot = mbi.Protect & 0xFF;
        if ((mbi.Protect & (PAGE_GUARD | PAGE_NOACCESS)) || prot == PAGE_EXECUTE)
            return false;
        at = reinterpret_cast<uintptr_t>(mbi.BaseAddress) + mbi.RegionSize;
    }
    return true;
}

bool InImage(const void* aAddress)
{
    static const auto range = []() {
        const auto* base = reinterpret_cast<const uint8_t*>(GetModuleHandleW(nullptr));
        const auto* dos = reinterpret_cast<const IMAGE_DOS_HEADER*>(base);
        const auto* nt = reinterpret_cast<const IMAGE_NT_HEADERS*>(base + dos->e_lfanew);
        return std::pair<const uint8_t*, const uint8_t*>(base, base + nt->OptionalHeader.SizeOfImage);
    }();
    const auto* p = static_cast<const uint8_t*>(aAddress);
    return p >= range.first && p < range.second;
}

template<typename T>
bool Read(const void* aAt, T& aOut)
{
    if (!Readable(aAt, sizeof(T)))
        return false;
    std::memcpy(&aOut, aAt, sizeof(T));
    return true;
}

// An engine object of aClass (or a child): readable, a vtable in the exe, its weak self handle
// (ISerializable +0x08) pointing back at it, and then its class.
bool IsA(void* aObject, const char* aClass)
{
    const void* vtable = nullptr;
    const void* self = nullptr;
    if (!Read(aObject, vtable) || !InImage(vtable))
        return false;
    if (!Read(static_cast<const uint8_t*>(aObject) + 0x08, self) || self != aObject)
        return false;
    const CClass* want = CRTTISystem::Get()->GetClass(aClass);
    const CClass* type = static_cast<ISerializable*>(aObject)->GetType();
    return want && type && type->IsA(want);
}

std::string NameOf(CName aName)
{
    if (!aName.hash)
        return {};
    const char* text = CNamePool::Get(aName);
    if (text && *text)
        return text;
    char buf[24];
    std::snprintf(buf, sizeof(buf), "0x%016llX", static_cast<unsigned long long>(aName.hash));
    return buf;
}

std::string NameJson(CName aName)
{
    return aName.hash ? JsonString(NameOf(aName)) : "null";
}

// The setter and the flag, from the quest node's code. Once.
bool FindSetter(std::string& aError)
{
    if (!g_found.tried)
    {
        g_found.tried = true;
        g_found.why = [&]() -> std::string {
            CClass* cls = CRTTISystem::Get()->GetClass("questPlayEnv_SetWeather");
            if (!cls)
                return "the game has no questPlayEnv_SetWeather";
            if (cls->size < 0x10 || cls->size > 0x400)
                return "questPlayEnv_SetWeather has an unexpected size";
            alignas(16) uint8_t mem[0x400] = {};
            cls->ConstructCls(mem);
            void** vtable = *reinterpret_cast<void***>(mem);
            cls->DestructCls(mem);
            if (!InImage(vtable))
                return "the node's vtable is not in the exe";
            const auto* run = static_cast<const uint8_t*>(vtable[RunSlot / sizeof(void*)]);
            if (!InImage(run) || !InImage(run + 0xA0))
                return "the node's run function is not in the exe";
            const weather::NodeCode code = weather::ReadNodeCode(run, 0xA0);
            if (!code.ok)
                return std::string("the node's code is not as on game 2.5: ") + code.why;
            const auto* setter = run + code.setterCall + 5 + code.setterRel;
            if (!InImage(setter))
                return "the weather setter is not in the exe";
            g_found.setter = reinterpret_cast<Setter_t>(const_cast<uint8_t*>(setter));
            g_found.held = code.heldOffset;
            const auto base = reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr));
            Log("Weather: setter at +0x%llx, held flag at +0x%x, quest context +0x%x",
                static_cast<unsigned long long>(reinterpret_cast<uintptr_t>(setter) - base), code.heldOffset,
                code.contextOffset);
            return {};
        }();
        if (!g_found.why.empty())
            Log("Weather: not available: %s", g_found.why.c_str());
    }
    if (!g_found.why.empty())
        aError = "Weather is not available on this game version: " + g_found.why;
    return g_found.why.empty();
}

Value NullArgs(size_t aCount)
{
    Value args;
    args.kind = Value::Kind::Array;
    args.items.resize(aCount);
    return args;
}

// The weather system, through the script interface. aKeep holds the interface while it is used.
uint8_t* System(Handle<IScriptable>& aKeep, std::string& aError)
{
    if (!InWorld())
    {
        aError = "V is not in the world";
        return nullptr;
    }
    Handle<IScriptable> none;
    if (!CallNative(none, "ScriptGameInstance", "GetWeatherSystem", NullArgs(1), &aKeep, aError))
        return nullptr;
    if (!aKeep || aKeep->GetType()->size < SystemInScript + 8)
    {
        aError = "the game has no weather system";
        return nullptr;
    }
    void* system = *reinterpret_cast<void**>(reinterpret_cast<uint8_t*>(aKeep.GetPtr()) + SystemInScript);
    if (!IsA(system, "worldRuntimeSystemWeather"))
    {
        aError = "the weather interface's system is not worldRuntimeSystemWeather (not game 2.5?)";
        return nullptr;
    }
    return static_cast<uint8_t*>(system);
}

// The world's weather states, by name, in the system's order. Empty when not found.
std::vector<CName> States(uint8_t* aSystem)
{
    std::vector<CName> out;
    void* settings = nullptr;
    void* definition = nullptr;
    if (!Read(aSystem + SettingsInSystem, settings) || !settings ||
        !Read(static_cast<uint8_t*>(settings) + DefinitionInSettings, definition) ||
        !IsA(definition, "worldEnvironmentDefinition"))
        return out;
    auto* rtti = CRTTISystem::Get();
    CProperty* list = rtti->GetClass("worldEnvironmentDefinition")->GetProperty("weatherStates");
    CProperty* name = rtti->GetClass("worldWeatherState")->GetProperty("name");
    if (!list || !name)
        return out;
    // The array's fields as plain memory: a DynArray copy would free the game's array.
    struct Raw
    {
        uint8_t* entries;
        uint32_t capacity, size;
    } states{};
    constexpr size_t HandleSize = 16; // a handle: the object and its reference count
    if (!Read(static_cast<uint8_t*>(definition) + list->valueOffset, states) || states.size > 256 ||
        (states.size && !Readable(states.entries, states.size * HandleSize)))
        return out;
    for (uint32_t i = 0; i < states.size; ++i)
    {
        void* state = *reinterpret_cast<void**>(states.entries + i * HandleSize);
        CName n;
        if (!state || !IsA(state, "worldWeatherState") || !Read(static_cast<uint8_t*>(state) + name->valueOffset, n))
            n = CName();
        out.push_back(n);
    }
    return out;
}

uint32_t CurrentIndex(uint8_t* aSystem)
{
    return aSystem[Blending] ? *reinterpret_cast<uint32_t*>(aSystem + BlendIndex)
                             : *reinterpret_cast<uint32_t*>(aSystem + StateIndex);
}

CName CurrentState(uint8_t* aSystem, const std::vector<CName>& aStates)
{
    const uint32_t i = CurrentIndex(aSystem);
    return i < aStates.size() ? aStates[i] : CName();
}

std::string StateJson(const Value&, std::string& aError)
{
    const auto t0 = std::chrono::steady_clock::now();
    if (!FindSetter(aError))
        return {};
    Handle<IScriptable> keep;
    uint8_t* sys = System(keep, aError);
    if (!sys)
        return {};
    const auto states = States(sys);
    std::string list = "[";
    for (size_t i = 0; i < states.size(); ++i)
        list += (i ? "," : "") + NameJson(states[i]);
    list += "]";
    const uint32_t index = CurrentIndex(sys);
    const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
    char tail[64];
    std::snprintf(tail, sizeof(tail), ",\"ms\":%.2f}", ms);
    return "{\"state\":" + NameJson(CurrentState(sys, states)) + ",\"index\":" + std::to_string(index) +
           ",\"held\":" + (sys[g_found.held] ? "false" : "true") + ",\"source\":" +
           NameJson(*reinterpret_cast<CName*>(sys + Source)) +
           ",\"priority\":" + std::to_string(*reinterpret_cast<uint32_t*>(sys + Priority)) + ",\"states\":" + list +
           tail;
}

std::string SetJson(const Value& aParams, std::string& aError)
{
    const Value* state = aParams.Get("state");
    if (!state || state->kind != Value::Kind::String || state->text.empty())
    {
        aError = "weather.set needs a state, such as \"24h_weather_rain\"";
        return {};
    }
    const Value* blend = aParams.Get("blend");
    const Value* priority = aParams.Get("priority");
    const Value* source = aParams.Get("source");
    const float seconds = blend && blend->kind == Value::Kind::Number ? static_cast<float>(blend->number) : 5.0f;
    const double level = priority && priority->kind == Value::Kind::Number ? priority->number : 0;
    if (seconds < 0 || seconds > 600 || level < 0 || level > 7)
    {
        aError = "weather.set's blend is 0 to 600 seconds and its priority 0 to 7";
        return {};
    }
    const std::string sourceText =
        source && source->kind == Value::Kind::String && !source->text.empty() ? source->text : "REDnode";

    if (!FindSetter(aError))
        return {};
    Handle<IScriptable> keep;
    uint8_t* sys = System(keep, aError);
    if (!sys)
        return {};
    const auto states = States(sys);
    const CName want(state->text.c_str());
    bool known = states.empty();
    for (const CName& s : states)
        known = known || s == want;
    if (!known)
    {
        std::string names;
        for (const CName& s : states)
            names += (names.empty() ? "" : ", ") + NameOf(s);
        aError = "the world has no weather state \"" + state->text + "\"; it has " + names;
        return {};
    }

    const CName was = CurrentState(sys, states);
    const CName from = CNamePool::Add(sourceText.c_str());
    const CName name = CNamePool::Add(state->text.c_str());
    const bool changed = g_found.setter(sys, name.hash, from.hash, seconds, static_cast<uint32_t>(level));
    // As the node: held once the setter took it. A repeat of the state from the same source
    // changes nothing and is still held.
    const bool same = !changed && CurrentState(sys, states) == name && *reinterpret_cast<CName*>(sys + Source) == from;
    if (changed || same)
        sys[g_found.held] = 0;
    Log("Weather: %s to %s from %s (%.1f s, priority %d): %s", NameOf(was).c_str(), state->text.c_str(),
        sourceText.c_str(), seconds, static_cast<int>(level), changed ? "changed" : same ? "already" : "refused");
    return std::string("{\"applied\":") + (changed || same ? "true" : "false") + ",\"changed\":" +
           (changed ? "true" : "false") + ",\"state\":" + JsonString(state->text) + ",\"was\":" + NameJson(was) +
           ",\"held\":" + (sys[g_found.held] ? "false" : "true") + "}";
}

std::string ResetJson(const Value&, std::string& aError)
{
    if (!FindSetter(aError))
        return {};
    Handle<IScriptable> keep;
    uint8_t* sys = System(keep, aError);
    if (!sys)
        return {};
    const bool wasHeld = sys[g_found.held] == 0;
    sys[g_found.held] = 1;
    if (wasHeld)
        Log("Weather: back to the game's own cycle (held by %s)", NameOf(*reinterpret_cast<CName*>(sys + Source)).c_str());
    return std::string("{\"held\":false,\"was\":") + (wasHeld ? "\"held\"" : "\"cycle\"") + "}";
}
} // namespace

bool IsWeatherMethod(const std::string& aMethod)
{
    return aMethod == "weather.state" || aMethod == "weather.set" || aMethod == "weather.reset";
}

std::string Weather(const std::string& aMethod, const json::Value& aParams, std::string& aError)
{
    if (aMethod == "weather.set")
        return SetJson(aParams, aError);
    if (aMethod == "weather.reset")
        return ResetJson(aParams, aError);
    return StateJson(aParams, aError);
}
} // namespace rednode::overlay::detail
