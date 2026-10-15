/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "qev_recenter.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <limits.h>

static void returns_to_level(float start) {
    qev_recenter_t s = {0}; float pitch = start;
    assert(qev_RecenterStep(&s, pitch, 1.0f / 60, 1) == pitch);
    qev_RecenterAimed(&s);
    assert(s.owed && !s.active);
    assert(qev_RecenterStep(&s, pitch, 1.0f / 60, 1) == pitch); /* Still aiming. */
    qev_RecenterRelease(&s, 1);
    for (int i = 0; s.active && i < qev_RECENTER_TICKS; i++) {
        float next = qev_RecenterStep(&s, pitch, 1.0f / 60, 1 + i / 60.0);
        assert(fabsf(next - pitch) <= 3.00001f && fabsf(next) <= fabsf(pitch));
        assert(next == 0 || signbit(next) == signbit(pitch));
        pitch = next;
    }
    assert(pitch == 0 && !s.active && !s.owed);
    assert(s.ticks == (unsigned)ceilf(fabsf(start) / 3.0f));
    unsigned int count = s.ticks;
    assert(qev_RecenterStep(&s, 0, 1.0f / 60, 10) == 0 && s.ticks == count);
}
int main(void) {
    for (int pitch = -70; pitch <= 80; pitch++) returns_to_level((float)pitch);
    returns_to_level(-0.01f); returns_to_level(0.01f);
    qev_recenter_t s = {0};
    qev_RecenterAimed(&s); qev_RecenterRelease(&s, 10);
    float pitch = qev_RecenterStep(&s, -60, 1.0f / 60, 10);
    assert(pitch == -57 && s.ticks == 1);
    int left = s.remaining;
    qev_RecenterCommand(&s, 0, 0, 10.5);
    assert(s.remaining == left && s.deadline == 10.75); /* Replacement never extends active cleanup. */
    qev_RecenterCommand(&s, 1, 0, 10.5);
    assert(!s.active && qev_RecenterStep(&s, pitch, 1.0f / 60, 10.5) == pitch);
    qev_RecenterAimed(&s); qev_RecenterRelease(&s, 11);
    qev_RecenterCommand(&s, 0, 1, 11);
    assert(s.owed && !s.active); /* An explicit look preempts recovery, not future ownership. */
    assert(qev_RecenterStep(&s, -60, 1.0f / 60, 11) == -60 && s.ticks == 1);
    qev_RecenterAimed(&s); /* Executed explicit pitch, just like an executed pixel aim. */
    qev_RecenterCommand(&s, 0, 0, 12);
    assert(s.active && s.deadline == 12.75);
    assert(qev_RecenterStep(&s, -60, 1.0f / 60, 12) == -57);
    qev_RecenterReset(&s);
    qev_RecenterCommand(&s, 0, 1, 13); /* Accepted/cancelled before any executed pitch tick. */
    qev_RecenterRelease(&s, 13);
    assert(!s.owed && !s.active && !s.ticks);
    for (int direction = -1; direction <= 1; direction += 2) {
        qev_RecenterCommand(&s, 0, 1, 14);
        qev_RecenterAimed(&s); qev_RecenterRelease(&s, 14);
        assert(qev_RecenterStep(&s, direction * 12, 1.0f / 60, 14) == direction * 9);
        qev_RecenterReset(&s);
    }

    qev_RecenterAimed(&s); qev_RecenterRelease(&s, 20);
    qev_RecenterSuspend(&s);
    assert(s.owed && !s.active && qev_RecenterStep(&s, -60, 1.0f / 60, 100) == -60);
    qev_RecenterCommand(&s, 0, 0, 100); /* A fresh ordinary command after pause can finish. */
    assert(s.active && s.deadline == 100.75);
    assert(qev_RecenterStep(&s, -60, 1.0f / 60, 100.75) == -60 && !s.active);
    qev_RecenterCommand(&s, 0, 0, 101);
    qev_RecenterForget(&s); /* Manual play/death/teleport must not inherit recovery. */
    assert(!s.owed && !s.active && s.ticks == 0);
    qev_RecenterReset(&s); assert(!s.ticks && !s.owed);

    qev_RecenterAimed(&s); qev_RecenterRelease(&s, 1);
    pitch = -70;
    for (int i = 0; i < qev_RECENTER_TICKS; i++) pitch = qev_RecenterStep(&s, pitch, 0.001f, 1.0 + i * 0.001);
    assert(s.ticks == qev_RECENTER_TICKS && !s.active && pitch < 0);
    assert(qev_RecenterStep(&s, pitch, 1.0f / 60, 1.1) == pitch); /* Tick watchdog, never an unbounded tail. */
    qev_RecenterRelease(&s, 2);
    assert(qev_RecenterStep(&s, -70, 999, 2) == -67); /* Bound an oversized timestep. */
    s.ticks = UINT_MAX;
    assert(qev_RecenterStep(&s, -67, 1.0f / 60, 2.1) == -64 && s.ticks == UINT_MAX);
    assert(qev_RecenterStep(&s, -64, NAN, 2.2) == -64 && !s.active);
    qev_RecenterRelease(&s, INFINITY); assert(!s.active);
    qev_RecenterRelease(&s, 3);
    assert(isnan(qev_RecenterStep(&s, NAN, 1.0f / 60, 3)) && !s.active);
    puts("PASS bounded own-camera return to level, explicit-look priority, Stop, replacement, timing and counters");
    return 0;
}
