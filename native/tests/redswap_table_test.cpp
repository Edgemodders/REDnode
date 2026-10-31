// Tests for REDswap's archive file table reader (redswap/archive_table.hpp). Runs without the
// game: it writes small archives of its own into the temp folder. With REDSWAP_TEST_ARCHIVE
// set to a real .archive it also prints how many resources that one holds.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../redswap/archive_table.hpp"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>

namespace
{
int g_failures = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s  %s\n", aOk ? "ok  " : "FAIL", aWhat);
    if (!aOk)
        ++g_failures;
}

template<typename T>
void Put(std::string& aOut, T aValue)
{
    aOut.append(reinterpret_cast<const char*>(&aValue), sizeof(T));
}

// An archive with the given path hashes: header, some data, then the index at the end.
std::string MakeArchive(const std::vector<uint64_t>& aHashes, uint32_t aCountOverride = 0)
{
    const std::string data(100, 'x');
    std::string index;
    Put<uint32_t>(index, 8);    // file table offset
    Put<uint32_t>(index, 0);    // file table size
    Put<uint64_t>(index, 0);    // crc
    Put<uint32_t>(index, aCountOverride ? aCountOverride : static_cast<uint32_t>(aHashes.size()));
    Put<uint32_t>(index, 0);    // segments
    Put<uint32_t>(index, 0);    // dependencies
    for (const auto hash : aHashes)
    {
        Put<uint64_t>(index, hash);
        index.append(redswap::ArchiveEntrySize - sizeof(uint64_t), '\0');
    }
    std::string out = "RDAR";
    Put<uint32_t>(out, 12);
    Put<uint64_t>(out, 40 + data.size()); // index offset
    Put<uint32_t>(out, static_cast<uint32_t>(index.size()));
    Put<uint64_t>(out, 0);
    Put<uint32_t>(out, 0);
    Put<uint64_t>(out, 40 + data.size() + index.size());
    return out + data + index;
}

std::filesystem::path Write(const char* aName, const std::string& aBytes)
{
    const auto path = std::filesystem::temp_directory_path() / aName;
    std::ofstream(path, std::ios::binary).write(aBytes.data(), static_cast<std::streamsize>(aBytes.size()));
    return path;
}
} // namespace

int main()
{
    const std::vector<uint64_t> hashes = {0x1111222233334444ull, 0xFEDCBA9876543210ull, 42};
    const auto good = Write("redswap_table_good.archive", MakeArchive(hashes));
    const auto read = redswap::ArchiveHashes(good);
    Check(read.has_value(), "a well-formed archive is read");
    Check(read && *read == hashes, "its path hashes come back in order");

    const auto empty = Write("redswap_table_empty.archive", MakeArchive({}));
    const auto none = redswap::ArchiveHashes(empty);
    Check(none && none->empty(), "an archive with no files reads as empty");

    Check(!redswap::ArchiveHashes(Write("redswap_table_text.archive", std::string(200, 'a'))),
          "a file that does not start with RDAR is refused");
    Check(!redswap::ArchiveHashes(Write("redswap_table_short.archive", "RDAR")), "a cut-short header is refused");
    Check(!redswap::ArchiveHashes(Write("redswap_table_count.archive", MakeArchive(hashes, 1000))),
          "a file count past the index's end is refused");
    const auto cut = MakeArchive(hashes);
    Check(!redswap::ArchiveHashes(Write("redswap_table_cut.archive", cut.substr(0, cut.size() - 10))),
          "an index cut short is refused");
    Check(!redswap::ArchiveHashes(std::filesystem::temp_directory_path() / "redswap_table_missing.archive"),
          "a missing file is refused");

    if (const char* real = std::getenv("REDSWAP_TEST_ARCHIVE"))
    {
        const auto got = redswap::ArchiveHashes(real);
        Check(got.has_value(), "the archive in REDSWAP_TEST_ARCHIVE is read");
        if (got)
        {
            std::printf("      %zu resources:", got->size());
            for (const auto h : *got)
                std::printf(" %llu", static_cast<unsigned long long>(h));
            std::printf("\n");
        }
    }

    std::printf(g_failures ? "%d FAILED\n" : "All passed\n", g_failures);
    return g_failures ? 1 : 0;
}
