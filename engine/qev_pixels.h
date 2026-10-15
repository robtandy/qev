/* SPDX-License-Identifier: GPL-2.0-or-later
 * qev visible-pixel attribution/reduction. No world coordinates or depth inputs.
 * Tags are renderer-private; only visible 2D measurements leave this module.
 */
#ifndef qev_PIXELS_H
#define qev_PIXELS_H
#include <stddef.h>

#define qev_PIXEL_TAGS 1024
#define qev_PIXEL_LIMIT (1280 * 1024)
/* Reserved labels describe only PAINTED surfaces, never tested walking routes. */
#define qev_SURFACE_FIRST 1000
enum { qev_FLOOR, qev_WALL, qev_CEILING, qev_SLOPE, qev_SKY, qev_WATER, qev_LAVA, qev_SLIME, qev_SURFACES };
typedef struct {
    int count, left, top, right, bottom, at_aim, clipped, aim_x, aim_y;
} qev_pixel_object_t;
typedef struct {
    int valid, x, y, width, height, distorted;
    qev_pixel_object_t objects[qev_PIXEL_TAGS];
    int scene[9][qev_SURFACES]; /* upper/middle/lower × left/center/right pixel counts */
} qev_pixel_view_t;

extern int qev_pixel_capture;
void qev_PixelsReset(void);
int qev_PixelsBegin(const unsigned char *buffer, int stride, int width, int height,
    int x, int y, int view_width, int view_height);
void qev_PixelsTag(int tag);
void qev_PixelsWrite(const unsigned char *dest);
void qev_PixelsSpan(const unsigned char *dest, int count);
int qev_PixelsWarpBegin(const unsigned char *buffer, int stride, int width, int height,
    int x, int y, int view_width, int view_height);
void qev_PixelsWarpCopy(const unsigned char *dest, const unsigned char *source);
void qev_PixelsWarpEnd(void);
void qev_PixelsEnd(void);
const qev_pixel_view_t *qev_PixelsView(void);

/* Avoid calls in unsupported/disabled rendering paths. Writes follow the renderer's
 * ordinary opaque-fragment tests; the reducer never receives a Z value. */
#define qev_PIXEL(dest) do { if (qev_pixel_capture) qev_PixelsWrite(dest); } while (0)
#endif
