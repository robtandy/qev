/* SPDX-License-Identifier: GPL-2.0-or-later
 * qev, 2026: current rendered animation annotations for known LibreQuake assets.
 * Source/provenance: animation-labels.json and docs/weapon-and-death-awareness.md.
 * This module has no engine/world/entity dependency and cannot inspect health,
 * deadflag, nextthink, coordinates, distance or visibility. The renderer applies
 * labels ONLY to its current frame; final painted pixels gate their disclosure.
 */
#include "qev_animation.h"
#include <ctype.h>
#include <string.h>

typedef struct { int first, last; const char *pose; } qev_animation_range_t;
struct qev_animation_model_s {
    uint64_t fingerprint;
    size_t bytes;
    int frames, count;
    const qev_animation_range_t *ranges;
};
#include "qev_animation_data.h"

/* Fast whole-file content identity, not a cryptographic trust boundary. The app
 * separately SHA-256 verifies the pinned demo archives. Names/frame counts alone
 * must never apply these annotations to a different/custom model. */
uint64_t qev_AnimationFingerprint(const void *bytes, size_t length) {
    const unsigned char *p = bytes;
    uint64_t hash = UINT64_C(14695981039346656037);
    if (!p) return 0;
    for (size_t i = 0; i < length; i++) hash = (hash ^ p[i]) * UINT64_C(1099511628211);
    return hash;
}
const qev_animation_model_t *qev_AnimationModel(const void *bytes, size_t length, int frames) {
    uint64_t hash = 0;
    int hashed = 0;
    if (!bytes || !length || frames < 1) return NULL;
    for (size_t i = 0; i < sizeof(known_models) / sizeof(known_models[0]); i++) {
        const qev_animation_model_t *m = &known_models[i];
        if (m->bytes != length || m->frames != frames) continue;
        if (!hashed) { hash = qev_AnimationFingerprint(bytes, length); hashed = 1; }
        if (m->fingerprint == hash) return m;
    }
    return NULL;
}
const char *qev_AnimationPose(const qev_animation_model_t *model, int frame) {
    if (!model || frame < 0 || frame >= model->frames) return "unknown";
    for (int i = 0; i < model->count; i++) {
        const qev_animation_range_t *r = &model->ranges[i];
        if (frame >= r->first && frame <= r->last) return r->pose;
    }
    return "unknown";
}
static int death_sequence(const char *name, const char *prefix) {
    size_t n = strlen(prefix), rest;
    if (strncmp(name, prefix, n)) return 0;
    rest = strlen(name + n);
    return rest == 0 || (rest == 1 && name[n] >= 'a' && name[n] <= 'z');
}
const char *qev_NamedAnimation(const char raw[16]) {
    char name[17];
    size_t n;
    if (!raw) return "unknown";
    for (n = 0; n < 16 && raw[n]; n++) name[n] = (char)tolower((unsigned char)raw[n]);
    name[n] = 0;
    while (n && (isdigit((unsigned char)name[n-1]) || name[n-1] == '_')) name[--n] = 0;
    if (!strcmp(name, "dead")) return "dead";
    /* A named death sequence is dying, not proof of its final corpse frame.
     * Verified asset annotations above distinguish the actual terminal poses. */
    if (death_sequence(name, "death") || death_sequence(name, "bdeath") || death_sequence(name, "die")) return "death";
    if (strstr(name, "pain")) return "hurt";
    if (strstr(name, "attack") || strstr(name, "shoot") || strstr(name, "attak") || strstr(name, "melee")) return "attack";
    if (strstr(name, "run") || strstr(name, "walk")) return "moving";
    if (strstr(name, "stand") || strstr(name, "idle")) return "idle";
    return "unknown";
}
int qev_FallenAnimation(const char *pose) {
    return pose && (!strcmp(pose, "death") || !strcmp(pose, "dead"));
}
