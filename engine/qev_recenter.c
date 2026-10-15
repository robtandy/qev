/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "qev_recenter.h"
#include <math.h>
#include <limits.h>

void qev_RecenterReset(qev_recenter_t *s) { *s = (qev_recenter_t){0}; }
void qev_RecenterSuspend(qev_recenter_t *s) { s->active = s->remaining = 0; s->deadline = 0; }
void qev_RecenterForget(qev_recenter_t *s) { qev_RecenterSuspend(s); s->owed = 0; }
void qev_RecenterAimed(qev_recenter_t *s) { qev_RecenterSuspend(s); s->owed = 1; }
void qev_RecenterRelease(qev_recenter_t *s, double now) {
    if (!s->owed || s->active || !isfinite(now)) return;
    s->active = 1; s->remaining = qev_RECENTER_TICKS; s->deadline = now + qev_RECENTER_SECONDS;
}
void qev_RecenterCommand(qev_recenter_t *s, int targeted, int explicit_pitch, double now) {
    /* Active target/explicit-look input wins. Only an executed camera-control
     * tick owes recovery; accepting an unexecuted look must not acquire it. */
    if (targeted || explicit_pitch) qev_RecenterSuspend(s);
    else qev_RecenterRelease(s, now); /* Includes an ordinary move/turn/raw attack/wait. */
}
float qev_RecenterStep(qev_recenter_t *s, float pitch, float dt, double now) {
    if (!s->active) return pitch;
    if (!isfinite(pitch) || !isfinite(dt) || dt <= 0 || !isfinite(now) || now >= s->deadline || s->remaining <= 0) {
        qev_RecenterSuspend(s); return pitch;
    }
    /* At most one 60-Hz tick's angular step, even if an invalid large dt is passed. */
    float step = qev_RECENTER_RATE * fminf(dt, 1.0f / 60.0f);
    float next = fabsf(pitch) <= step ? 0 : pitch - copysignf(step, pitch);
    s->remaining--;
    if (next != pitch && s->ticks < UINT_MAX) s->ticks++;
    if (next == 0) qev_RecenterForget(s);
    else if (!s->remaining) qev_RecenterSuspend(s);
    return next;
}
