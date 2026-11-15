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
