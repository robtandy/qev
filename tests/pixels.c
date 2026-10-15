/* SPDX-License-Identifier: GPL-2.0-or-later
 * Native reducer tests; synthetic painted pixels, no Quake/game data or audio.
 */
#include "qev_pixels.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <limits.h>
#include <stdlib.h>

static unsigned char buffer[32 * 24], other[64 * 48];
static void begin(void) { assert(qev_PixelsBegin(buffer, 32, 30, 24, 2, 2, 24, 16)); }
static void rect(int tag, int x, int y, int w, int h) {
    qev_PixelsTag(tag);
    for (int row = y; row < y + h; row++) qev_PixelsSpan(buffer + 32 * row + x, w);
}
static void painted(void) {
    begin(); rect(2, 10, 5, 8, 10); qev_PixelsEnd();
    const qev_pixel_view_t *v = qev_PixelsView(); const qev_pixel_object_t *o = &v->objects[2];
    assert(v->valid && v->x == 2 && v->y == 2 && v->width == 24 && v->height == 16);
    assert(o->count == 80 && o->left == 8 && o->right == 16 && o->top == 3 && o->bottom == 13 && o->at_aim && !o->clipped);
}
static void occlusion(void) {
    begin(); rect(2, 10, 5, 8, 10); rect(0, 10, 5, 8, 5); rect(3, 14, 10, 4, 5); qev_PixelsEnd();
    const qev_pixel_view_t *v = qev_PixelsView();
    assert(v->objects[2].count == 20 && v->objects[2].top == 8 && v->objects[2].right == 12 && !v->objects[2].at_aim);
    assert(v->objects[3].count == 20 && v->objects[3].at_aim);
    begin(); rect(2, 10, 5, 8, 10); rect(0, 10, 5, 8, 10); qev_PixelsEnd();
    assert(!qev_PixelsView()->objects[2].count); /* Completely hidden objects disappear. */
}
static void holes(void) {
    begin(); rect(2, 10, 5, 8, 10); qev_PixelsTag(0); qev_PixelsWrite(buffer + 10 * 32 + 14); qev_PixelsEnd();
    const qev_pixel_object_t *o = &qev_PixelsView()->objects[2];
    assert(o->count == 79 && !o->at_aim && o->left == 8 && o->right == 16);
}
static void aim(void) {
    begin(); rect(2, 10, 5, 8, 10); rect(0, 12, 7, 4, 6); qev_PixelsEnd();
    const qev_pixel_object_t *o = &qev_PixelsView()->objects[2];
    int x = o->aim_x + 2, y = o->aim_y + 2;
    assert(x >= 10 && x < 18 && y >= 5 && y < 15);
    assert(x < 12 || x >= 16 || y < 7 || y >= 13); /* Never aim inside the erased center. */
    assert(!o->at_aim && o->count == 56);
    unsigned char *tall = malloc(qev_PIXEL_LIMIT);
    assert(tall && qev_PixelsBegin(tall, 1, 1, qev_PIXEL_LIMIT, 0, 0, 1, qev_PIXEL_LIMIT));
    qev_PixelsTag(2); qev_PixelsWrite(tall); qev_PixelsWrite(tall + qev_PIXEL_LIMIT - 1); qev_PixelsEnd();
    assert(qev_PixelsView()->objects[2].count == 2); /* Extreme aspect must not overflow distance arithmetic. */
    free(tall);
}
static void scene(void) {
    begin(); rect(qev_SURFACE_FIRST + qev_LAVA, 2, 2, 24, 16);
    rect(qev_SURFACE_FIRST + qev_FLOOR, 2, 13, 8, 5);
    rect(2, 10, 13, 8, 5); rect(0, 18, 13, 8, 5); qev_PixelsEnd();
    const qev_pixel_view_t *v = qev_PixelsView();
    assert(v->scene[6][qev_FLOOR] == 40 && v->scene[6][qev_LAVA] == 0);
    assert(v->scene[7][qev_LAVA] == 0 && v->scene[8][qev_LAVA] == 0);
    assert(v->objects[2].count == 40); /* Actors/weapon/unknown pixels occlude terrain labels too. */
    int lava = 0, floor = 0;
    for (int i = 0; i < 9; i++) { lava += v->scene[i][qev_LAVA]; floor += v->scene[i][qev_FLOOR]; }
    assert(lava == 24*11 && floor == 40);
    begin(); qev_PixelsEnd(); assert(!qev_PixelsView()->scene[6][qev_FLOOR]);
}
static void clipping(void) {
    begin(); rect(2, 0, 0, 30, 24); qev_PixelsEnd();
    const qev_pixel_object_t *o = &qev_PixelsView()->objects[2];
    assert(o->count == 24 * 16 && o->left == 0 && o->right == 24 && o->bottom == 16 && o->clipped);
    begin(); rect(2, 28, 20, 2, 2); qev_PixelsEnd(); assert(!qev_PixelsView()->objects[2].count);
}
static void reset(void) {
    painted(); qev_PixelsReset(); assert(!qev_PixelsView()->valid && !qev_PixelsView()->objects[2].count);
    begin(); qev_PixelsTag(2); qev_PixelsWrite(buffer + 6 * 32 + 6); qev_PixelsWrite(buffer + 6 * 32 + 6); qev_PixelsEnd();
    assert(qev_PixelsView()->objects[2].count == 1); /* Count final pixels, not overdraw. */
    begin(); qev_PixelsEnd(); assert(!qev_PixelsView()->objects[2].count);
}
static void invalid(void) {
    painted();
    assert(!qev_PixelsBegin(NULL, 32, 30, 24, 2, 2, 24, 16));
    assert(!qev_PixelsBegin(buffer, 2, 30, 24, 2, 2, 24, 16));
    assert(!qev_PixelsBegin(buffer, INT_MAX, INT_MAX, INT_MAX, 0, 0, 1, 1));
    assert(!qev_PixelsBegin(buffer, 32, 30, 24, 2, 2, 30, 24));
    assert(!qev_PixelsBegin(buffer, 32, 30, 24, -1, 2, 24, 16));
    assert(!qev_PixelsView()->valid);
    begin(); qev_PixelsTag(2);
    qev_PixelsSpan(buffer + 10 * 32 + 5, -1); qev_PixelsSpan(buffer + 10 * 32 + 5, 28);
    qev_PixelsWrite(buffer + sizeof(buffer)); qev_PixelsWrite(other);
    qev_PixelsTag(qev_PIXEL_TAGS); qev_PixelsWrite(buffer + 10 * 32 + 14);
    qev_PixelsTag(-1); qev_PixelsWrite(buffer + 10 * 32 + 14);
    qev_PixelsEnd(); assert(!qev_PixelsView()->objects[2].count);
}
static void warp(void) {
    begin(); rect(2, 10, 5, 8, 10);
    assert(qev_PixelsWarpBegin(other, 64, 60, 48, 4, 4, 48, 32));
    for (int y = 4; y < 36; y++) for (int x = 4; x < 52; x++)
        qev_PixelsWarpCopy(other + y * 64 + x, buffer + (y / 2) * 32 + x / 2);
    qev_PixelsWarpEnd(); qev_PixelsEnd();
    const qev_pixel_view_t *v = qev_PixelsView(); const qev_pixel_object_t *o = &v->objects[2];
    assert(v->valid && v->distorted && v->width == 48 && v->height == 32);
    assert(o->count == 320 && o->left == 16 && o->top == 6 && o->right == 32 && o->bottom == 26 && o->at_aim);
    begin(); assert(qev_PixelsWarpBegin(other, 64, 60, 48, 4, 4, 48, 32)); qev_PixelsEnd();
    assert(!qev_PixelsView()->valid); /* Interrupted resampling cannot leak an old frame. */
    begin(); assert(!qev_PixelsWarpBegin(other, 1, 60, 48, 4, 4, 48, 32)); assert(!qev_pixel_capture);
}
int main(int argc, char **argv) {
    assert(argc == 2);
    if (!strcmp(argv[1], "painted")) painted();
    else if (!strcmp(argv[1], "occlusion")) occlusion();
    else if (!strcmp(argv[1], "holes")) holes();
    else if (!strcmp(argv[1], "clipping")) clipping();
    else if (!strcmp(argv[1], "aim")) aim();
    else if (!strcmp(argv[1], "scene")) scene();
    else if (!strcmp(argv[1], "reset")) reset();
    else if (!strcmp(argv[1], "invalid")) invalid();
    else if (!strcmp(argv[1], "warp")) warp();
    else return 2;
    puts("PASS"); return 0;
}
