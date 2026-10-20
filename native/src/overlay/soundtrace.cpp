// The Sound Tracer's hooks (SP1, docs/sound.md "Sound Tools: SP1 to SP4"): which game sounds
// play, and which the game loads.
//
//   Played  Wwise's PostEvent by id: every event the game posts, with the game object it is
//           posted on and the playing id Wwise gave it (0: it failed, such as an event that
//           is not in a loaded bank). Called on the game's threads
//   Loaded  the sound lookup in the opus index: every sound the game loads, from memory
//           (the pak tick's acquire) or streamed (the IO hook's open), with whether the index
//           had it. Called on the audio and streaming threads
//
// Both are found by byte patterns in opus.cpp (LocateSoundTrace) and hooked through RED4ext
// at the first trace.start; the hooks stay until the plugin stops and record only while
// tracing, so a second trace patches nothing. A detour calls the game's function first and
// only then copies four numbers into a ring under a slim lock: no allocation, no game
// memory read. Each frame the game thread sends what was recorded, about ten times a second:
//   {"event":"sound-trace","posts":[[ms,event,"object",playing],...],
//    "loads":[[ms,sound,found],...],"dropped":n}
// ms counts from trace.start; the game object id is a string (64 bits). dropped counts
// records lost because the ring was full between two sends.
//
// Bridge methods (game thread):
//   trace.start {}  attaches the hooks if needed and starts recording
//                   -> {"tracing":true,"postEvent":"+0x..","lookup":"+0x..","attached":[..]}
//   trace.stop  {}  stops recording -> {"tracing":false}
//   trace.state {}  -> {"tracing":bool,"attached":[..],"posts":n,"loads":n,"dropped":n}

#include "jvalue.hpp"
#include "overlay.hpp"

#include <atomic>
#include <cstdio>
#include <vector>

namespace rednode::overlay::detail
{
namespace
{
using PostEventFn = uint32_t (*)(uint32_t, uint64_t, uint32_t, void*, void*, void*, uint64_t);
using LookupFn = bool (*)(uint32_t, void*);

enum class Kind : uint8_t
{
    Post,
    Load
};

struct Record
{
    uint64_t ms;
    uint64_t object; // posts: the game object id
    uint32_t id;     // the event or sound id
    uint32_t extra;  // posts: the playing id; loads: 1 if the index had it
    Kind kind;
};

constexpr size_t RingSize = 16384;
constexpr uint64_t SendEveryMs = 100;

SRWLOCK g_lock = SRWLOCK_INIT;
Record g_ring[RingSize];
size_t g_used = 0;
uint64_t g_droppedNow = 0;

std::atomic<bool> g_tracing{false};
std::atomic<uint64_t> g_startMs{0};
PostEventFn g_postOriginal = nullptr;
LookupFn g_lookupOriginal = nullptr;
SoundTracePlaces g_places;
bool g_postAttached = false;
bool g_lookupAttached = false;
uint64_t g_lastSend = 0;
uint64_t g_posts = 0, g_loads = 0, g_dropped = 0;

void Add(Kind aKind, uint32_t aId, uint64_t aObject, uint32_t aExtra)
{
    const uint64_t ms = GetTickCount64() - g_startMs.load(std::memory_order_relaxed);
    AcquireSRWLockExclusive(&g_lock);
    if (g_used < RingSize)
        g_ring[g_used++] = {ms, aObject, aId, aExtra, aKind};
    else
        g_droppedNow++;
    ReleaseSRWLockExclusive(&g_lock);
}

uint32_t PostEventDetour(uint32_t aEvent, uint64_t aObject, uint32_t aFlags, void* aCallback, void* aCookie,
                         void* aExternals, uint64_t aPlayingId)
{
    const uint32_t playing = g_postOriginal(aEvent, aObject, aFlags, aCallback, aCookie, aExternals, aPlayingId);
    if (g_tracing.load(std::memory_order_relaxed))
        Add(Kind::Post, aEvent, aObject, playing);
    return playing;
}

bool LookupDetour(uint32_t aSound, void* aOut)
{
    const bool found = g_lookupOriginal(aSound, aOut);
    if (g_tracing.load(std::memory_order_relaxed))
        Add(Kind::Load, aSound, 0, found ? 1 : 0);
    return found;
}

std::string Rel(const void* aAt)
{
    const auto* image = reinterpret_cast<const uint8_t*>(GetModuleHandleW(nullptr));
    char buf[32];
    std::snprintf(buf, sizeof(buf), "+0x%llx",
                  static_cast<unsigned long long>(static_cast<const uint8_t*>(aAt) - image));
    return buf;
}

std::string Attached()
{
    std::string out = "[";
    if (g_postAttached)
        out += "\"postEvent\"";
    if (g_lookupAttached)
        out += std::string(g_postAttached ? "," : "") + "\"lookup\"";
    return out + "]";
}

bool Attach(std::string& aError)
{
    if (g_postAttached && g_lookupAttached)
        return true;
    const auto* sdk = GetSdk();
    if (!sdk || !sdk->hooking)
    {
        aError = "RED4ext's hooking is not available";
        return false;
    }
    if (!g_places.postEvent)
    {
        std::string why;
        if (!FindSoundTrace(g_places, why))
        {
            aError = "REDnode does not know where this game version posts sounds (" + why + ")";
            Log("Sound trace: %s", aError.c_str());
            return false;
        }
    }
    const uint64_t started = GetTickCount64();
    if (!g_postAttached)
        g_postAttached = sdk->hooking->Attach(GetHandle(), g_places.postEvent, reinterpret_cast<void*>(&PostEventDetour),
                                              reinterpret_cast<void**>(&g_postOriginal));
    if (!g_lookupAttached)
        g_lookupAttached = sdk->hooking->Attach(GetHandle(), g_places.lookup, reinterpret_cast<void*>(&LookupDetour),
                                                reinterpret_cast<void**>(&g_lookupOriginal));
    Log("Sound trace: hooks attached in %llu ms: PostEvent at %s %s, the sound lookup at %s %s",
        static_cast<unsigned long long>(GetTickCount64() - started), Rel(g_places.postEvent).c_str(),
        g_postAttached ? "attached" : "NOT attached", Rel(g_places.lookup).c_str(),
        g_lookupAttached ? "attached" : "NOT attached");
    if (!g_postAttached && !g_lookupAttached)
    {
        aError = "RED4ext could not attach the Sound Tracer's hooks (see the plugin log)";
        return false;
    }
    return true;
}
} // namespace

bool IsTraceMethod(const std::string& aMethod)
{
    return aMethod == "trace.start" || aMethod == "trace.stop" || aMethod == "trace.state";
}

std::string Trace(const std::string& aMethod, const json::Value&, std::string& aError)
{
    if (aMethod == "trace.start")
    {
        if (!Attach(aError))
            return {};
        if (!g_tracing.load())
        {
            AcquireSRWLockExclusive(&g_lock);
            g_used = 0;
            g_droppedNow = 0;
            ReleaseSRWLockExclusive(&g_lock);
            g_startMs = GetTickCount64();
            g_lastSend = GetTickCount64();
            g_tracing = true;
            Log("Sound trace: started");
        }
        return "{\"tracing\":true,\"postEvent\":\"" + Rel(g_places.postEvent) + "\",\"lookup\":\"" +
               Rel(g_places.lookup) + "\",\"attached\":" + Attached() + "}";
    }
    if (aMethod == "trace.stop")
    {
        if (g_tracing.exchange(false))
            Log("Sound trace: stopped (%llu posts, %llu loads, %llu dropped so far)",
                static_cast<unsigned long long>(g_posts), static_cast<unsigned long long>(g_loads),
                static_cast<unsigned long long>(g_dropped));
        return "{\"tracing\":false}";
    }
    return "{\"tracing\":" + std::string(g_tracing.load() ? "true" : "false") + ",\"attached\":" + Attached() +
           ",\"posts\":" + std::to_string(g_posts) + ",\"loads\":" + std::to_string(g_loads) +
           ",\"dropped\":" + std::to_string(g_dropped) + "}";
}

void UpdateTrace()
{
    if (!g_postAttached && !g_lookupAttached)
        return;
    const uint64_t now = GetTickCount64();
    if (now - g_lastSend < SendEveryMs)
        return;
    g_lastSend = now;
    static std::vector<Record> batch;
    uint64_t dropped = 0;
    AcquireSRWLockExclusive(&g_lock);
    batch.assign(g_ring, g_ring + g_used);
    g_used = 0;
    dropped = g_droppedNow;
    g_droppedNow = 0;
    ReleaseSRWLockExclusive(&g_lock);
    if (batch.empty() && !dropped)
        return;
    std::string posts, loads;
    char buf[96];
    for (const auto& r : batch)
    {
        if (r.kind == Kind::Post)
        {
            std::snprintf(buf, sizeof(buf), "%s[%llu,%u,\"%llu\",%u]", posts.empty() ? "" : ",",
                          static_cast<unsigned long long>(r.ms), r.id, static_cast<unsigned long long>(r.object),
                          r.extra);
            posts += buf;
            g_posts++;
        }
        else
        {
            std::snprintf(buf, sizeof(buf), "%s[%llu,%u,%s]", loads.empty() ? "" : ",",
                          static_cast<unsigned long long>(r.ms), r.id, r.extra ? "true" : "false");
            loads += buf;
            g_loads++;
        }
    }
    g_dropped += dropped;
    SendJson("{\"event\":\"sound-trace\",\"posts\":[" + posts + "],\"loads\":[" + loads +
             "],\"dropped\":" + std::to_string(dropped) + "}");
}

void StopTrace()
{
    g_tracing = false;
    const auto* sdk = GetSdk();
    if (!sdk || !sdk->hooking)
        return;
    if (g_postAttached)
        sdk->hooking->Detach(GetHandle(), g_places.postEvent);
    if (g_lookupAttached)
        sdk->hooking->Detach(GetHandle(), g_places.lookup);
    g_postAttached = g_lookupAttached = false;
}
} // namespace rednode::overlay::detail
