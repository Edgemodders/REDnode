// Tests for the collision groups a ray cast may name (src/overlay/raygroups.hpp, #59 and #60).
// No game needed.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../src/overlay/raygroups.hpp"

#include <cstdio>

using namespace rednode::overlay;

namespace
{
int g_failed = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s %s\n", aOk ? "ok  " : "FAIL", aWhat);
    if (!aOk)
        ++g_failed;
}
} // namespace

int main()
{
    std::vector<std::string> out;
    std::string error;

    Check(raygroups::Check({"Static", "Terrain", "PlayerBlocker", "Dynamic"}, out, error) && out.size() == 4,
          "the ground line's four groups are taken");
    Check(out[0] == "Static" && out[3] == "Dynamic", "in the order given");

    Check(raygroups::Check({"Static", "Dynamic", "Static"}, out, error) && out.size() == 2, "a group named twice is cast once");
    Check(raygroups::Check({"Ragdoll Inner", "NPCCollision"}, out, error), "names with a space and query groups are known");
    Check(raygroups::Check({}, out, error) && out.empty(), "none asked: an empty list (the caller uses Static)");

    error.clear();
    Check(!raygroups::Check({"Static", "static"}, out, error), "names are matched exactly: \"static\" is refused");
    Check(error.find("\"static\" is not one of the game's collision groups: Player, AI, Static") == 0,
          "the refusal names the group and lists the game's");
    Check(error.find("NPCCollision") != std::string::npos, "the list runs to the last name");

    Check(!raygroups::Check({""}, out, error), "an empty name is refused");

    const std::vector<std::string> nine = {"Player", "AI", "Static", "Dynamic", "Vehicle", "Tank", "Destructible", "Terrain", "Collider"};
    error.clear();
    Check(!raygroups::Check(nine, out, error) && error == "at most 8 groups", "more than 8 groups is refused");
    Check(raygroups::Check({nine.begin(), nine.begin() + 8}, out, error), "8 groups are taken");

    std::printf(g_failed ? "\nFAILED: %d failure(s)\n" : "\nAll passed\n", g_failed);
    return g_failed ? 1 : 0;
}
