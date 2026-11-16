#pragma once

// Reading the game's own quest weather node, for weather.cpp (#46, docs/world.md "Weather (#46)").
// No game needed: tests/weather_test.cpp checks it on made-up code.
//
// Game 2.5 has no script call that sets the weather. Its quest node questPlayEnv_SetWeather does:
// the node's run function (slot 0x108 of its vtable on 2.5) reads the weather system from the
// quest context, looks up the WeatherPresets record's state name and calls the weather system's
// setter with (system, state name, source name, blend seconds, priority) in rcx, rdx, r8, xmm3 and
// the stack. On success it clears a flag in the system (the game's own weather cycle off: the
// weather is held), and a reset node sets it again (the cycle back on).
//
// The plugin takes the setter's address and the flag's place from that function's own code,
// rather than from a byte pattern over the whole exe: these instruction forms are what it looks for.
//
//   mov rbx, [rdx + context]            48 8B 9A <disp32>               the weather system
//   mov [rsp+28h], ecx ; mov rcx, rbx   89 4C 24 28 48 8B CB
//   call setter                         E8 <rel32>
//   test al, al ; je +n                 84 C0 74 <n>
//   mov byte [rbx + held], 0            C6 83 <disp32> 00               set: the cycle off
//   ...
//   mov byte [rbx + held], 1            C6 83 <disp32> 01               reset: the cycle on

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace rednode::overlay::weather
{
struct NodeCode
{
    bool ok = false;
    const char* why = nullptr;   // what was not found, when not ok
    uint32_t contextOffset = 0;  // where the quest context keeps the weather system
    size_t setterCall = 0;       // the call instruction's place in the code
    int32_t setterRel = 0;       // its displacement: the setter is at code + setterCall + 5 + setterRel
    uint32_t heldOffset = 0;     // the flag's place in the weather system: 1 the game's cycle, 0 held
};

inline uint32_t Read32(const uint8_t* aAt)
{
    uint32_t v;
    std::memcpy(&v, aAt, 4);
    return v;
}

// aCode: the start of the node's run function, aSize bytes of it (0xA0 is enough on 2.5).
inline NodeCode ReadNodeCode(const uint8_t* aCode, size_t aSize)
{
    NodeCode r;
    for (size_t i = 0; i + 7 <= aSize && i < 0x30; ++i)
    {
        if (aCode[i] == 0x48 && aCode[i + 1] == 0x8B && aCode[i + 2] == 0x9A)
        {
            r.contextOffset = Read32(aCode + i + 3);
            break;
        }
    }
    if (!r.contextOffset)
    {
        r.why = "the node does not read a weather system from its context";
        return r;
    }

    static const uint8_t call[] = {0x89, 0x4C, 0x24, 0x28, 0x48, 0x8B, 0xCB, 0xE8};
    for (size_t i = 0; i + sizeof(call) + 4 + 11 <= aSize; ++i)
    {
        if (std::memcmp(aCode + i, call, sizeof(call)) != 0)
            continue;
        const uint8_t* after = aCode + i + sizeof(call) + 4;
        if (after[0] != 0x84 || after[1] != 0xC0 || after[2] != 0x74 || after[4] != 0xC6 || after[5] != 0x83 ||
            after[10] != 0x00)
            continue;
        r.setterCall = i + sizeof(call) - 1;
        r.setterRel = static_cast<int32_t>(Read32(aCode + i + sizeof(call)));
        r.heldOffset = Read32(after + 6);
        break;
    }
    if (!r.setterCall)
    {
        r.why = "the node's call to the weather setter was not found";
        return r;
    }

    for (size_t i = 0; i + 7 <= aSize; ++i)
    {
        if (aCode[i] == 0xC6 && aCode[i + 1] == 0x83 && Read32(aCode + i + 2) == r.heldOffset && aCode[i + 6] == 0x01)
        {
            r.ok = true;
            return r;
        }
    }
    r.why = "the node's reset does not set the same flag";
    return r;
}
} // namespace rednode::overlay::weather
