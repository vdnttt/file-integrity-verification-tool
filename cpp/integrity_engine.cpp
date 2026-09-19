#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>
#include <algorithm>

namespace fs = std::filesystem;

// ============================================================
// OOP-focused C++20 core (roughly 25% of the full application)
// ============================================================

class HashAlgorithm {
public:
    virtual ~HashAlgorithm() = default;
    virtual std::string name() const = 0;
    virtual std::string hashFile(const fs::path& path) const = 0;
};

class SHA256Hasher final : public HashAlgorithm {
private:
    static constexpr std::array<uint32_t, 64> K = {
        0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,
        0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
        0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,
        0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
        0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,
        0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
        0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,
        0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
        0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,
        0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
        0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,
        0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
        0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,
        0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
        0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,
        0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
    };

    static uint32_t rotr(uint32_t x, uint32_t n) { return (x >> n) | (x << (32u - n)); }
    static uint32_t ch(uint32_t x, uint32_t y, uint32_t z) { return (x & y) ^ (~x & z); }
    static uint32_t maj(uint32_t x, uint32_t y, uint32_t z) { return (x & y) ^ (x & z) ^ (y & z); }
    static uint32_t bigSigma0(uint32_t x) { return rotr(x,2) ^ rotr(x,13) ^ rotr(x,22); }
    static uint32_t bigSigma1(uint32_t x) { return rotr(x,6) ^ rotr(x,11) ^ rotr(x,25); }
    static uint32_t smallSigma0(uint32_t x) { return rotr(x,7) ^ rotr(x,18) ^ (x >> 3); }
    static uint32_t smallSigma1(uint32_t x) { return rotr(x,17) ^ rotr(x,19) ^ (x >> 10); }

    static void transform(std::array<uint32_t,8>& h, const uint8_t* block) {
        std::array<uint32_t, 64> w{};
        for (size_t i = 0; i < 16; ++i) {
            const size_t j = i * 4;
            w[i] = (static_cast<uint32_t>(block[j]) << 24) |
                   (static_cast<uint32_t>(block[j+1]) << 16) |
                   (static_cast<uint32_t>(block[j+2]) << 8) |
                   static_cast<uint32_t>(block[j+3]);
        }
        for (size_t i = 16; i < 64; ++i)
            w[i] = smallSigma1(w[i-2]) + w[i-7] + smallSigma0(w[i-15]) + w[i-16];

        uint32_t a=h[0], b=h[1], c=h[2], d=h[3], e=h[4], f=h[5], g=h[6], hh=h[7];
        for (size_t i = 0; i < 64; ++i) {
            const uint32_t t1 = hh + bigSigma1(e) + ch(e,f,g) + K[i] + w[i];
            const uint32_t t2 = bigSigma0(a) + maj(a,b,c);
            hh=g; g=f; f=e; e=d+t1; d=c; c=b; b=a; a=t1+t2;
        }
        h[0]+=a; h[1]+=b; h[2]+=c; h[3]+=d; h[4]+=e; h[5]+=f; h[6]+=g; h[7]+=hh;
    }

public:
    std::string name() const override { return "SHA-256"; }

    std::string hashFile(const fs::path& path) const override {
        std::ifstream in(path, std::ios::binary);
        if (!in) throw std::runtime_error("Cannot open file: " + path.string());

        std::array<uint32_t,8> h = {
            0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,
            0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u
        };
        std::array<uint8_t,64> block{};
        uint64_t totalBytes = 0;

        while (in.read(reinterpret_cast<char*>(block.data()), block.size())) {
            transform(h, block.data());
            totalBytes += 64;
        }

        const std::streamsize rem = in.gcount();
        if (rem > 0) {
            totalBytes += static_cast<uint64_t>(rem);
        }

        std::array<uint8_t, 128> tail{};
        for (std::streamsize i = 0; i < rem; ++i) tail[static_cast<size_t>(i)] = block[static_cast<size_t>(i)];
        tail[static_cast<size_t>(rem)] = 0x80;
        const uint64_t bitLen = totalBytes * 8;
        const size_t tailLen = (static_cast<size_t>(rem) + 1 + 8 <= 64) ? 64 : 128;
        for (int i = 0; i < 8; ++i) {
            tail[tailLen - 1 - static_cast<size_t>(i)] = static_cast<uint8_t>(bitLen >> (i * 8));
        }
        transform(h, tail.data());
        if (tailLen == 128) transform(h, tail.data() + 64);

        std::ostringstream out;
        out << std::hex << std::setfill('0');
        for (uint32_t x : h) out << std::setw(8) << x;
        return out.str();
    }
};

class FileRecord {
protected:
    std::string path_;
    std::string hash_;
    uintmax_t size_ = 0;
public:
    FileRecord(std::string path, std::string hash, uintmax_t size)
        : path_(std::move(path)), hash_(std::move(hash)), size_(size) {}
    virtual ~FileRecord() = default;
    virtual std::string kind() const = 0;
    const std::string& path() const { return path_; }
    const std::string& hash() const { return hash_; }
    uintmax_t size() const { return size_; }
};

class RegularFileRecord final : public FileRecord {
public:
    using FileRecord::FileRecord;
    std::string kind() const override { return "regular"; }
};

class Scanner {
    const HashAlgorithm& hasher_;
    static inline size_t scannedCount_ = 0;
public:
    explicit Scanner(const HashAlgorithm& hasher) : hasher_(hasher) {}
    ~Scanner() = default;

    static size_t scannedCount() { return scannedCount_; }

    std::vector<RegularFileRecord> scan(const fs::path& root) const {
        if (!fs::exists(root)) throw std::runtime_error("Path does not exist: " + root.string());
        std::vector<RegularFileRecord> records;
        if (fs::is_regular_file(root)) {
            auto size = fs::file_size(root);
            records.emplace_back(root.string(), hasher_.hashFile(root), size);
            ++scannedCount_;
            return records;
        }
        for (const auto& e : fs::recursive_directory_iterator(root, fs::directory_options::skip_permission_denied)) {
            if (!e.is_regular_file()) continue;
            try {
                auto size = e.file_size();
                records.emplace_back(e.path().string(), hasher_.hashFile(e.path()), size);
                ++scannedCount_;
            } catch (const std::exception&) {
                // Ignore inaccessible/unstable files; Python layer can report scan count.
            }
        }
        std::sort(records.begin(), records.end(), [](const auto& a, const auto& b){ return a.path() < b.path(); });
        return records;
    }
};

static std::string escapeJson(const std::string& s) {
    std::string out;
    for (char c : s) {
        switch (c) {
            case '\\': out += "\\\\"; break;
            case '"': out += "\\\""; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default: out += c;
        }
    }
    return out;
}

static void printJson(const HashAlgorithm& hasher, const std::vector<RegularFileRecord>& records) {
    std::cout << "{\"algorithm\":\"" << escapeJson(hasher.name()) << "\",\"count\":" << records.size() << ",\"files\":[";
    for (size_t i = 0; i < records.size(); ++i) {
        if (i) std::cout << ',';
        std::cout << "{\"path\":\"" << escapeJson(records[i].path())
                  << "\",\"hash\":\"" << records[i].hash()
                  << "\",\"size\":" << records[i].size() << "}";
    }
    std::cout << "]}" << std::endl;
}

int main(int argc, char** argv) {
    try {
        if (argc != 3 || (std::string(argv[1]) != "--hash" && std::string(argv[1]) != "--scan")) {
            std::cerr << "Usage: integrity_engine --hash <file> | --scan <directory>\n";
            return 2;
        }
        SHA256Hasher hasher;
        const std::string mode = argv[1];
        const fs::path target = argv[2];
        if (mode == "--hash") {
            if (!fs::is_regular_file(target)) throw std::runtime_error("Not a regular file: " + target.string());
            std::vector<RegularFileRecord> rec{RegularFileRecord(target.string(), hasher.hashFile(target), fs::file_size(target))};
            printJson(hasher, rec);
        } else {
            Scanner scanner(hasher);
            printJson(hasher, scanner.scan(target));
        }
        return 0;
    } catch (const std::exception& ex) {
        std::cerr << "ERROR: " << ex.what() << std::endl;
        return 1;
    }
}
