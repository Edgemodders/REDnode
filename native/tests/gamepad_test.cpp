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

    std::printf("%s\n", g_failed ? "FAILED" : "all passed");
    return g_failed ? 1 : 0;
}
