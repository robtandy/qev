/* SPDX-License-Identifier: GPL-2.0-or-later */
#include "qev_present.h"
#include <math.h>

static void elapsed(qev_present_t *s, double ms, double *total, double *maximum) {
    if (!isfinite(ms) || ms < 0 || !isfinite(*total + ms)) { s->invalid_times++; return; }
    *total += ms;
    if (ms > *maximum) *maximum = ms;
}
void qev_PresentBegin(qev_present_t *s, int multiple) {
    s->batching = multiple != 0; s->pending = 0; s->batch_frames = 0;
}
int qev_PresentDefer(qev_present_t *s) {
    if (!s->batching) return 0;
    s->pending = 1; s->deferred++; return 1;
}
int qev_PresentFlush(qev_present_t *s) {
    int pending = s->pending;
    /* Clear BEFORE calling the video driver, so the flush cannot defer itself.
     * Also flush an early exit (Stop/death/world change) after just one frame. */
    s->batching = s->pending = 0;
    return pending;
}
void qev_PresentHost(qev_present_t *s, double ms) {
    s->host_frames++; s->batch_frames++; elapsed(s, ms, &s->host_ms, &s->max_host_ms);
}
void qev_PresentDone(qev_present_t *s, double ms) {
    s->presents++; elapsed(s, ms, &s->present_ms, &s->max_present_ms);
}
void qev_PresentLoop(qev_present_t *s, double ms) {
    s->loops++; s->last_frames = s->batch_frames;
    if (s->last_frames > s->max_frames) s->max_frames = s->last_frames;
    elapsed(s, ms, &s->loop_ms, &s->max_loop_ms);
}
