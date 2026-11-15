// Tests for the controller's events (src/overlay/gamepad.hpp): when a change is sent, and the
// event's JSON. No controller needed.
//
//   .\tools\build-native.ps1 builds and runs it.

#include "../src/overlay/gamepad.hpp"

#include <cstdio>
#include <string>

using namespace rednode::overlay::gamepad;

namespace
{
int g_failed = 0;

void Check(bool aOk, const char* aWhat)
{
    std::printf("%s %s\n", aOk ? "ok  " : "FAIL", aWhat);
    if (!aOk)
        ++g_failed;
}

State Pad(uint16_t aButtons = 0, uint8_t aLt = 0, uint8_t aRt = 0)
{
    State s;
    s.connected = true;
    s.buttons = aButtons;
    s.lt = aLt;
    s.rt = aRt;
    return s;
}

bool Has(const std::string& aText, const char* aPart)
{
    return aText.find(aPart) != std::string::npos;
}
} // namespace

int main()
{
    // When to send.
    Check(!Changed(Pad(), Pad()), "nothing changed: nothing sent");
    Check(Changed(State{}, Pad()), "a controller connected is sent");
    Check(Changed(Pad(), State{}), "a controller gone is sent");
    Check(Changed(Pad(), Pad(0x1000)), "a button down is sent");
    Check(Changed(Pad(0x1000), Pad()), "a button up is sent");
    Check(!Changed(Pad(0, 0, 100), Pad(0, 0, 110)), "a trigger moving less than a step is not sent");
    Check(Changed(Pad(0, 0, 100), Pad(0, 0, 116)), "a trigger moving a step is sent");
    Check(Changed(Pad(0, 0, 116), Pad(0, 0, 100)), "a step back is sent too");
    Check(Changed(Pad(0, 0, 250), Pad(0, 0, 255)), "a trigger pressed all the way is sent, however small the move");
    Check(Changed(Pad(0, 5), Pad(0, 0)), "a trigger let go is sent, however small the move");

    // The event.
    const std::string e = EventJson(Pad(0x0100), Pad(0x1100, 0, 255), 42);
    Check(Has(e, "\"event\":\"game\",\"name\":\"gamepad\""), "a game event named gamepad");
    Check(!Has(e, "\"id\""), "no id field (the host takes one for a request's answer)");
    Check(Has(e, "\"frame\":42"), "the frame");
    Check(Has(e, "\"buttons\":[\"lb\",\"a\"]"), "the buttons held, by name");
    Check(Has(e, "\"pressed\":[\"a\"]"), "the buttons just pressed");
    Check(Has(e, "\"released\":[]"), "none released");
    Check(Has(e, "\"lt\":0.000") && Has(e, "\"rt\":1.000"), "triggers from 0 to 1");
    const std::string up = EventJson(Pad(0x1100), Pad(0x0100, 0, 128), 43);
    Check(Has(up, "\"released\":[\"a\"]") && Has(up, "\"pressed\":[]"), "a release names the button");
    Check(Has(up, "\"rt\":0.502"), "a trigger half way");
    const std::string gone = EventJson(Pad(0x1000), State{}, 44);
    Check(Has(gone, "\"connected\":false") && Has(gone, "\"buttons\":[]") && Has(gone, "\"released\":[\"a\"]"),
          "a controller gone lets go of everything");

    // Sony pads, from their HID input reports (0.65.1).
    Check(SonyPadOf(0x054C, 0x0CE6) == SonyPad::DualSense, "the DualSense is known");
    Check(SonyPadOf(0x054C, 0x0DF2) == SonyPad::DualSense, "the DualSense Edge reads as a DualSense");
    Check(SonyPadOf(0x054C, 0x09CC) == SonyPad::DualShock4, "the DualShock 4 is known");
    Check(SonyPadOf(0x045E, 0x0CE6) == SonyPad::None, "another maker's product with the same number is not");

    // DualSense over USB: id 0x01, 64 bytes; L2 at 5, R2 at 6, the hat and face at 8, shoulders at 9.
    uint8_t usb[64] = {};
    usb[0] = 0x01;
    usb[5] = 0;
    usb[6] = 200;          // R2 most of the way
    usb[8] = 0x08 | 0x20;  // no hat, cross
    usb[9] = 0x02 | 0x20;  // R1, options
    State ds;
    Check(ParseSony(SonyPad::DualSense, usb, sizeof(usb), ds), "a DualSense USB report reads");
    Check(ds.connected && ds.rt == 200 && ds.lt == 0, "its triggers");
    Check(ds.buttons == (0x1000 | 0x0200 | 0x0010), "cross is a, R1 is rb, options is start, no d-pad");
    usb[8] = 0x02; // the hat at right
    ParseSony(SonyPad::DualSense, usb, sizeof(usb), ds);
    Check(ds.buttons == (0x0008 | 0x0200 | 0x0010), "the hat at 2 is right on the d-pad");
    usb[8] = 0x07; // up and left
    ParseSony(SonyPad::DualSense, usb, sizeof(usb), ds);
    Check((ds.buttons & 0x000F) == (0x0001 | 0x0004), "the hat at 7 is up and left");

    // DualSense over Bluetooth, the full report: id 0x31, everything one byte later.
    uint8_t bt[78] = {};
    bt[0] = 0x31;
    bt[7] = 255;          // R2 all the way
    bt[9] = 0x08 | 0x80;  // triangle
    bt[10] = 0x01;        // L1
    State dsb;
    Check(ParseSony(SonyPad::DualSense, bt, sizeof(bt), dsb) && dsb.rt == 255 && dsb.buttons == (0x8000 | 0x0100),
          "a DualSense Bluetooth report: R2, triangle is y, L1 is lb");

    // DualSense over Bluetooth, the simple report before the game asks for more: 10 bytes.
    uint8_t simple[10] = {0x01, 128, 128, 128, 128, 0x08 | 0x40, 0x00, 0x00, 30, 90};
    State dss;
    Check(ParseSony(SonyPad::DualSense, simple, sizeof(simple), dss) && dss.lt == 30 && dss.rt == 90 && dss.buttons == 0x2000,
          "a DualSense simple report: triggers at 8 and 9, circle is b");

    // DualShock 4: USB id 0x01 (L2 8, R2 9, face 5), Bluetooth 0x11 (two bytes later).
    uint8_t ds4[64] = {};
    ds4[0] = 0x01;
    ds4[5] = 0x08 | 0x10; // square
    ds4[6] = 0x40;        // L3
    ds4[9] = 128;
    State d4;
    Check(ParseSony(SonyPad::DualShock4, ds4, sizeof(ds4), d4) && d4.rt == 128 && d4.buttons == (0x4000 | 0x0040),
          "a DualShock 4 USB report: square is x, L3 is ls");
    uint8_t ds4bt[78] = {};
    ds4bt[0] = 0x11;
    ds4bt[7] = 0x08;
    ds4bt[8] = 0x10; // share
    ds4bt[10] = 64;
    State d4b;
    Check(ParseSony(SonyPad::DualShock4, ds4bt, sizeof(ds4bt), d4b) && d4b.lt == 64 && d4b.buttons == 0x0020,
          "a DualShock 4 Bluetooth report: share is back");

    uint8_t other[64] = {0x05};
    State none;
    Check(!ParseSony(SonyPad::DualSense, other, sizeof(other), none), "an unknown report is not read");
    Check(!ParseSony(SonyPad::DualSense, usb, 4, none), "a short report is not read");

    std::printf("%s\n", g_failed ? "FAILED" : "all passed");
    return g_failed ? 1 : 0;
}
