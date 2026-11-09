// World pins (#43, WP1): pins the host asks for, drawn by the compositor where they land on the
// screen each frame.
//
// The host draws every pin's label (and the post and the edge arrows) once into one hidden
// window, the atlas, and tells the plugin where each one is in it:
//
//   {"cmd":"pins.set","window":7,"fov":"vertical","margin":28,"postMin":36,"postMax":420,
//    "post":[x,y,w,h],"arrows":{"left":[x,y,w,h],"right":[...],"up":[...],"down":[...]},
//    "pins":[{"id":1,"at":[x,y,z],"height":3,"label":[x,y,w,h]}, ...]}
//
// rectangles in the atlas's page pixels, positions in world metres. An empty "pins" clears
// them. On the game thread, each frame with pins, the plugin reads the active camera; on the
// render thread the compositor asks for the draws (CollectPinDraws). About three times a
// second it sends the host {"event":"pins.camera","pos":[x,y,z],"forward":[x,y,z]} for the
// labels' distances.
//
// The spike's checks (WP1, docs/world.md): every 2 s the log compares this projection, for
// both meanings of the field of view, with the game's own gameCameraSystem.ProjectPoint for
// the first pin, and gives the camera read's and the placement's cost.

#include "pins.hpp"

#include "jvalue.hpp"
#include "overlay.hpp"

#include <algorithm>
#include <chrono>
#include <mutex>
#include <vector>

namespace rednode::overlay::detail
{
namespace
{
struct Rect
{
    float x = 0, y = 0, w = 0, h = 0;
    bool set = false;
};

struct Pin
{
    uint32_t id = 0;
    float x = 0, y = 0, z = 0;
    float height = 3;
    Rect label;
};

std::mutex g_pinsMutex;
std::vector<Pin> g_pins;
uint32_t g_atlas = 0;
pins::FovMode g_fovMode = pins::FovMode::Vertical;
float g_margin = 28, g_postMin = 36, g_postMax = 420;
Rect g_post, g_arrowLeft, g_arrowRight, g_arrowUp, g_arrowDown;
pins::Camera g_cam;
bool g_camError = false; // logged once a session

// Cost, for the log line every 2 s.
double g_readUs = 0, g_placeUs = 0;
uint32_t g_reads = 0, g_places = 0, g_drawnMax = 0;

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

double MicrosSince(std::chrono::steady_clock::time_point aStart)
{
    return std::chrono::duration<double, std::micro>(std::chrono::steady_clock::now() - aStart).count();
}

void AddDraw(std::vector<PinDraw>& aOut, const Rect& aFrom, float aX, float aY, float aW, float aH)
{
    if (!aFrom.set)
        return;
    aOut.push_back({aX, aY, aW, aH, aFrom.x, aFrom.y, aFrom.x + aFrom.w, aFrom.y + aFrom.h});
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
    std::vector<Pin> list;
    if (const json::Value* items = v.Get("pins"); items && items->kind == json::Value::Kind::Array)
    {
        for (const auto& item : items->items)
        {
            const json::Value* at = item.Get("at");
            if (!at || at->kind != json::Value::Kind::Array || at->items.size() < 3)
                continue;
            Pin p;
            if (const json::Value* id = item.Get("id"))
                p.id = uint32_t(id->number);
            p.x = float(at->items[0].number);
            p.y = float(at->items[1].number);
            p.z = float(at->items[2].number);
            if (const json::Value* h = item.Get("height"); h && h->kind == json::Value::Kind::Number)
                p.height = float(h->number);
            p.label = RectOf(item.Get("label"));
            list.push_back(p);
        }
    }
    std::scoped_lock lock(g_pinsMutex);
    const bool had = !g_pins.empty();
    g_pins = std::move(list);
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
    g_post = RectOf(v.Get("post"));
    if (const json::Value* a = v.Get("arrows"))
    {
        g_arrowLeft = RectOf(a->Get("left"));
        g_arrowRight = RectOf(a->Get("right"));
        g_arrowUp = RectOf(a->Get("up"));
        g_arrowDown = RectOf(a->Get("down"));
    }
    if (g_pins.empty())
        g_cam.valid = false;
    if (had != !g_pins.empty())
        Log("Pins: %zu pin(s), field of view read as %s", g_pins.size(),
            g_fovMode == pins::FovMode::Horizontal ? "horizontal" : "vertical");
    return true;
}

void UpdatePins(uint64_t aFrame)
{
    Pin first;
    {
        std::scoped_lock lock(g_pinsMutex);
        if (g_pins.empty())
            return;
        first = g_pins.front();
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

    if (aFrame % 20 == 0)
    {
        float fx, fy, fz;
        pins::Forward(cam, fx, fy, fz);
        char buf[200];
        std::snprintf(buf, sizeof(buf), "{\"event\":\"pins.camera\",\"pos\":[%.3f,%.3f,%.3f],\"forward\":[%.4f,%.4f,%.4f]}",
                      cam.px, cam.py, cam.pz, fx, fy, fz);
        SendJson(buf);
    }

    // The spike's comparison with the game's own projection, every 2 s at 60 fps.
    if (aFrame % 120 == 0)
    {
        float game[4] = {};
        std::string why;
        const bool projected = GameProjectPoint(first.x, first.y, first.z, game, why);
        float gameFwd[3] = {};
        const bool forward = GameCameraForward(gameFwd, why);
        const auto v = pins::Project(cam, first.x, first.y, first.z, pins::FovMode::Vertical);
        const auto h = pins::Project(cam, first.x, first.y, first.z, pins::FovMode::Horizontal);
        float fx, fy, fz;
        pins::Forward(cam, fx, fy, fz);
        double readUs, placeUs;
        uint32_t drawn;
        {
            std::scoped_lock lock(g_pinsMutex);
            readUs = g_reads ? g_readUs / g_reads : 0;
            placeUs = g_places ? g_placeUs / g_places : 0;
            drawn = g_drawnMax;
            g_readUs = g_placeUs = 0;
            g_reads = g_places = g_drawnMax = 0;
        }
        Log("Pins: fov %.2f, aspect %.4f; pin %u at %.1f m: game %s (%.4f, %.4f, %.4f, %.4f), own vertical (%.4f, %.4f), "
            "horizontal (%.4f, %.4f), depth %.2f%s; forward game %s (%.4f, %.4f, %.4f), own (%.4f, %.4f, %.4f); "
            "camera read %.1f us, placing %.1f us, %u draws",
            cam.fovDeg, cam.aspect, first.id, v.distance, projected ? "" : "(failed)", game[0], game[1], game[2], game[3],
            v.ndcX, v.ndcY, h.ndcX, h.ndcY, v.depth, v.behind ? " (behind)" : "", forward ? "" : "(failed)", gameFwd[0],
            gameFwd[1], gameFwd[2], fx, fy, fz, readUs, placeUs, drawn);
        if (!projected || !forward)
            Log("Pins: the game's own projection or forward failed: %s", why.c_str());
    }
}

uint32_t CollectPinDraws(float aWidth, float aHeight, std::vector<PinDraw>& aOut)
{
    const auto start = std::chrono::steady_clock::now();
    std::scoped_lock lock(g_pinsMutex);
    if (g_pins.empty() || !g_cam.valid || !g_atlas)
        return 0;

    struct Placed
    {
        const Pin* pin;
        pins::Projected p;
    };
    std::vector<Placed> placed;
    placed.reserve(g_pins.size());
    for (const auto& pin : g_pins)
        placed.push_back({&pin, pins::Project(g_cam, pin.x, pin.y, pin.z, g_fovMode)});
    // The farthest first, so the nearest labels are drawn on top.
    std::sort(placed.begin(), placed.end(), [](const Placed& a, const Placed& b) { return a.p.distance > b.p.distance; });

    for (const auto& [pin, p] : placed)
    {
        float sx, sy;
        int side;
        pins::ToScreen(p, aWidth, aHeight, g_margin, sx, sy, side);
        const float lw = pin->label.w, lh = pin->label.h;
        if (side == 0)
        {
            // On screen: the post from the ground point up to the pin's height, then the label.
            const auto top = pins::Project(g_cam, pin->x, pin->y, pin->z + pin->height, g_fovMode);
            float tx, ty;
            int topSide;
            pins::ToScreen(top, aWidth, aHeight, -1e6f, tx, ty, topSide);
            const float postH = std::clamp(sy - ty, g_postMin, g_postMax);
            if (g_post.set)
                AddDraw(aOut, g_post, sx - g_post.w * 0.5f, sy - postH, g_post.w, postH);
            float lx = sx - lw * 0.5f, ly = sy - postH - lh - 4;
            lx = std::clamp(lx, 0.0f, std::max(0.0f, aWidth - lw));
            ly = std::clamp(ly, 0.0f, std::max(0.0f, aHeight - lh));
            AddDraw(aOut, pin->label, lx, ly, lw, lh);
        }
        else
        {
            // Off screen: the label at the edge, with the arrow to turn toward on its outer side.
            const Rect& arrow = side == 1 ? g_arrowLeft : side == 2 ? g_arrowRight : side == 3 ? g_arrowUp : g_arrowDown;
            float lx = sx - lw * 0.5f, ly = sy - lh * 0.5f;
            float ax = sx - arrow.w * 0.5f, ay = sy - arrow.h * 0.5f;
            if (side == 1)
            {
                ax = sx - arrow.w * 0.5f;
                lx = ax + arrow.w + 4;
            }
            else if (side == 2)
            {
                ax = sx - arrow.w * 0.5f;
                lx = ax - 4 - lw;
            }
            else if (side == 3)
            {
                ay = sy - arrow.h * 0.5f;
                ly = ay + arrow.h + 4;
            }
            else
            {
                ay = sy - arrow.h * 0.5f;
                ly = ay - 4 - lh;
            }
            lx = std::clamp(lx, 0.0f, std::max(0.0f, aWidth - lw));
            ly = std::clamp(ly, 0.0f, std::max(0.0f, aHeight - lh));
            AddDraw(aOut, arrow, ax, ay, arrow.w, arrow.h);
            AddDraw(aOut, pin->label, lx, ly, lw, lh);
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
    g_atlas = 0;
    g_cam.valid = false;
}
} // namespace rednode::overlay::detail
