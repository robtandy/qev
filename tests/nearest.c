/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "qev_nearest.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>

int main(void) {
    qev_nearest_t s; const float eye[] = {10, -20, 5};
    const float a[] = {10, -20, 15}, b[] = {13, -16, 5}, tie[] = {7, -24, 5};
    qev_NearestReset(&s); assert(!s.slot && isinf(s.squared));
    /* A hidden object never needs readable coordinates, even if it is closest. */
    qev_NearestConsider(&s, 99, 0, NULL, (const float *)1); assert(!s.slot);
    qev_NearestConsider(&s, 0, 1, eye, eye); assert(!s.slot);
    qev_NearestConsider(&s, 4, 1, eye, a); assert(s.slot == 4 && s.squared == 100);
    qev_NearestConsider(&s, 8, 0, eye, eye); assert(s.slot == 4);
    qev_NearestConsider(&s, 8, 1, eye, b); assert(s.slot == 8 && s.squared == 25);
    qev_NearestConsider(&s, 7, 1, eye, tie); assert(s.slot == 7);
    qev_NearestConsider(&s, 9, 1, eye, tie); assert(s.slot == 7);
    const float invalid[] = {NAN, 0, 0}, infinity[] = {0, INFINITY, 0};
    qev_NearestConsider(&s, 2, 1, eye, invalid);
    qev_NearestConsider(&s, 2, 1, infinity, b); assert(s.slot == 7);
    qev_NearestConsider(&s, 3, 1, NULL, b); assert(s.slot == 7);
    /* No size/coverage input exists. A tiny visible object can win, and reset
     * cannot retain a now-hidden target from a previous frame. */
    qev_NearestConsider(&s, 100, 1, eye, eye); assert(s.slot == 100 && s.squared == 0);
    qev_NearestReset(&s); qev_NearestConsider(&s, 100, 0, eye, eye); assert(!s.slot);
    puts("PASS nearest visible: 3D metric, visibility gate, ties, invalid input, reset");
    return 0;
}
