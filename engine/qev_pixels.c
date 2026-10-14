/* SPDX-License-Identifier: GPL-2.0-or-later
 * Qev renderer-labelled visible-pixel measurements. This is NOT RGB-only vision.
 * No engine types, geometry, camera pose, distance or depth-buffer access here.
 */
#include "qev_pixels.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    uintptr_t base;
    size_t bytes, capacity;
    unsigned short *tags;
    int stride, x, y, width, height;
} plane_t;
static plane_t raster, warped;
static qev_pixel_view_t view;
static int drawing_tag, warping;
int qev_pixel_capture;

static int setup(plane_t *p, const unsigned char *buffer, int stride, int width, int height,
    int x, int y, int w, int h) {
    size_t bytes;
    unsigned short *tags;
    if (!buffer || width < 1 || height < 1 || stride < width || x < 0 || y < 0 ||
        w < 1 || h < 1 || w > width || h > height || x > width - w || y > height - h ||
        (size_t)stride > QEV_PIXEL_LIMIT / (size_t)height) return 0;
    bytes = (size_t)stride * height;
    if (bytes > p->capacity) {
        tags = realloc(p->tags, bytes * sizeof(*tags));
        if (!tags) return 0;
        p->tags = tags; p->capacity = bytes;
    }
    p->base = (uintptr_t)buffer; p->bytes = bytes; p->stride = stride;
    p->x = x; p->y = y; p->width = w; p->height = h;
    memset(p->tags, 0, bytes * sizeof(*p->tags));
    return 1;
}
static int offset(const plane_t *p, const unsigned char *address, size_t *out) {
    uintptr_t a = (uintptr_t)address;
    if (a < p->base || a - p->base >= p->bytes) return 0;
    *out = (size_t)(a - p->base); return 1;
}
void Qev_PixelsReset(void) {
    qev_pixel_capture = drawing_tag = warping = 0;
    memset(&view, 0, sizeof(view));
}
int Qev_PixelsBegin(const unsigned char *buffer, int stride, int width, int height,
    int x, int y, int w, int h) {
    Qev_PixelsReset();
    qev_pixel_capture = setup(&raster, buffer, stride, width, height, x, y, w, h);
    return qev_pixel_capture;
}
void Qev_PixelsTag(int tag) { drawing_tag = tag > 0 && tag < QEV_PIXEL_TAGS ? tag : 0; }
void Qev_PixelsWrite(const unsigned char *dest) {
    size_t at;
    if (qev_pixel_capture && !warping && offset(&raster, dest, &at)) raster.tags[at] = (unsigned short)drawing_tag;
}
void Qev_PixelsSpan(const unsigned char *dest, int count) {
    size_t at;
    if (!qev_pixel_capture || warping || count < 1 || !offset(&raster, dest, &at) ||
        (size_t)count > (size_t)raster.stride - at % raster.stride) return;
    if (!drawing_tag) memset(raster.tags + at, 0, (size_t)count * sizeof(*raster.tags));
    else for (int i = 0; i < count; i++) raster.tags[at + i] = (unsigned short)drawing_tag;
}
int Qev_PixelsWarpBegin(const unsigned char *buffer, int stride, int width, int height,
    int x, int y, int w, int h) {
    if (!qev_pixel_capture || warping || !setup(&warped, buffer, stride, width, height, x, y, w, h)) {
        Qev_PixelsReset(); return 0;
    }
    warping = 1; return 1;
}
void Qev_PixelsWarpCopy(const unsigned char *dest, const unsigned char *source) {
    size_t to, from;
    if (qev_pixel_capture && warping && offset(&warped, dest, &to) && offset(&raster, source, &from))
        warped.tags[to] = raster.tags[from];
}
void Qev_PixelsWarpEnd(void) {
    plane_t temp;
    if (!qev_pixel_capture || !warping) return;
    temp = raster; raster = warped; warped = temp;
    warping = 0; view.distorted = 1;
}
void Qev_PixelsEnd(void) {
    if (!qev_pixel_capture || warping) { Qev_PixelsReset(); return; }
    view.x = raster.x; view.y = raster.y; view.width = raster.width; view.height = raster.height;
    for (int y = 0; y < raster.height; y++) for (int x = 0; x < raster.width; x++) {
        int tag = raster.tags[(size_t)(y + raster.y) * raster.stride + x + raster.x];
        qev_pixel_object_t *o;
        if (!tag) continue;
        if (tag >= QEV_SURFACE_FIRST && tag < QEV_SURFACE_FIRST + QEV_SURFACES)
            view.scene[(y * 3 / raster.height) * 3 + x * 3 / raster.width][tag - QEV_SURFACE_FIRST]++;
        o = &view.objects[tag];
        if (!o->count) { o->left = o->right = x; o->top = o->bottom = y; }
        if (x < o->left) o->left = x;
        if (x > o->right) o->right = x;
        if (y < o->top) o->top = y;
        if (y > o->bottom) o->bottom = y;
        o->count++;
        if (x == raster.width / 2 && y == raster.height / 2) o->at_aim = 1;
        if (x == 0 || y == 0 || x == raster.width - 1 || y == raster.height - 1) o->clipped = 1;
    }
    /* Aim at an ACTUALLY VISIBLE pixel nearest the visible bounds' center. A box's
     * center can be a hole/occluder; never aim through that hole using hidden extent.
     * One extra mask pass, independent of actor count. No Z or world coordinates. */
    for (int tag = 1; tag < QEV_SURFACE_FIRST; tag++) view.objects[tag].aim_x = -1;
    for (int y = 0; y < raster.height; y++) for (int x = 0; x < raster.width; x++) {
        int tag = raster.tags[(size_t)(y + raster.y) * raster.stride + x + raster.x];
        if (!tag || tag >= QEV_SURFACE_FIRST) continue;
        qev_pixel_object_t *o = &view.objects[tag];
        int64_t dx = 2*(int64_t)x - o->left - o->right, dy = 2*(int64_t)y - o->top - o->bottom;
        int64_t ox = 2*(int64_t)o->aim_x - o->left - o->right, oy = 2*(int64_t)o->aim_y - o->top - o->bottom;
        if (o->aim_x < 0 || dx*dx + dy*dy < ox*ox + oy*oy) { o->aim_x = x; o->aim_y = y; }
    }
    /* Inclusive raster indices become exclusive rectangle edges. No hidden full box. */
    for (int tag = 1; tag < QEV_PIXEL_TAGS; tag++) if (view.objects[tag].count) {
        view.objects[tag].right++; view.objects[tag].bottom++;
    }
    view.valid = 1; qev_pixel_capture = 0;
}
const qev_pixel_view_t *Qev_PixelsView(void) { return &view; }
