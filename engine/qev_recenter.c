/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "qev_recenter.h"
#include <math.h>
#include <limits.h>

void Qev_RecenterReset(qev_recenter_t *s) { *s = (qev_recenter_t){0}; }
void Qev_RecenterSuspend(qev_recenter_t *s) { s->active = s->remaining = 0; s->deadline = 0; }
void Qev_RecenterForget(qev_recenter_t *s) { Qev_RecenterSuspend(s); s->owed = 0; }
void Qev_RecenterAimed(qev_recenter_t *s) { Qev_RecenterSuspend(s); s->owed = 1; }
void Qev_RecenterRelease(qev_recenter_t *s, double now) {
    if (!s->owed || s->active || !isfinite(now)) return;
    s->active = 1; s->remaining = QEV_RECENTER_TICKS; s->deadline = now + QEV_RECENTER_SECONDS;
}
void Qev_RecenterCommand(qev_recenter_t *s, int targeted, int explicit_pitch, double now) {
    if (targeted) Qev_RecenterSuspend(s); /* A new target has priority, without an intervening dip. */
    else if (explicit_pitch) Qev_RecenterForget(s); /* Never undo an explicit look-up/down command. */
    else Qev_RecenterRelease(s, now); /* Includes an ordinary move/turn/raw attack/wait. */
}
float Qev_RecenterStep(qev_recenter_t *s, float pitch, float dt, double now) {
    if (!s->active) return pitch;
    if (!isfinite(pitch) || !isfinite(dt) || dt <= 0 || !isfinite(now) || now >= s->deadline || s->remaining <= 0) {
        Qev_RecenterSuspend(s); return pitch;
    }
    /* At most one 60-Hz tick's angular step, even if an invalid large dt is passed. */
    float step = QEV_RECENTER_RATE * fminf(dt, 1.0f / 60.0f);
    float next = fabsf(pitch) <= step ? 0 : pitch - copysignf(step, pitch);
    s->remaining--;
    if (next != pitch && s->ticks < UINT_MAX) s->ticks++;
    if (next == 0) Qev_RecenterForget(s);
    else if (!s->remaining) Qev_RecenterSuspend(s);
    return next;
}
