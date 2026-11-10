#pragma once
// World pins (#43): where a point in the world lands on the screen, from the game's camera.
// Header-only and free of the game, so native/tests/pins_test.cpp checks it.
//
// The game's world is Z up. A camera looks along its own +Y, with +X to its right and +Z up
// (the WP1 spike checks this, and the field of view's meaning, against the game's own
// gameCameraSystem.ProjectPoint, and logs both).

#include <algorithm>
#include <cmath>

namespace rednode::overlay::pins
{
struct Camera
{
    float px = 0, py = 0, pz = 0;         // position
    float qi = 0, qj = 0, qk = 0, qr = 1; // orientation, a unit quaternion
    float fovDeg = 60;                    // the game's GetActiveCameraFOV
    float aspect = 16.0f / 9.0f;          // the game's GetAspectRatio, or the screen's
    bool valid = false;
};

enum class FovMode
{
    Vertical,   // fovDeg is the angle from the bottom of the view to the top
    Horizontal, // from the left of the view to the right
};

// v rotated by the inverse of the quaternion: a world direction in the camera's own axes.
inline void ToCamera(const Camera& c, float x, float y, float z, float& rx, float& ry, float& rz)
{
    const float qx = -c.qi, qy = -c.qj, qz = -c.qk, qw = c.qr; // the conjugate
    // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
    const float tx = 2 * (qy * z - qz * y);
    const float ty = 2 * (qz * x - qx * z);
    const float tz = 2 * (qx * y - qy * x);
    rx = x + qw * tx + (qy * tz - qz * ty);
    ry = y + qw * ty + (qz * tx - qx * tz);
    rz = z + qw * tz + (qx * ty - qy * tx);
}

// The camera's forward direction in the world: its +Y.
inline void Forward(const Camera& c, float& fx, float& fy, float& fz)
{
    // v rotated by q itself (not its conjugate).
    const float qx = c.qi, qy = c.qj, qz = c.qk, qw = c.qr;
    const float x = 0, y = 1, z = 0;
    const float tx = 2 * (qy * z - qz * y);
    const float ty = 2 * (qz * x - qx * z);
    const float tz = 2 * (qx * y - qy * x);
    fx = x + qw * tx + (qy * tz - qz * ty);
    fy = y + qw * ty + (qz * tx - qx * tz);
    fz = z + qw * tz + (qx * ty - qy * tx);
}

struct Projected
{
    float ndcX = 0, ndcY = 0; // -1 left .. 1 right, -1 bottom .. 1 top; mirrored when behind
    float depth = 0;          // metres along the camera's forward axis; <= 0 behind it
    float distance = 0;       // metres from the camera
    bool behind = false;
};

inline Projected Project(const Camera& c, float x, float y, float z, FovMode aMode)
{
    Projected p;
    float rx, ry, rz;
    ToCamera(c, x - c.px, y - c.py, z - c.pz, rx, ry, rz);
    p.depth = ry;
    p.distance = std::sqrt(rx * rx + ry * ry + rz * rz);
    const float aspect = c.aspect > 0.1f ? c.aspect : 16.0f / 9.0f;
    const float half = c.fovDeg * 0.5f * 3.14159265f / 180.0f;
    float tanV = std::tan(half);
    if (aMode == FovMode::Horizontal)
        tanV /= aspect;
    const float tanH = tanV * aspect;
    // Behind the camera, or nearly level with it: keep the direction only, for the edge arrow.
    const float d = std::max(std::fabs(ry), 0.05f);
    p.behind = ry <= 0.05f;
    p.ndcX = (rx / d) / tanH;
    p.ndcY = (rz / d) / tanV;
    if (p.behind)
    {
        // Behind: held at the side to turn toward (its x keeps its sign, since |ry| is used), or
        // at the bottom when it is straight behind.
        if (std::fabs(rx) < 0.05f * d)
        {
            p.ndcX = 0;
            p.ndcY = -2;
        }
        else
        {
            p.ndcX = (rx > 0 ? 1.0f : -1.0f) * std::max(std::fabs(p.ndcX), 2.0f);
            p.ndcY = std::clamp(p.ndcY, -0.9f, 0.9f) * 0.5f;
        }
    }
    return p;
}

// Where a pin goes on a screen of aW x aH pixels: on screen at its point, or held at the edge
// (aMargin pixels in) on the line from the middle toward it. aSide: 0 on screen, 1 left,
// 2 right, 3 top, 4 bottom.
inline void ToScreen(const Projected& p, float aW, float aH, float aMargin, float& sx, float& sy, int& aSide)
{
    sx = (p.ndcX * 0.5f + 0.5f) * aW;
    sy = (0.5f - p.ndcY * 0.5f) * aH;
    const bool inside = !p.behind && sx >= aMargin && sx <= aW - aMargin && sy >= aMargin && sy <= aH - aMargin;
    aSide = 0;
    if (inside)
        return;
    const float cx = aW * 0.5f, cy = aH * 0.5f;
    float vx = sx - cx, vy = sy - cy;
    if (std::fabs(vx) < 1e-3f && std::fabs(vy) < 1e-3f)
        vy = 1;
    const float hx = cx - aMargin, hy = cy - aMargin;
    const float tx = std::fabs(vx) > 1e-6f ? hx / std::fabs(vx) : 1e30f;
    const float ty = std::fabs(vy) > 1e-6f ? hy / std::fabs(vy) : 1e30f;
    const float t = std::min(tx, ty);
    sx = cx + vx * t;
    sy = cy + vy * t;
    if (tx <= ty)
        aSide = vx < 0 ? 1 : 2;
    else
        aSide = vy < 0 ? 3 : 4;
}

// ---- WP2: how big a pin is drawn, and whether a wall hides it ----

// A pin's `scale` (docs/world.md, "World pins (#43): plan"):
//   Fit:    shrinks with distance down to minScreen of its full size, then stays; dimmed behind a wall
//   World:  a real size, shrinking with distance; hidden behind a wall
//   Screen: the same size at any distance; shown through walls
enum class ScaleMode
{
    Fit,
    World,
    Screen,
};

// The distance at which a pin is drawn at its full size, in metres.
constexpr float FullSizeDistance = 15.0f;
// The largest a World pin grows when the camera is close.
constexpr float WorldMaxScale = 2.0f;
// Below this, a World pin is too small to read and is not drawn.
constexpr float WorldMinScale = 0.05f;
// A Screen pin's post, in reference pixels.
constexpr float ScreenPost = 72.0f;

struct Sizing
{
    float scale = 1;  // the label's and the post's width, times their size in the atlas
    float postPx = 0; // the post's height on screen, reference pixels
    bool hide = false;
};

// aDepth: metres along the camera's forward axis; aProjectedPost: the post's height on screen
// from the world (its foot to its top, projected).
inline Sizing SizeFor(ScaleMode aMode, float aDepth, float aProjectedPost, float aMinScreen, float aPostMin, float aPostMax)
{
    Sizing s;
    const float natural = aDepth > 0.05f ? FullSizeDistance / aDepth : WorldMaxScale;
    switch (aMode)
    {
    case ScaleMode::Screen:
        s.scale = 1;
        s.postPx = ScreenPost;
        break;
    case ScaleMode::World:
        s.scale = std::min(natural, WorldMaxScale);
        s.postPx = std::clamp(aProjectedPost, 0.0f, 4000.0f);
        s.hide = s.scale < WorldMinScale;
        break;
    case ScaleMode::Fit:
    default:
        s.scale = std::clamp(natural, std::clamp(aMinScreen, 0.05f, 1.0f), 1.0f);
        s.postPx = std::clamp(aProjectedPost, aPostMin * s.scale, aPostMax);
        break;
    }
    return s;
}

// A ray cast from the camera toward a pin hit something before the pin: a hit within this many
// metres of the pin counts as the pin's own place (it stands on, or in, what it marks).
constexpr float CastSlack = 0.75f;

inline bool Blocked(bool aHit, float aHitDistance, float aPinDistance)
{
    return aHit && aHitDistance < aPinDistance - CastSlack;
}

// How opaque a pin is drawn: Fit pins behind a wall are dimmed (World ones are not drawn).
constexpr float DimmedAlpha = 0.45f;
} // namespace rednode::overlay::pins
