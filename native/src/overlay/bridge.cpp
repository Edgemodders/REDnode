// Bridge requests from overlay apps, run on the game thread between frames.
//
// Request:  {"id": 7, "method": "player.position"}
// Response: {"id": 7, "result": {...}}  or  {"id": 7, "error": "..."}
//
// Methods:
//   game.info        the REDnode frame counter
//   player.position  V's world position, through GetPlayer and Entity.GetWorldPosition
//   audio.play       {"params":{"name":"ui_menu_onpress","on":"player"?}}: plays a game sound
//                    event through AudioSystem.Play, with no entity (as UI sounds are played)
//                    or on V with "on":"player" (positional sounds need an emitter to be heard)
//   audio.stopEvent  {"params":{"name":"...","on":"player"?}}: AudioSystem.Stop, the same way
//   rtti.call, rtti.get, rtti.set, rtti.new, rtti.release   the generic game API, in reflect.cpp
//   tweakdb.get, tweakdb.record, tweakdb.records           TweakDB, read, in reflect.cpp
//   sound.play, sound.stop, sound.set, sound.list, sound.mix, audio.tone
//                                                          REDnode's own audio output, in audio.cpp
//   faults.watch     {"seconds":15,"label":"..."}: logs the first faults for a while, in faults.cpp
//   opus.state       {"sounds":[id]}: the game's sound pak index and open paks, read only, in opus.cpp
//   opus.reload      {}: ask the audio thread to load the sound index again (H1c-2 spike), in opus.cpp
//   opus.reloadStatus {"cancel"?}: waiting, running or done, with the reload's result
//   trace.start, trace.stop, trace.state   the Sound Tracer's hooks (SP1), in soundtrace.cpp

#include "json.hpp"
#include "jvalue.hpp"
#include "overlay.hpp"

#include <RED4ext/Scripting/Natives/ScriptGameInstance.hpp>
#include <RED4ext/Scripting/Natives/Vector4.hpp>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <iterator>
#include <mutex>

namespace rednode::overlay::detail
{
namespace
{
std::mutex g_requestMutex;
std::deque<std::string> g_requests;

// Calls waiting for the game thread. A frame runs at most PerFrame of them, so a burst (a
// mod sending hundreds at once) spreads over a few frames; past MaxWaiting a call is
// refused at once. Until 0.27.2 calls past 256 were dropped, and each timed out after
// 5 s (I1's Speed test).
constexpr size_t PerFrame = 256;
constexpr size_t MaxWaiting = 4096;

// Minimal field readers. Requests come from our own host, one flat object each.
bool ReadInt(const std::string& aJson, const char* aKey, long long& aOut)
{
    const auto at = aJson.find(std::string("\"") + aKey + "\":");
    if (at == std::string::npos)
        return false;
    const char* start = aJson.c_str() + at + std::strlen(aKey) + 3;
    char* end = nullptr;
    aOut = std::strtoll(start, &end, 10);
    return end != start;
}

bool ReadString(const std::string& aJson, const char* aKey, std::string& aOut)
{
    const auto key = std::string("\"") + aKey + "\":\"";
    const auto at = aJson.find(key);
    if (at == std::string::npos)
        return false;
    const auto start = at + key.size();
    const auto end = aJson.find('"', start);
    if (end == std::string::npos)
        return false;
    aOut = aJson.substr(start, end - start);
    return true;
}

std::string Reply(long long aId, const std::string& aBody)
{
    return "{\"id\":" + std::to_string(aId) + "," + aBody + "}";
}

std::string Error(long long aId, const char* aMessage)
{
    return Reply(aId, "\"error\":" + JsonString(aMessage));
}

RED4ext::CBaseFunction* FindMethod(RED4ext::CClass* aClass, const char* aName)
{
    for (auto* c = aClass; c; c = c->parent)
    {
        if (auto* f = c->GetFunction(aName))
            return f;
    }
    return nullptr;
}

std::string PlayerPosition(long long aId)
{
    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* getPlayer = rtti->GetFunction("GetPlayer;GameInstance");
    if (!getPlayer)
        return Error(aId, "GetPlayer not found");

    RED4ext::ScriptGameInstance game;
    RED4ext::Handle<RED4ext::IScriptable> player;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, &game);
    if (!RED4ext::ExecuteFunction(static_cast<void*>(nullptr), getPlayer, &player, args) || !player)
        return Error(aId, "No player. Load a save first.");

    auto* getPosition = FindMethod(player->GetType(), "GetWorldPosition");
    if (!getPosition)
        return Error(aId, "GetWorldPosition not found");
    RED4ext::Vector4 pos;
    if (!RED4ext::ExecuteFunction(player.GetPtr(), getPosition, &pos))
        return Error(aId, "GetWorldPosition failed");

    char body[160];
    std::snprintf(body, sizeof(body), "\"result\":{\"x\":%.3f,\"y\":%.3f,\"z\":%.3f}", pos.X, pos.Y, pos.Z);
    return Reply(aId, body);
}

RED4ext::CBaseFunction* FindStatic(RED4ext::CClass* aClass, const char* aName)
{
    for (auto* f : aClass->staticFuncs)
    {
        if (f->shortName == RED4ext::CName(aName))
            return f;
    }
    return nullptr;
}

// V's entity id (entEntityID, one 64-bit hash), or 0 when there is no player yet.
uint64_t PlayerEntityId()
{
    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* getPlayer = rtti->GetFunction("GetPlayer;GameInstance");
    if (!getPlayer)
        return 0;
    RED4ext::ScriptGameInstance game;
    RED4ext::Handle<RED4ext::IScriptable> player;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, &game);
    if (!RED4ext::ExecuteFunction(static_cast<void*>(nullptr), getPlayer, &player, args) || !player)
        return 0;
    auto* getId = FindMethod(player->GetType(), "GetEntityID");
    uint64_t id = 0;
    if (!getId || !RED4ext::ExecuteFunction(player.GetPtr(), getId, &id))
        return 0;
    return id;
}

// AudioSystem.Play or Stop for a game sound event. "on":"player" posts it on V, so a
// positional sound (footsteps, a weapon) plays where the player can hear it; without it
// there is no entity, which suits UI sounds. With no player yet, it falls back to none.
std::string AudioEvent(long long aId, const std::string& aJson, bool aStop)
{
    std::string name;
    if (!json::String(aJson, "name", name) || name.empty())
        return Error(aId, aStop ? "audio.stopEvent needs params.name, a sound event name"
                                : "audio.play needs params.name, a sound event name");
    std::string on;
    json::String(aJson, "on", on);

    auto* rtti = RED4ext::CRTTISystem::Get();
    auto* gameClass = rtti->GetClass("ScriptGameInstance");
    auto* getAudio = gameClass ? FindStatic(gameClass, "GetAudioSystem") : nullptr;
    if (!getAudio)
        return Error(aId, "GameInstance.GetAudioSystem not found");

    RED4ext::ScriptGameInstance game;
    RED4ext::Handle<RED4ext::IScriptable> audio;
    RED4ext::StackArgs_t args;
    args.emplace_back(nullptr, &game);
    if (!RED4ext::ExecuteFunction(static_cast<void*>(nullptr), getAudio, &audio, args) || !audio)
        return Error(aId, "No audio system");

    auto* fn = FindMethod(audio->GetType(), aStop ? "Stop" : "Play");
    if (!fn)
        return Error(aId, aStop ? "AudioSystem.Stop not found" : "AudioSystem.Play not found");

    RED4ext::CName eventName(name.c_str());
    uint64_t entity = on == "player" ? PlayerEntityId() : 0; // entEntityID: 0 for none
    RED4ext::CName noEmitter;                                  // None
    RED4ext::StackArgs_t callArgs;
    callArgs.emplace_back(nullptr, &eventName);
    callArgs.emplace_back(nullptr, &entity);
    callArgs.emplace_back(nullptr, &noEmitter);
    if (!RED4ext::ExecuteFunction(audio.GetPtr(), fn, nullptr, callArgs))
        return Error(aId, aStop ? "AudioSystem.Stop failed" : "AudioSystem.Play failed");

    return Reply(aId, std::string("\"result\":{\"") + (aStop ? "stopped" : "played") + "\":" + JsonString(name) +
                          ",\"on\":\"" + (entity ? "player" : "none") + "\"}");
}

std::string Handle(const std::string& aJson, uint64_t aFrame)
{
    long long id = 0;
    std::string method;
    if (!ReadInt(aJson, "id", id) || !ReadString(aJson, "method", method))
        return {};

    if (method == "game.info")
        return Reply(id, "\"result\":{\"frame\":" + std::to_string(aFrame) + "}");
    if (method == "player.position")
        return PlayerPosition(id);
    if (method == "audio.play")
        return AudioEvent(id, aJson, false);
    if (method == "audio.stopEvent")
        return AudioEvent(id, aJson, true);
    if (IsReflectMethod(method) || IsAudioMethod(method) || IsFaultsMethod(method) || IsOpusMethod(method) ||
        IsTraceMethod(method) || IsInkMethod(method))
    {
        json::Value request;
        std::string error;
        if (!json::Parse(aJson, request, error))
            return Error(id, ("Bad request: " + error).c_str());
        static const json::Value none;
        const json::Value* params = request.Get("params");
        const json::Value& given = params ? *params : none;
        std::string result = IsAudioMethod(method)    ? Audio(method, given, error)
                             : IsFaultsMethod(method) ? Faults(method, given, error)
                             : IsOpusMethod(method)   ? Opus(method, given, error)
                             : IsTraceMethod(method)  ? Trace(method, given, error)
                             : IsInkMethod(method)    ? Ink(method, given, error)
                                                      : Reflect(method, given, error);
        if (!error.empty())
            return Error(id, error.c_str());
        return Reply(id, "\"result\":" + result);
    }
    return Error(id, ("Unknown method: " + method).c_str());
}
} // namespace

void QueueRequest(std::string aJson)
{
    {
        std::scoped_lock lock(g_requestMutex);
        if (g_requests.size() < MaxWaiting)
        {
            g_requests.push_back(std::move(aJson));
            return;
        }
    }
    long long id = 0;
    if (ReadInt(aJson, "id", id))
        SendJson(Error(id, "the game has 4096 calls waiting: send fewer at once"));
}

void RunRequests(uint64_t aFrame)
{
    std::vector<std::string> requests;
    {
        std::scoped_lock lock(g_requestMutex);
        const auto last = g_requests.begin() + std::ptrdiff_t(std::min(PerFrame, g_requests.size()));
        requests.assign(std::make_move_iterator(g_requests.begin()), std::make_move_iterator(last));
        g_requests.erase(g_requests.begin(), last);
    }
    if (requests.empty())
        return;
    // How long game calls take on the game thread, for the perf line (W1: does moving
    // an entity every frame cost frames?).
    LARGE_INTEGER start, end, frequency;
    QueryPerformanceCounter(&start);
    for (const auto& r : requests)
    {
        auto reply = Handle(r, aFrame);
        if (!reply.empty())
            SendJson(std::move(reply));
    }
    QueryPerformanceCounter(&end);
    QueryPerformanceFrequency(&frequency);
    RecordCalls(uint32_t(requests.size()), double(end.QuadPart - start.QuadPart) * 1000.0 / double(frequency.QuadPart));
}
} // namespace rednode::overlay::detail
