// World pins (#43): pins the host asks for, drawn by the compositor where they land on the
// screen each frame.
//
// The host draws every pin's label, and a post and four edge arrows for each colour in use, once
// into one hidden window, the atlas, and tells the plugin where each one is in it:
//
//   {"cmd":"pins.set","window":7,"fov":"vertical","margin":28,"postMin":36,"postMax":420,
//    "styles":[{"post":[x,y,w,h],"arrows":{"left":[x,y,w,h],"right":[...],"up":[...],"down":[...]}}, ...],
//    "pins":[{"id":1,"at":[x,y,z],"height":3,"label":[x,y,w,h],"style":0,"scale":"fit","min":0.45,
//             "entity":"1234567890"}, ...]}
//
// rectangles in the atlas's page pixels, positions in world metres. "style" picks the post and
// arrows (one set per colour); "scale" is fit, world or screen (pins.hpp's SizeFor); "entity" makes
// the pin follow that entity, with "at" its first place if known (no "at": not drawn until found).
// An empty "pins" clears them. WP1's form, with "post" and "arrows" at the top, is still read.
//
// On the game thread, each frame with pins, the plugin reads the active camera, finds where the
// followed entities are (up to FollowsPerFrame a frame), and casts rays from the camera to a few
// pins in view (CastsPerFrame a frame, each pin again after CastEvery frames) to learn which are
// behind a wall: a Fit pin is dimmed there, a World pin is not drawn, a Screen pin is never cast.
// On the render thread the compositor asks for the draws (CollectPinDraws). About three times a
// second it sends the host {"event":"pins.camera","pos":[x,y,z],"forward":[x,y,z],
// "follow":[[id,x,y,z],...]} for the labels' distances and where followed pins went.

#include "pins.hpp"

#include "jvalue.hpp"
#include "overlay.hpp"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <mutex>
#include <vector>

namespace rednode::overlay::detail
{
namespace
{
constexpr size_t FollowsPerFrame = 24;
constexpr size_t CastsPerFrame = 4;
constexpr uint64_t CastEvery = 10;      // frames between two casts for one pin
constexpr uint64_t CostLogEvery = 1800; // frames, about 30 s
constexpr float EdgeScale = 0.8f;       // the size of a label held at the screen's edge

struct Rect
{
    float x = 0, y = 0, w = 0, h = 0;
    bool set = false;
};

struct Style
{
    Rect post, left, right, up, down;
};

struct Pin
{
    uint32_t id = 0;
    float x = 0, y = 0, z = 0;
    float height = 3;
    Rect label;
    uint32_t style = 0;
    pins::ScaleMode scale = pins::ScaleMode::Fit;
    float minScreen = 0.45f;
    uint64_t entity = 0;
    bool placed = true;   // has a place: false for an entity pin not found yet
    bool occluded = false;
    bool cast = false;    // a ray was cast for it at least once
    uint64_t castFrame = 0;
    float sentX = 0, sentY = 0, sentZ = 0; // the followed place last sent to the host
    bool sent = false;
};

std::mutex g_pinsMutex;
std::vector<Pin> g_pins;
std::vector<Style> g_styles;
uint32_t g_atlas = 0;
pins::FovMode g_fovMode = pins::FovMode::Vertical;
float g_margin = 28, g_postMin = 36, g_postMax = 420;
pins::Camera g_cam;
bool g_camError = false; // logged once a session
size_t g_followCursor = 0;

// Cost, for the log line every CostLogEvery frames.
double g_readUs = 0, g_placeUs = 0, g_followUs = 0, g_castUs = 0;
uint32_t g_reads = 0, g_places = 0, g_follows = 0, g_casts = 0, g_drawnMax = 0;
bool g_castError = false, g_followError = false;

Rect RectOf(const json::Value* aValue)
{
    Rect r;
    if (aValue && aValue->kind == json::Value::Kind::Array && aValue->items.size() == 4)
    {
        r.x = float(aValue->items[0].number);
        r.y = float(aValue->items[1].number);
        r.w = float(aValue->items[2].number);
        r.h = float(aValue->items[3].number);
        r.set = r.w > 0 && r.h > 0;
    }
    return r;
}

Style StyleOf(const json::Value* aPost, const json::Value* aArrows)
{
    Style s;
    s.post = RectOf(aPost);
    if (aArrows)
    {
        s.left = RectOf(aArrows->Get("left"));
        s.right = RectOf(aArrows->Get("right"));
        s.up = RectOf(aArrows->Get("up"));
        s.down = RectOf(aArrows->Get("down"));
    }
    return s;
}

double MicrosSince(std::chrono::steady_clock::time_point aStart)
{
    return std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - aStart).count();
}

void AddDraw(std::vector<PinDraw>& aOut, const Rect& aFrom, float aX, float aY, float aW, float aH, float aAlpha)
{
    if (!aFrom.set)
        return;
    aOut.push_back({aX, aY, aW, aH, aFrom.x, aFrom.y, aFrom.x + aFrom.w, aFrom.y + aFrom.h, aAlpha});
}

pins::ScaleMode ScaleOf(const json::Value* aValue)
{
    if (aValue && aValue->kind == json::Value::Kind::String)
    {
        if (aValue->text == "world")
            return pins::ScaleMode::World;
        if (aValue->text == "screen")
            return pins::ScaleMode::Screen;
    }
    return pins::ScaleMode::Fit;
}

uint64_t HashOf(const json::Value* aValue)
{
    if (!aValue)
        return 0;
    if (aValue->kind == json::Value::Kind::String)
        return std::strtoull(aValue->text.c_str(), nullptr, 0); // decimal, or 0x hex
    if (aValue->kind == json::Value::Kind::Number && aValue->number > 0)
        return uint64_t(aValue->number);
    return 0;
}

const Pin* FindPin(const std::vector<Pin>& aList, uint32_t aId)
{
    for (const auto& p : aList)
        if (p.id == aId)
            return &p;
    return nullptr;
}
} // namespace

bool HandlePinsCommand(const std::string& aJson)
{
    if (aJson.find("\"cmd\":\"pins.set\"") == std::string::npos)
        return false;
    json::Value v;
    std::string error;
    if (!json::Parse(aJson, v, error))
    {
        Log("Pins: could not read pins.set: %s", error.c_str());
        return true;
    }
    std::vector<Style> styles;
    if (const json::Value* s = v.Get("styles"); s && s->kind == json::Value::Kind::Array)
        for (const auto& item : s->items)
            styles.push_back(StyleOf(item.Get("post"), item.Get("arrows")));
    if (styles.empty())
        styles.push_back(StyleOf(v.Get("post"), v.Get("arrows"))); // WP1's form

    std::vector<Pin> list;
    if (const json::Value* items = v.Get("pins"); items && items->kind == json::Value::Kind::Array)
    {
        for (const auto& item : items->items)
        {
            Pin p;
            if (const json::Value* id = item.Get("id"))
                p.id = uint32_t(id->number);
            p.entity = HashOf(item.Get("entity"));
            const json::Value* at = item.Get("at");
            const bool hasAt = at && at->kind == json::Value::Kind::Array && at->items.size() >= 3;
            if (!hasAt && !p.entity)
                continue;
            if (hasAt)
            {
                p.x = float(at->items[0].number);
                p.y = float(at->items[1].number);
                p.z = float(at->items[2].number);
            }
            p.placed = hasAt;
            if (const json::Value* h = item.Get("height"); h && h->kind == json::Value::Kind::Number)
                p.height = float(h->number);
            p.label = RectOf(item.Get("label"));
            if (const json::Value* s = item.Get("style"); s && s->kind == json::Value::Kind::Number)
                p.style = uint32_t(s->number);
            if (p.style >= styles.size())
                p.style = 0;
            p.scale = ScaleOf(item.Get("scale"));
            if (const json::Value* m = item.Get("min"); m && m->kind == json::Value::Kind::Number)
                p.minScreen = float(m->number);
            list.push_back(p);
        }
    }
    std::scoped_lock lock(g_pinsMutex);
    // What the plugin learned about a pin outlives a new layout: where its entity is, and the wall.
    for (auto& p : list)
    {
        const Pin* old = FindPin(g_pins, p.id);
        if (!old)
            continue;
        if (p.entity && p.entity == old->entity && old->placed)
        {
            p.x = old->x;
            p.y = old->y;
            p.z = old->z;
            p.placed = true;
            p.sentX = old->sentX;
            p.sentY = old->sentY;
            p.sentZ = old->sentZ;
            p.sent = old->sent;
        }
        p.occluded = old->occluded;
        p.cast = old->cast;
        p.castFrame = old->castFrame;
    }
    const bool had = !g_pins.empty();
    g_pins = std::move(list);
    g_styles = std::move(styles);
    if (const json::Value* w = v.Get("window"))
        g_atlas = uint32_t(w->number);
    if (const json::Value* fov = v.Get("fov"); fov && fov->kind == json::Value::Kind::String)
        g_fovMode = fov->text == "horizontal" ? pins::FovMode::Horizontal : pins::FovMode::Vertical;
    if (const json::Value* m = v.Get("margin"); m && m->kind == json::Value::Kind::Number)
        g_margin = float(m->number);
    if (const json::Value* m = v.Get("postMin"); m && m->kind == json::Value::Kind::Number)
        g_postMin = float(m->number);
    if (const json::Value* m = v.Get("postMax"); m && m->kind == json::Value::Kind::Number)
        g_postMax = float(m->number);
    if (g_pins.empty())
        g_cam.valid = false;
    if (had != !g_pins.empty())
        Log("Pins: %zu pin(s) in %zu style(s)", g_pins.size(), g_styles.size());
    return true;
}

namespace
{
// Where the followed entities are now: up to FollowsPerFrame a frame, taking turns.
void Follow()
{
    std::vector<std::pair<uint32_t, uint64_t>> wanted;
    {
        std::scoped_lock lock(g_pinsMutex);
        std::vector<std::pair<uint32_t, uint64_t>> all;
        for (const auto& p : g_pins)
            if (p.entity)
                all.emplace_back(p.id, p.entity);
        if (all.empty())
            return;
        const size_t n = std::min(all.size(), FollowsPerFrame);
        for (size_t k = 0; k < n; ++k)
            wanted.push_back(all[(g_followCursor + k) % all.size()]);
        g_followCursor = (g_followCursor + n) % all.size();
    }
    const auto start = std::chrono::steady_clock::now();
    struct Found
    {
        uint32_t id;
        float at[3];
    };
    std::vector<Found> found;
    for (const auto& [id, hash] : wanted)
    {
        Found f{id, {}};
        std::string why;
        if (EntityPosition(hash, f.at, why))
            found.push_back(f);
        else if (!g_followError && why != "not in the world")
        {
            g_followError = true;
            Log("Pins: could not find a followed entity: %s", why.c_str());
        }
    }
    const double us = MicrosSince(start);
    std::scoped_lock lock(g_pinsMutex);
    g_followUs += us;
    g_follows += uint32_t(wanted.size());
    for (const auto& f : found)
    {
        for (auto& p : g_pins)
        {
            if (p.id != f.id)
                continue;
            p.x = f.at[0];
            p.y = f.at[1];
            p.z = f.at[2];
            p.placed = true;
        }
    }
}

// Rays from the camera to a few pins in view whose last cast is oldest, for "behind a wall".
void Cast(uint64_t aFrame)
{
    struct Target
    {
        uint32_t id;
        float to[3];
        float distance;
        uint64_t last;
    };
    std::vector<Target> targets;
    float from[3];
    {
        std::scoped_lock lock(g_pinsMutex);
        if (!g_cam.valid)
            return;
        from[0] = g_cam.px;
        from[1] = g_cam.py;
        from[2] = g_cam.pz;
        for (const auto& p : g_pins)
        {
            if (p.scale == pins::ScaleMode::Screen || !p.placed || (p.cast && aFrame - p.castFrame < CastEvery))
                continue;
            const float tz = p.z + p.height; // the post's top, where the label is
            const auto pr = pins::Project(g_cam, p.x, p.y, tz, g_fovMode);
            if (pr.behind || std::fabs(pr.ndcX) > 1.1f || std::fabs(pr.ndcY) > 1.1f)
                continue; // out of view: drawn at the edge, never dimmed
            targets.push_back({p.id, {p.x, p.y, tz}, pr.distance, p.cast ? p.castFrame : 0});
        }
    }
    if (targets.empty())
        return;
    std::sort(targets.begin(), targets.end(), [](const Target& a, const Target& b) { return a.last < b.last; });
    if (targets.size() > CastsPerFrame)
        targets.resize(CastsPerFrame);

    struct Result
    {
        uint32_t id;
        bool blocked;
    };
    std::vector<Result> results;
    const auto start = std::chrono::steady_clock::now();
    for (const auto& t : targets)
    {
        bool hit = false;
        float point[3] = {};
        std::string why;
        if (!RaycastStatic(from, t.to, hit, point, why))
        {
            if (!g_castError)
            {
                g_castError = true;
                Log("Pins: the ray cast failed, so walls hide no pin: %s", why.c_str());
            }
            results.push_back({t.id, false});
            continue;
        }
        const float dx = point[0] - from[0], dy = point[1] - from[1], dz = point[2] - from[2];
        results.push_back({t.id, pins::Blocked(hit, std::sqrt(dx * dx + dy * dy + dz * dz), t.distance)});
    }
    const double us = MicrosSince(start);
    std::scoped_lock lock(g_pinsMutex);
    g_castUs += us;
    g_casts += uint32_t(targets.size());
    for (const auto& r : results)
    {
        for (auto& p : g_pins)
        {
            if (p.id != r.id)
                continue;
            p.occluded = r.blocked;
            p.cast = true;
            p.castFrame = aFrame;
        }
    }
}
} // namespace

void UpdatePins(uint64_t aFrame)
{
    {
        std::scoped_lock lock(g_pinsMutex);
        if (g_pins.empty())
            return;
    }
    const auto start = std::chrono::steady_clock::now();
    pins::Camera cam;
    std::string error;
    const bool ok = ReadCamera(cam, error);
    const double us = MicrosSince(start);
    {
        std::scoped_lock lock(g_pinsMutex);
        g_cam = ok ? cam : pins::Camera{};
        g_readUs += us;
        g_reads += 1;
    }
    if (!ok)
    {
        if (!g_camError)
        {
            g_camError = true;
            Log("Pins: could not read the camera: %s", error.c_str());
        }
        return;
    }
    g_camError = false;

    Follow();
    Cast(aFrame);

    if (aFrame % 20 == 0)
    {
        float fx, fy, fz;
        pins::Forward(cam, fx, fy, fz);
        char buf[200];
        std::snprintf(buf, sizeof(buf), "{\"event\":\"pins.camera\",\"pos\":[%.3f,%.3f,%.3f],\"forward\":[%.4f,%.4f,%.4f]",
                      cam.px, cam.py, cam.pz, fx, fy, fz);
        std::string msg = buf;
        // Followed pins that moved since the last send, for their distances and world.pins().
        std::string follow;
        {
            std::scoped_lock lock(g_pinsMutex);
            for (auto& p : g_pins)
            {
                if (!p.entity || !p.placed)
                    continue;
                const float dx = p.x - p.sentX, dy = p.y - p.sentY, dz = p.z - p.sentZ;
                if (p.sent && dx * dx + dy * dy + dz * dz < 0.25f * 0.25f)
                    continue;
                std::snprintf(buf, sizeof(buf), "%s[%u,%.3f,%.3f,%.3f]", follow.empty() ? "" : ",", p.id, p.x, p.y, p.z);
                follow += buf;
                p.sentX = p.x;
                p.sentY = p.y;
                p.sentZ = p.z;
                p.sent = true;
            }
        }
        if (!follow.empty())
            msg += ",\"follow\":[" + follow + "]";
        SendJson(msg + "}");
    }

    if (aFrame % CostLogEvery == 0)
    {
        double readUs, placeUs, followUs, castUs;
        uint32_t drawn, follows, casts, hidden;
        size_t count;
        {
            std::scoped_lock lock(g_pinsMutex);
            readUs = g_reads ? g_readUs / g_reads : 0;
            placeUs = g_places ? g_placeUs / g_places : 0;
            followUs = g_follows ? g_followUs / g_follows : 0;
            castUs = g_casts ? g_castUs / g_casts : 0;
            drawn = g_drawnMax;
            follows = g_follows;
            casts = g_casts;
            hidden = 0;
            for (const auto& p : g_pins)
                hidden += p.occluded ? 1 : 0;
            count = g_pins.size();
            g_readUs = g_placeUs = g_followUs = g_castUs = 0;
            g_reads = g_places = g_follows = g_casts = g_drawnMax = 0;
        }
        Log("Pins: %zu pin(s), %u behind a wall; a frame: camera read %.1f us, placing %.1f us, up to %u draws; "
            "%u entity lookups at %.1f us each, %u ray casts at %.1f us each, in the last %llu frames",
            count, hidden, readUs, placeUs, drawn, follows, followUs, casts, castUs, static_cast<unsigned long long>(CostLogEvery));
    }
}

uint32_t CollectPinDraws(float aWidth, float aHeight, std::vector<PinDraw>& aOut)
{
    const auto start = std::chrono::steady_clock::now();
    std::scoped_lock lock(g_pinsMutex);
    if (g_pins.empty() || !g_cam.valid || !g_atlas || g_styles.empty())
        return 0;

    struct Placed
    {
        const Pin* pin;
        pins::Projected p;
    };
    std::vector<Placed> placed;
    placed.reserve(g_pins.size());
    for (const auto& pin : g_pins)
        if (pin.placed && pin.label.set)
            placed.push_back({&pin, pins::Project(g_cam, pin.x, pin.y, pin.z, g_fovMode)});
    // The farthest first, so the nearest labels are drawn on top.
    std::sort(placed.begin(), placed.end(), [](const Placed& a, const Placed& b) { return a.p.distance > b.p.distance; });

    for (const auto& [pin, p] : placed)
    {
        const Style& style = g_styles[pin->style];
        float sx, sy;
        int side;
        pins::ToScreen(p, aWidth, aHeight, g_margin, sx, sy, side);
        if (side == 0)
        {
            // On screen: the post from the ground point up to the pin's height, then the label,
            // sized by its scale.
            const auto top = pins::Project(g_cam, pin->x, pin->y, pin->z + pin->height, g_fovMode);
            float tx, ty;
            int topSide;
            pins::ToScreen(top, aWidth, aHeight, -1e6f, tx, ty, topSide);
            const auto size = pins::SizeFor(pin->scale, p.depth, sy - ty, pin->minScreen, g_postMin, g_postMax);
            if (size.hide)
                continue;
            if (pin->occluded && pin->scale == pins::ScaleMode::World)
                continue;
            const float alpha = pin->occluded && pin->scale == pins::ScaleMode::Fit ? pins::DimmedAlpha : 1.0f;
            const float postW = style.post.w * std::max(size.scale, 0.5f);
            AddDraw(aOut, style.post, sx - postW * 0.5f, sy - size.postPx, postW, size.postPx, alpha);
            const float lw = pin->label.w * size.scale, lh = pin->label.h * size.scale;
            float lx = sx - lw * 0.5f, ly = sy - size.postPx - lh - 4 * size.scale;
            lx = std::clamp(lx, 0.0f, std::max(0.0f, aWidth - lw));
            ly = std::clamp(ly, 0.0f, std::max(0.0f, aHeight - lh));
            AddDraw(aOut, pin->label, lx, ly, lw, lh, alpha);
        }
        else
        {
            // Off screen: the label at the edge, with the arrow to turn toward on its outer side.
            const Rect& arrow = side == 1 ? style.left : side == 2 ? style.right : side == 3 ? style.up : style.down;
            const float lw = pin->label.w * EdgeScale, lh = pin->label.h * EdgeScale;
            float lx = sx - lw * 0.5f, ly = sy - lh * 0.5f;
            const float ax = sx - arrow.w * 0.5f, ay = sy - arrow.h * 0.5f;
            if (side == 1)
                lx = ax + arrow.w + 4;
            else if (side == 2)
                lx = ax - 4 - lw;
            else if (side == 3)
                ly = ay + arrow.h + 4;
            else
                ly = ay - 4 - lh;
            lx = std::clamp(lx, 0.0f, std::max(0.0f, aWidth - lw));
            ly = std::clamp(ly, 0.0f, std::max(0.0f, aHeight - lh));
            AddDraw(aOut, arrow, ax, ay, arrow.w, arrow.h, 1);
            AddDraw(aOut, pin->label, lx, ly, lw, lh, 1);
        }
    }
    g_placeUs += MicrosSince(start);
    g_places += 1;
    g_drawnMax = std::max<uint32_t>(g_drawnMax, uint32_t(aOut.size()));
    return g_atlas;
}

void ClearPins()
{
    std::scoped_lock lock(g_pinsMutex);
    g_pins.clear();
    g_styles.clear();
    g_atlas = 0;
    g_cam.valid = false;
}
} // namespace rednode::overlay::detail
