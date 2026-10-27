#pragma once

// REDswap: swaps archives into the running game (docs/world.md, "H3 REDnode's own hot loader").

#include <RED4ext/RED4ext.hpp>

#include <filesystem>
#include <string>
#include <vector>

namespace redswap
{
// What one file of a swap became.
struct FileResult
{
    std::string file;   // as given
    std::string target; // where it went in the game folder
    std::string how;    // "replaced", "added", "reloaded" (already there), "config"
};

struct FileFailure
{
    std::string file;
    std::string why;
};

struct SwapResult
{
    std::vector<FileResult> done;
    std::vector<FileFailure> failed;
    uint32_t resources = 0;   // resource paths the swapped archives hold
    uint32_t invalidated = 0; // of those, loaded ones dropped from the resource loader
    bool extensions = false;  // ArchiveXL asked to reload
    std::string error;        // set when nothing could be swapped at all
};

// Logs through RED4ext's logger once the plugin has it.
void SetLogger(RED4ext::v1::PluginHandle aHandle, const RED4ext::v1::Sdk* aSdk);

// Why REDswap cannot swap in this game, or empty when it can. Looks the game functions up
// once; a missing one never closes the game.
std::string Check();

// Swaps the files (absolute paths of .archive, .xl, .yaml and .yml files) into the game.
// Runs on the game thread.
SwapResult Swap(const std::vector<std::filesystem::path>& aFiles);
} // namespace redswap
