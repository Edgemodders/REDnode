#pragma once
// The controller's state as REDnode sends it to Node mods (gamepad.cpp): which buttons are held
// and how far each trigger is pressed. Pure logic, so the unit test can check it without XInput.
//
// A change is sent when a button goes down or up, or when a trigger moves a step (TriggerStep of
// 255) or reaches 0 or 255, so a slowly pressed trigger does not send an event every frame.

#include <cstdint>
#include <cstdio>
#include <string>

namespace rednode::overlay::gamepad
{
constexpr int TriggerStep = 16;

// XInput's button bits (XINPUT_GAMEPAD_*), named as Node mods see them.
struct ButtonName
{
    uint16_t bit;
    const char* name;
};
inline constexpr ButtonName Buttons[] = {
    {0x0001, "up"},    {0x0002, "down"},   {0x0004, "left"},  {0x0008, "right"},
    {0x0010, "start"}, {0x0020, "back"},   {0x0040, "ls"},    {0x0080, "rs"},
    {0x0100, "lb"},    {0x0200, "rb"},     {0x1000, "a"},     {0x2000, "b"},
    {0x4000, "x"},     {0x8000, "y"},
};

struct State
{
    bool connected = false;
    uint16_t buttons = 0;
    uint8_t lt = 0;
    uint8_t rt = 0;
};

// ---------- Sony pads, read from their HID input reports (REDnode 0.65.1) ----------
//
// A DualSense or DualShock 4 is no XInput controller, and with the game's own DualSense support
// Steam Input does not stand in for one. Their input reports are read as they come and turned
// into the same State, with the face buttons named as an Xbox pad's (cross a, circle b, square x,
// triangle y; create or share back, options start). Only reads: nothing is ever written to the
// pad, so the game's haptics, adaptive triggers and light bar are its own.

constexpr uint16_t SonyVendor = 0x054C;

enum class SonyPad
{
    None,
    DualSense,  // 0x0CE6, and the DualSense Edge 0x0DF2
    DualShock4, // 0x05C4, 0x09CC, and the wireless adapter 0x0BA0
};

inline SonyPad SonyPadOf(uint16_t aVendor, uint16_t aProduct)
{
    if (aVendor != SonyVendor)
        return SonyPad::None;
    if (aProduct == 0x0CE6 || aProduct == 0x0DF2)
        return SonyPad::DualSense;
    if (aProduct == 0x05C4 || aProduct == 0x09CC || aProduct == 0x0BA0)
        return SonyPad::DualShock4;
    return SonyPad::None;
}

// The d-pad's hat (0 up, then clockwise in eighths, 8 or more for none) as XInput's bits.
inline uint16_t HatBits(uint8_t aHat)
{
    static constexpr uint16_t Bits[8] = {0x0001, 0x0001 | 0x0008, 0x0008, 0x0002 | 0x0008,
                                         0x0002, 0x0002 | 0x0004, 0x0004, 0x0001 | 0x0004};
    return aHat < 8 ? Bits[aHat] : 0;
}

// The Sony buttons in the layout both pads share: aFace holds the hat (low four bits) and
// square, cross, circle, triangle (bits 4 to 7); aShoulder holds L1, R1, L2, R2 (bits 0 to 3),
// create or share, options, L3, R3 (bits 4 to 7).
inline uint16_t SonyButtons(uint8_t aFace, uint8_t aShoulder)
{
    uint16_t b = HatBits(uint8_t(aFace & 0x0F));
    if (aFace & 0x10) b |= 0x4000; // square: x
    if (aFace & 0x20) b |= 0x1000; // cross: a
    if (aFace & 0x40) b |= 0x2000; // circle: b
    if (aFace & 0x80) b |= 0x8000; // triangle: y
    if (aShoulder & 0x01) b |= 0x0100; // L1: lb
    if (aShoulder & 0x02) b |= 0x0200; // R1: rb
    if (aShoulder & 0x10) b |= 0x0020; // create or share: back
    if (aShoulder & 0x20) b |= 0x0010; // options: start
    if (aShoulder & 0x40) b |= 0x0040; // L3: ls
    if (aShoulder & 0x80) b |= 0x0080; // R3: rs
    return b;
}

// One input report (aData[0] is its report id) into aOut. False for a report it does not know.
//
// | Pad, link | Id | Sticks | L2, R2 | Face, shoulder |
// |---|---|---|---|---|
// | DualSense, USB | 0x01, 64 bytes | 1 to 4 | 5, 6 | 8, 9 |
// | DualSense, Bluetooth full | 0x31 | 2 to 5 | 6, 7 | 9, 10 |
// | DualSense, Bluetooth simple | 0x01, 10 bytes | 1 to 4 | 8, 9 | 5, 6 |
// | DualShock 4, USB or simple | 0x01 | 1 to 4 | 8, 9 | 5, 6 |
// | DualShock 4, Bluetooth full | 0x11 | 3 to 6 | 10, 11 | 7, 8 |
inline bool ParseSony(SonyPad aPad, const uint8_t* aData, size_t aLength, State& aOut)
{
    if (aPad == SonyPad::None || aLength < 10)
        return false;
    size_t trig = 0, face = 0;
    const uint8_t id = aData[0];
    if (aPad == SonyPad::DualSense && id == 0x01 && aLength > 10)
    {
        // USB: the full layout. (A 10-byte 0x01 is Bluetooth's simple report, below.)
        trig = 5;
        face = 8;
    }
    else if (aPad == SonyPad::DualSense && id == 0x31 && aLength >= 12)
    {
        trig = 6;
        face = 9;
    }
    else if (id == 0x01)
    {
        trig = 8;
        face = 5;
    }
    else if (aPad == SonyPad::DualShock4 && id == 0x11 && aLength >= 12)
    {
        trig = 10;
        face = 7;
    }
    else
    {
        return false;
    }
    aOut.connected = true;
    aOut.lt = aData[trig];
    aOut.rt = aData[trig + 1];
    aOut.buttons = SonyButtons(aData[face], aData[face + 1]);
    return true;
}

// The trigger value last sent moves to aNow when it changed enough to send.
inline bool TriggerMoved(uint8_t aSent, uint8_t aNow)
{
    if (aSent == aNow)
        return false;
    if (aNow == 0 || aNow == 255)
        return true;
    const int d = int(aNow) - int(aSent);
    return d >= TriggerStep || d <= -TriggerStep;
}

// Whether aNow differs from aSent enough to send.
inline bool Changed(const State& aSent, const State& aNow)
{
    return aSent.connected != aNow.connected || aSent.buttons != aNow.buttons || TriggerMoved(aSent.lt, aNow.lt) ||
           TriggerMoved(aSent.rt, aNow.rt);
}

// The game event: {"event":"game","name":"gamepad","value":0,"connected":true,"buttons":["a"],
// "pressed":["a"],"released":[],"lt":0,"rt":0.5}. Triggers as 0 to 1. No "id" field: the host
// takes one for a request's answer.
inline std::string EventJson(const State& aSent, const State& aNow, uint64_t aFrame)
{
    auto list = [](uint16_t aBits) {
        std::string out = "[";
        bool first = true;
        for (const auto& b : Buttons)
        {
            if (!(aBits & b.bit))
                continue;
            out += first ? "\"" : ",\"";
            out += b.name;
            out += "\"";
            first = false;
        }
        return out + "]";
    };
    auto unit = [](uint8_t aValue) {
        char buf[16];
        std::snprintf(buf, sizeof(buf), "%.3f", aValue / 255.0);
        return std::string(buf);
    };
    const uint16_t pressed = uint16_t(aNow.buttons & ~aSent.buttons);
    const uint16_t released = uint16_t(aSent.buttons & ~aNow.buttons);
    return "{\"event\":\"game\",\"name\":\"gamepad\",\"value\":0,\"frame\":" + std::to_string(aFrame) +
           ",\"connected\":" + (aNow.connected ? "true" : "false") + ",\"buttons\":" + list(aNow.buttons) +
           ",\"pressed\":" + list(pressed) + ",\"released\":" + list(released) + ",\"lt\":" + unit(aNow.lt) +
           ",\"rt\":" + unit(aNow.rt) + "}";
}
} // namespace rednode::overlay::gamepad
