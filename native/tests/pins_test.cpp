// Tests for the world pins' projection (src/overlay/pins.hpp, #43): where a world point lands on
// the screen, and where an off-screen pin is held at the edge. No game needed.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../src/overlay/pins.hpp"

#include <cmath>
#include <cstdio>

using namespace rednode::overlay::pins;

namespace
{
int g_failed = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s %s\n", aOk ? "ok  " : "FAIL", aWhat);
    if (!aOk)
        ++g_failed;
}

bool Near(float a, float b, float tol = 1e-3f)
{
    return std::fabs(a - b) <= tol;
}

// A camera at the origin looking along +Y (no rotation), 90 degrees vertical, square view.
Camera Straight()
{
    Camera c;
    c.fovDeg = 90;
    c.aspect = 1;
    c.valid = true;
    return c;
}

// The unit quaternion for a turn of aDeg about +Z (to the left, seen from above).
Camera Yawed(float aDeg)
{
    Camera c = Straight();
    const float half = aDeg * 0.5f * 3.14159265f / 180.0f;
    c.qk = std::sin(half);
    c.qr = std::cos(half);
    return c;
}
} // namespace

int main()
{
    {
        const auto p = Project(Straight(), 0, 10, 0, FovMode::Vertical);
        Check(Near(p.ndcX, 0) && Near(p.ndcY, 0) && Near(p.depth, 10) && !p.behind, "a point straight ahead is in the middle");
    }
    {
        // 45 degrees half-angle: at 10 m ahead, 10 m to the right is the right edge.
        const auto p = Project(Straight(), 10, 10, 0, FovMode::Vertical);
        Check(Near(p.ndcX, 1), "10 m right at 10 m with 90 degrees is the right edge");
        const auto q = Project(Straight(), 0, 10, 10, FovMode::Vertical);
        Check(Near(q.ndcY, 1), "10 m up at 10 m is the top edge");
    }
    {
        // A wide view: the vertical angle stays, so x is divided by the aspect.
        Camera c = Straight();
        c.aspect = 2;
        const auto p = Project(c, 10, 10, 0, FovMode::Vertical);
        Check(Near(p.ndcX, 0.5f), "vertical field of view: x shrinks with a wider aspect");
        const auto h = Project(c, 10, 10, 0, FovMode::Horizontal);
        Check(Near(h.ndcX, 1), "horizontal field of view: x is the right edge whatever the aspect");
    }
    {
        // Turned 90 degrees left (about +Z): forward is now -X.
        const Camera c = Yawed(90);
        float fx, fy, fz;
        Forward(c, fx, fy, fz);
        Check(Near(fx, -1) && Near(fy, 0) && Near(fz, 0), "a 90 degree turn left looks along -X");
        const auto p = Project(c, -10, 0, 0, FovMode::Vertical);
        Check(Near(p.ndcX, 0) && Near(p.depth, 10), "a point along -X is ahead after the turn");
        const auto r = Project(c, -10, 10, 0, FovMode::Vertical);
        Check(Near(r.ndcX, 1) && Near(r.depth, 10), "the old forward (+Y) is now to the right: 10 m ahead, 10 m right");
    }
    {
        // Behind and to the right: held at the right edge.
        const auto p = Project(Straight(), 5, -10, 0, FovMode::Vertical);
        Check(p.behind && p.ndcX > 1, "a point behind on the right points right");
        float sx, sy;
        int side;
        ToScreen(p, 1000, 1000, 20, sx, sy, side);
        Check(side == 2 && Near(sx, 980, 0.5f), "and is held at the right edge");
        const auto q = Project(Straight(), 0, -10, 0, FovMode::Vertical);
        ToScreen(q, 1000, 1000, 20, sx, sy, side);
        Check(q.behind && side == 4, "straight behind is held at the bottom");
    }
    {
        // On screen: pixels from the top-left.
        const auto p = Project(Straight(), 5, 10, 5, FovMode::Vertical);
        float sx, sy;
        int side;
        ToScreen(p, 1000, 1000, 20, sx, sy, side);
        Check(side == 0 && Near(sx, 750, 0.5f) && Near(sy, 250, 0.5f), "right and up lands right of the middle and above it");
        // Far off to the left, in front: held at the left edge on the line from the middle.
        const auto q = Project(Straight(), -100, 10, 0, FovMode::Vertical);
        ToScreen(q, 1000, 1000, 20, sx, sy, side);
        Check(side == 1 && Near(sx, 20, 0.5f) && Near(sy, 500, 0.5f), "far left is held at the left edge");
    }
    {
        const auto p = Project(Straight(), 3, 4, 0, FovMode::Vertical);
        Check(Near(p.distance, 5), "the distance is from the camera");
    }

    // ---- WP2: the scales and the wall test ----
    {
        const auto near = SizeFor(ScaleMode::Fit, 5, 300, 0.45f, 36, 420);
        Check(Near(near.scale, 1) && Near(near.postPx, 300), "fit, close: full size, the post as projected");
        const auto mid = SizeFor(ScaleMode::Fit, 30, 100, 0.45f, 36, 420);
        Check(Near(mid.scale, 0.5f), "fit at 30 m: half size (full size at 15 m)");
        const auto far = SizeFor(ScaleMode::Fit, 1000, 1, 0.45f, 36, 420);
        Check(Near(far.scale, 0.45f) && Near(far.postPx, 36 * 0.45f) && !far.hide, "fit, far: stays at its smallest, the post at its shortest");
        const auto tall = SizeFor(ScaleMode::Fit, 2, 5000, 0.45f, 36, 420);
        Check(Near(tall.postPx, 420), "fit: the post is never taller than postMax");
    }
    {
        const auto close = SizeFor(ScaleMode::World, 3, 600, 0.45f, 36, 420);
        Check(Near(close.scale, WorldMaxScale) && Near(close.postPx, 600), "world, close: grows to its largest, the post as projected");
        const auto mid = SizeFor(ScaleMode::World, 60, 40, 0.45f, 36, 420);
        Check(Near(mid.scale, 0.25f) && !mid.hide, "world at 60 m: a quarter size");
        const auto far = SizeFor(ScaleMode::World, 1000, 1, 0.45f, 36, 420);
        Check(far.hide, "world at 1 km: too small, not drawn");
    }
    {
        const auto a = SizeFor(ScaleMode::Screen, 2, 900, 0.45f, 36, 420);
        const auto b = SizeFor(ScaleMode::Screen, 3000, 0.1f, 0.45f, 36, 420);
        Check(Near(a.scale, 1) && Near(b.scale, 1) && Near(a.postPx, ScreenPost) && Near(b.postPx, ScreenPost), "screen: the same size at any distance");
    }
    {
        Check(!Blocked(false, 0, 50), "no hit: in view");
        Check(Blocked(true, 20, 50), "a hit 30 m short of the pin: behind a wall");
        Check(!Blocked(true, 49.5f, 50), "a hit at the pin's own place: in view");
    }

    std::printf(g_failed ? "%d failed\n" : "all passed\n", g_failed);
    return g_failed ? 1 : 0;
}
