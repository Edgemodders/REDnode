// Tests for reading the quest weather node's code (src/overlay/weather.hpp, #46). The code here
// is made up from the instruction forms the reader looks for, with other bytes between them; it
// is not copied from the game. No game needed.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../src/overlay/weather.hpp"

#include <cstdio>
#include <vector>

using namespace rednode::overlay::weather;

namespace
{
int g_failed = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s %s\n", aOk ? "ok  " : "FAIL", aWhat);
    if (!aOk)
        ++g_failed;
}

void Put32(std::vector<uint8_t>& aOut, uint32_t aValue)
{
    for (int k = 0; k < 4; ++k)
        aOut.push_back(static_cast<uint8_t>(aValue >> (8 * k)));
}

void Put(std::vector<uint8_t>& aOut, std::initializer_list<int> aBytes)
{
    for (int b : aBytes)
        aOut.push_back(static_cast<uint8_t>(b));
}

// A run function: aContext and aHeld are the offsets, aRel the call's displacement.
std::vector<uint8_t> Node(uint32_t aContext, uint32_t aHeld, int32_t aRel, bool aReset = true, bool aTest = true)
{
    std::vector<uint8_t> c;
    Put(c, {0x40, 0x53, 0x48, 0x83, 0xEC, 0x30, 0x80, 0x79, 0x51, 0x00, 0x48, 0x8B, 0xF9}); // prologue, a check
    Put(c, {0x48, 0x8B, 0x9A});
    Put32(c, aContext);
    Put(c, {0x75, 0x40, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90, 0x90});
    Put(c, {0x89, 0x4C, 0x24, 0x28, 0x48, 0x8B, 0xCB, 0xE8});
    Put32(c, static_cast<uint32_t>(aRel));
    Put(c, {0x84, 0xC0, aTest ? 0x74 : 0x75, 0x07, 0xC6, 0x83});
    Put32(c, aHeld);
    Put(c, {0x00, 0x90, 0x90, 0x90, 0x90, 0xC3});
    if (aReset)
    {
        Put(c, {0xC6, 0x83});
        Put32(c, aHeld);
        Put(c, {0x01, 0xEB, 0xF0});
    }
    else
    {
        Put(c, {0xC6, 0x83});
        Put32(c, aHeld + 4);
        Put(c, {0x01});
    }
    while (c.size() < 0xA0)
        c.push_back(0xCC);
    return c;
}
} // namespace

int main()
{
    {
        auto c = Node(0x1D0, 0x94, 0x1234);
        auto r = ReadNodeCode(c.data(), c.size());
        Check(r.ok, "a node's code reads");
        Check(r.contextOffset == 0x1D0, "the context offset");
        Check(r.heldOffset == 0x94, "the flag's offset");
        Check(r.setterRel == 0x1234, "the call's displacement");
        Check(c[r.setterCall] == 0xE8, "the call's place is the call");
    }
    {
        auto c = Node(0x1C8, 0x8C, -0x5000);
        auto r = ReadNodeCode(c.data(), c.size());
        Check(r.ok && r.setterRel == -0x5000, "a call backwards");
    }
    {
        auto c = Node(0x1C8, 0x8C, 0x10, false);
        auto r = ReadNodeCode(c.data(), c.size());
        Check(!r.ok && r.why, "a reset of another flag is refused");
    }
    {
        auto c = Node(0x1C8, 0x8C, 0x10, true, false);
        auto r = ReadNodeCode(c.data(), c.size());
        Check(!r.ok && r.setterCall == 0, "a call not followed by the success test is not the setter");
    }
    {
        std::vector<uint8_t> c(0xA0, 0x90);
        auto r = ReadNodeCode(c.data(), c.size());
        Check(!r.ok && r.contextOffset == 0, "other code is refused");
    }
    {
        auto c = Node(0x1C8, 0x8C, 0x10);
        auto r = ReadNodeCode(c.data(), 0x30);
        Check(!r.ok, "too few bytes is refused");
    }

    std::printf("%s\n", g_failed ? "Weather node tests failed" : "Weather node tests passed");
    return g_failed ? 1 : 0;
}
