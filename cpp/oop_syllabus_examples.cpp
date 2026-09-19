#include <iostream>
#include <string>
#include <utility>

// This file is intentionally small and educational. It demonstrates syllabus topics
// that are not required by the hashing engine itself, so the project can be shown
// as an OOP laboratory exercise during a viva.

class AuditIdentity {
protected:
    std::string identity_;
public:
    explicit AuditIdentity(std::string id = "audit") : identity_(std::move(id)) {}
    virtual ~AuditIdentity() = default;
    virtual std::string label() const { return identity_; }
};

class IntegrityRecord : public virtual AuditIdentity {
protected:
    std::string path_;
    std::string hash_;
public:
    IntegrityRecord(std::string path, std::string hash)
        : AuditIdentity("file-record"), path_(std::move(path)), hash_(std::move(hash)) {}

    bool operator==(const IntegrityRecord& other) const {
        return path_ == other.path_ && hash_ == other.hash_;
    }

    std::string path() const { return path_; }

    friend std::ostream& operator<<(std::ostream& out, const IntegrityRecord& r) {
        return out << r.path_ << " => " << r.hash_;
    }
};

class Timestamped : public virtual AuditIdentity {
protected:
    long long stamp_ = 0;
public:
    explicit Timestamped(long long stamp = 0) : AuditIdentity("timestamp"), stamp_(stamp) {}
    long long stamp() const { return stamp_; }
};

// Multiple inheritance + virtual base class: AuditIdentity occurs only once.
class AuditedIntegrityRecord : public IntegrityRecord, public Timestamped {
public:
    AuditedIntegrityRecord(std::string path, std::string hash, long long stamp)
        : AuditIdentity("audited-record"), IntegrityRecord(std::move(path), std::move(hash)), Timestamped(stamp) {}

    std::string label() const override { return "audited: " + identity_; }
};

class Counter {
private:
    static int count_;
public:
    Counter() { ++count_; }
    ~Counter() { --count_; }
    static int active() { return count_; }
};

// Function overloading examples.
std::string describe(const IntegrityRecord& r) { return r.path(); }
std::string describe(const AuditedIntegrityRecord& r) { return r.label() + " / " + r.path(); }

int Counter::count_ = 0;

int main() {
    IntegrityRecord a("config.txt", "abc123");
    IntegrityRecord b("config.txt", "abc123");
    std::cout << "Friend/operator<< : " << a << '\n';
    std::cout << "Operator==         : " << (a == b ? "equal" : "different") << '\n';

    AuditedIntegrityRecord c("readme.txt", "def456", 123456789);
    std::cout << "Multiple inheritance: " << describe(c) << '\n';
    std::cout << "Virtual base label  : " << c.label() << '\n';

    Counter x, y;
    std::cout << "Static member count : " << Counter::active() << '\n';
    return 0;
}
