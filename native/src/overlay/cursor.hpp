// The overlay's arrow as a small BGRA texture, premultiplied, like a window's frame.
//
// The arrow used to be drawn by the pixel shader itself (the same polygon, tested per
// pixel). On the user's laptop it stopped showing in the game after a save loaded while
// the windows, drawn by the same pass from textures, showed and the hover still worked
// (docs/overlay.md, "Cursor: drawn from a texture"). Made once on the CPU here, it is
// drawn exactly as a window is.

#pragma once

#include <cmath>
#include <cstdint>
#include <vector>

namespace rednode::overlay::detail::cursor
{
// The arrow, in reference pixels with the tip at (0, 0): 18 wide, 24 high.
constexpr float Width = 18.0f;
constexpr float Height = 24.0f;
// Texels per reference pixel: drawn at about 1.3 reference pixels a screen pixel at 1440p,
// so bilinear sampling of a 2x texture (no mipmaps) stays smooth.
constexpr int Scale = 2;
constexpr int TexWidth = static_cast<int>(Width) * Scale;   // 36
constexpr int TexHeight = static_cast<int>(Height) * Scale; // 48

inline constexpr float Arrow[7][2] = {{0, 0}, {0, 18}, {5, 13.5f}, {8.5f, 21}, {11.5f, 19.6f}, {8, 12.4f}, {15, 12.4f}};

// 0 outside, 1 outline, 2 fill, as the shader did it.
inline int Hit(float aX, float aY)
{
    bool inside = false;
    float d = 1e9f;
    for (int k = 0, j = 6; k < 7; j = k++)
    {
        const float ax = Arrow[k][0], ay = Arrow[k][1], bx = Arrow[j][0], by = Arrow[j][1];
        const float dy = by - ay;
        if ((ay > aY) != (by > aY) && aX < (bx - ax) * (aY - ay) / (std::fabs(dy) < 1e-4f ? 1e-4f : dy) + ax)
            inside = !inside;
        const float abx = bx - ax, aby = by - ay;
        float t = ((aX - ax) * abx + (aY - ay) * aby) / (abx * abx + aby * aby);
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const float px = aX - (ax + abx * t), py = aY - (ay + aby * t);
        d = std::fmin(d, std::sqrt(px * px + py * py));
    }
    if (inside)
        return d < 1.3f ? 1 : 2;
    return d < 1.3f ? 1 : 0;
}

// BGRA, premultiplied, TexWidth x TexHeight, 4 x 4 samples a texel for smooth edges.
inline std::vector<uint8_t> Pixels()
{
    constexpr float Fill[3] = {0.99f, 0.93f, 0.04f};      // r, g, b: the HUD yellow
    constexpr float Outline[3] = {0.03f, 0.035f, 0.05f};
    constexpr int Samples = 4;
    std::vector<uint8_t> out(static_cast<size_t>(TexWidth) * TexHeight * 4);
    for (int y = 0; y < TexHeight; y++)
    {
        for (int x = 0; x < TexWidth; x++)
        {
            float r = 0, g = 0, b = 0, a = 0;
            for (int sy = 0; sy < Samples; sy++)
            {
                for (int sx = 0; sx < Samples; sx++)
                {
                    const float px = (x + (sx + 0.5f) / Samples) / Scale;
                    const float py = (y + (sy + 0.5f) / Samples) / Scale;
                    const int hit = Hit(px, py);
                    if (!hit)
                        continue;
                    const float* c = hit == 2 ? Fill : Outline;
                    r += c[0];
                    g += c[1];
                    b += c[2];
                    a += 1;
                }
            }
            const float n = Samples * Samples;
            uint8_t* p = &out[(static_cast<size_t>(y) * TexWidth + x) * 4];
            p[0] = static_cast<uint8_t>(std::lround(b / n * 255));
            p[1] = static_cast<uint8_t>(std::lround(g / n * 255));
            p[2] = static_cast<uint8_t>(std::lround(r / n * 255));
            p[3] = static_cast<uint8_t>(std::lround(a / n * 255));
        }
    }
    return out;
}
} // namespace rednode::overlay::detail::cursor
