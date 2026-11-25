// The collision groups a ray cast may name (#59, #60): world.ray and world.pick's "groups". Only
// the game's own names reach SyncRaycastByCollisionGroup, since how it takes a name it does not
// know is unverified. No game types here, so tests/raygroups_test.cpp builds it alone.

#pragma once

#include <algorithm>
#include <iterator>
#include <string>
#include <vector>

namespace rednode::overlay::raygroups
{
// The game's collision and query groups, from engine\physics\collision_groups.json (game 2.5).
inline const char* const Names[] = {
    "Player", "AI", "Static", "Dynamic", "Vehicle", "Tank", "Destructible", "Terrain", "Collider", "Particle",
    "Ragdoll", "Ragdoll Inner", "Debris", "Cloth", "PlayerBlocker", "VehicleBlocker", "TankBlocker",
    "DestructibleCluster", "NPCBlocker", "PhotomodeCensorship", "Visibility", "Audible", "Interaction", "Shooting",
    "Water", "NetworkDevice", "NPCTraceObstacle", "PhotoModeCamera", "FoliageDestructible", "NPCNameplate",
    "NPCCollision"};

inline constexpr size_t MaxGroups = 8;

inline bool Known(const std::string& aName)
{
    return std::any_of(std::begin(Names), std::end(Names), [&](const char* n) { return aName == n; });
}

// The names asked for, each once in the order given; false with the reason for one the game does
// not have, an empty one or more than MaxGroups.
inline bool Check(const std::vector<std::string>& aAsked, std::vector<std::string>& aOut, std::string& aError)
{
    aOut.clear();
    for (const auto& name : aAsked)
    {
        if (!Known(name))
        {
            aError = "\"" + name + "\" is not one of the game's collision groups:";
            for (size_t i = 0; i < std::size(Names); ++i)
                aError += std::string(i ? ", " : " ") + Names[i];
            return false;
        }
        if (std::find(aOut.begin(), aOut.end(), name) == aOut.end())
            aOut.push_back(name);
    }
    if (aOut.size() > MaxGroups)
    {
        aError = "at most 8 groups";
        return false;
    }
    return true;
}
} // namespace rednode::overlay::raygroups
