/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef qev_PRESENT_H
#define qev_PRESENT_H
#include <stdint.h>

/* Presentation bookkeeping only. No Quake state, pixels, physics or model data.
 * All Host_Frame calls still run; only redundant SDL uploads can be deferred. */
typedef struct {
    int batching, pending;
    unsigned batch_frames, last_frames, max_frames;
    uint64_t host_frames, presents, deferred, loops, invalid_times;
    double host_ms, present_ms, loop_ms, max_host_ms, max_present_ms, max_loop_ms;
} qev_present_t;
void qev_PresentBegin(qev_present_t *state, int multiple_frames);
int qev_PresentDefer(qev_present_t *state);
int qev_PresentFlush(qev_present_t *state);
void qev_PresentHost(qev_present_t *state, double milliseconds);
void qev_PresentDone(qev_present_t *state, double milliseconds);
void qev_PresentLoop(qev_present_t *state, double milliseconds);
#endif
