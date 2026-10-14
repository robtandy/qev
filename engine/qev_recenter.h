/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef QEV_RECENTER_H
#define QEV_RECENTER_H

/* Own-camera cleanup only. No engine, entity, target or world access. */
#define QEV_RECENTER_RATE 180.0f
#define QEV_RECENTER_TICKS 30
#define QEV_RECENTER_SECONDS 0.75

typedef struct {
    int owed, active, remaining;
    unsigned int ticks; /* Actual pitch-changing ticks, cumulative within the world. */
    double deadline;
} qev_recenter_t;

void Qev_RecenterReset(qev_recenter_t *state);
void Qev_RecenterSuspend(qev_recenter_t *state); /* Stop/pause: no input; retain camera ownership. */
void Qev_RecenterForget(qev_recenter_t *state); /* Explicit pitch/manual play: give up ownership. */
void Qev_RecenterAimed(qev_recenter_t *state);
void Qev_RecenterRelease(qev_recenter_t *state, double now);
void Qev_RecenterCommand(qev_recenter_t *state, int targeted, int explicit_pitch, double now);
float Qev_RecenterStep(qev_recenter_t *state, float pitch, float dt, double now);

#endif
