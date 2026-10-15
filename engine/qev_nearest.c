/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "qev_nearest.h"
#include <math.h>

void qev_NearestReset(qev_nearest_t *s) { s->slot = 0; s->squared = INFINITY; }
void qev_NearestConsider(qev_nearest_t *s, int slot, int visible, const float eye[3], const float point[3]) {
    /* Hidden/ineligible objects must not even have their coordinates read. */
    if (!visible || slot <= 0 || !eye || !point) return;
    double distance = 0;
    for (int i = 0; i < 3; i++) {
        if (!isfinite(eye[i]) || !isfinite(point[i])) return;
        double delta = (double)point[i] - eye[i]; distance += delta * delta;
    }
    if (!isfinite(distance)) return;
    if (!s->slot || distance < s->squared || (distance == s->squared && slot < s->slot)) {
        s->slot = slot; s->squared = distance;
    }
}
