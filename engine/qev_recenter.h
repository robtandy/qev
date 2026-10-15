/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef qev_RECENTER_H
#define qev_RECENTER_H

/* Own-camera cleanup only. No engine, entity, target or world access. */
#define qev_RECENTER_RATE 180.0f
#define qev_RECENTER_TICKS 30
#define qev_RECENTER_SECONDS 0.75

typedef struct {
    int owed, active, remaining;
    unsigned int ticks; /* Actual pitch-changing ticks, cumulative within the world. */
    double deadline;
} qev_recenter_t;

void qev_RecenterReset(qev_recenter_t *state);
void qev_RecenterSuspend(qev_recenter_t *state); /* Stop/pause: no input; retain camera ownership. */
void qev_RecenterForget(qev_recenter_t *state); /* Manual play/lifecycle reset: give up ownership. */
void qev_RecenterAimed(qev_recenter_t *state); /* Executed pixel aim or explicit model-pitch tick. */
void qev_RecenterRelease(qev_recenter_t *state, double now);
void qev_RecenterCommand(qev_recenter_t *state, int targeted, int explicit_pitch, double now);
float qev_RecenterStep(qev_recenter_t *state, float pitch, float dt, double now);

#endif
