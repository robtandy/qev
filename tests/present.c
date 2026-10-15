/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "qev_present.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>

/* Tiny palette/HUD fixture: compare every-frame presentation with one final
 * full conversion. The driver retains all intermediate framebuffer writes. */
static void final_pixels(void) {
    unsigned palette[4] = {0, 10, 20, 30}, frame[4] = {0}, baseline[4] = {0}, deferred[4] = {0};
    qev_present_t p = {0}; qev_PresentBegin(&p, 1);
    for (unsigned tick = 0; tick < 6; tick++) {
        frame[0] = tick % 4; // scene updates
        if (tick == 2) frame[3] = 3; // an earlier HUD-only dirty region
        if (tick == 4) palette[3] = 99; // an earlier palette change
        for (int i = 0; i < 4; i++) baseline[i] = palette[frame[i]];
        assert(qev_PresentDefer(&p)); qev_PresentHost(&p, 1);
    }
    assert(qev_PresentFlush(&p));
    for (int i = 0; i < 4; i++) deferred[i] = palette[frame[i]];
    for (int i = 0; i < 4; i++) assert(deferred[i] == baseline[i]);
    assert(deferred[3] == 99);
}

int main(void) {
    final_pixels();
    qev_present_t s = {0};
    qev_PresentBegin(&s, 0);
    assert(!qev_PresentDefer(&s)); qev_PresentDone(&s, 2);
    qev_PresentHost(&s, 5); assert(!qev_PresentFlush(&s)); qev_PresentLoop(&s, 6);
    assert(s.host_frames == 1 && s.presents == 1 && !s.deferred);
    assert(s.last_frames == 1 && s.max_frames == 1 && s.host_ms == 5 && s.present_ms == 2);

    /* All six physics/render steps still happen; their video uploads collapse to
     * one. This helper cannot call or skip game/renderer code itself. */
    qev_PresentBegin(&s, 1);
    for (int i = 0; i < 6; i++) { assert(qev_PresentDefer(&s)); qev_PresentHost(&s, 4); }
    assert(s.host_frames == 7 && s.presents == 1 && s.deferred == 6);
    assert(qev_PresentFlush(&s)); assert(!s.batching && !s.pending);
    assert(!qev_PresentDefer(&s)); qev_PresentDone(&s, 3); qev_PresentLoop(&s, 28);
    assert(!qev_PresentFlush(&s));
    assert(s.host_frames == 7 && s.presents == 2 && s.max_frames == 6 && s.last_frames == 6);
    assert(s.host_ms == 29 && s.present_ms == 5 && s.loop_ms == 34);

    /* Stop/death/world changes can end a predicted multi-frame loop early.
     * The one actual final framebuffer must still be presented. */
    qev_PresentBegin(&s, 1); assert(qev_PresentDefer(&s)); qev_PresentHost(&s, 1);
    assert(qev_PresentFlush(&s)); assert(!qev_PresentDefer(&s)); qev_PresentDone(&s, 1);
    qev_PresentLoop(&s, 2); assert(s.last_frames == 1 && s.max_frames == 6 && s.presents == 3);
    qev_PresentBegin(&s, 0); assert(!qev_PresentFlush(&s)); qev_PresentLoop(&s, 0);
    assert(s.last_frames == 0 && s.presents == 3);

    double host = s.host_ms, present = s.present_ms, loop = s.loop_ms;
    qev_PresentHost(&s, NAN); qev_PresentDone(&s, INFINITY); qev_PresentLoop(&s, -1);
    assert(s.invalid_times == 3 && s.host_ms == host && s.present_ms == present && s.loop_ms == loop);
    puts("PASS presentation: all host frames, one catch-up upload, early exits, finite diagnostics");
    return 0;
}
