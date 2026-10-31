#pragma once

// Reads which resources an .archive holds, from its file table on disk (the same reading as
// packages/overlay/archive-index.js). REDswap reads a replaced archive's table before the new
// file takes its place, so the paths the new archive no longer holds are dropped from the
// resource loader too (REDnode #29). No game code; tested by native/tests/redswap_table_test.cpp.
//
// Header (40 bytes): magic "RDAR", version u32, index offset u64, index size u32,
// debug offset u64, debug size u32, file size u64.
// Index: file table offset u32, file table size u32, crc u64, file count u32,
// segment count u32, dependency count u32, then one 56-byte entry per file, starting with
// the path's hash (FNV-1a 64 of the lowercase path with backslashes, a ResourcePath).

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <optional>
#include <vector>

namespace redswap
{
namespace detail
{
template<typename T>
T ReadLE(const uint8_t* aAt)
{
    T value{};
    std::memcpy(&value, aAt, sizeof(T)); // the game and REDswap run on little-endian x64
    return value;
}
} // namespace detail

constexpr size_t ArchiveHeaderSize = 40;
constexpr size_t ArchiveIndexFields = 28;
constexpr size_t ArchiveEntrySize = 56;
constexpr uint32_t ArchiveIndexLimit = 256u * 1024 * 1024; // larger than any game archive's index

// The path hashes of every resource in the archive, or nothing when the file cannot be read
// or is not a game archive.
inline std::optional<std::vector<uint64_t>> ArchiveHashes(const std::filesystem::path& aFile)
{
    FILE* file = nullptr;
    if (_wfopen_s(&file, aFile.c_str(), L"rb") != 0 || !file)
        return std::nullopt;
    struct Closer
    {
        FILE* f;
        ~Closer() { std::fclose(f); }
    } closer{file};

    uint8_t header[ArchiveHeaderSize];
    if (std::fread(header, 1, sizeof(header), file) != sizeof(header) || std::memcmp(header, "RDAR", 4) != 0)
        return std::nullopt;
    const auto indexAt = detail::ReadLE<uint64_t>(header + 8);
    const auto indexSize = detail::ReadLE<uint32_t>(header + 16);
    if (indexSize < ArchiveIndexFields || indexSize > ArchiveIndexLimit ||
        _fseeki64(file, static_cast<int64_t>(indexAt), SEEK_SET) != 0)
        return std::nullopt;

    std::vector<uint8_t> index(indexSize);
    if (std::fread(index.data(), 1, index.size(), file) != index.size())
        return std::nullopt;
    const auto count = detail::ReadLE<uint32_t>(index.data() + 16);
    if (ArchiveIndexFields + static_cast<uint64_t>(count) * ArchiveEntrySize > indexSize)
        return std::nullopt;

    std::vector<uint64_t> hashes;
    hashes.reserve(count);
    for (uint32_t i = 0; i < count; ++i)
        hashes.push_back(detail::ReadLE<uint64_t>(index.data() + ArchiveIndexFields + i * ArchiveEntrySize));
    return hashes;
}
} // namespace redswap
