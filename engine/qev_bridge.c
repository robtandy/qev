/* SPDX-License-Identifier: GPL-2.0-or-later
 * qev's single visible-assisted controller. No game data is embedded.
 * Labels are renderer/mixer-assisted, NOT RGB/audio recognition. Approved
 * visible-only distance selection is controller assistance, not a model input.
 * No route/LOS probes, hidden health, AI goals, or through-wall tracking.
 */
#include "quakedef.h"
#include "d_local.h"
#include "qev_recenter.h"
#include "qev_nearest.h"
#include <stdint.h>
#include <limits.h>
#include <emscripten/emscripten.h>
#include <SDL.h>
#include <ctype.h>

#define qev_DT (1.0 / 60.0)
/* Normal Quake run input; SV_MaxSpeed still clamps movement normally. */
#define qev_SPEED 400.0f
#define qev_TURN 180.0f
#define qev_AIM_TURN 720.0f
#define qev_MAX_SEEN 6
#define qev_LIVE_TICKS 45
#define qev_MAX_AGE 60
static int epoch = 1, tick = 0, paused = 1, owned = 1, booting = 1;
static int remaining, lease, selected_ref, firing, jumping, selected_weapon, melee_approach;
static int control_session, action_serial, action_ticks, weapon_presses, melee_approach_ticks;
static int body_moving, motion_requested, no_movement_ticks;
static qev_recenter_t view_recovery;
static float input_forward, input_side, input_up, input_yaw_rate, input_pitch_rate;
static float speed_scale = 1;
static double last_wall, accumulator, lease_deadline;
static const char *stop_reason;
static char json[65536];
static size_t used;
static int view_tick = -1, view_frame, next_ref;
static const char *view_reason = "No rendered frame";
static const char *view_kinds[MAX_EDICTS], *view_poses[MAX_EDICTS];
static unsigned char view_known[MAX_EDICTS], view_groups[MAX_EDICTS];
/* Opaque references last ONLY through uninterrupted visible frames. Never export
 * entity slots/generations; never reacquire a lost target behind a wall. */
static int view_refs[MAX_EDICTS];
static int view_nearest[2]; /* Current rendered nearest pickup / active enemy only. */
static int audio_access;
typedef struct { const char *kind; int direction, loudness, tick; } heard_t;
static heard_t heard[8];
static int heard_count;
#ifdef qev_EVALUATION
/* Test-build only. Aggregate movement evidence is never part of qev_snapshot,
 * model requests, candidate construction or execution. No coordinates exported. */
static double eval_distance, eval_displacement;
static int eval_move_ticks, eval_attack_ticks, eval_motion_requested, eval_anchor_valid;
static vec3_t eval_anchor;
#endif
extern float scr_centertime_off;
extern qboolean sb_showscores, scr_drawloading, scr_drawdialog;
extern cvar_t lcd_x;
_Static_assert(MAX_EDICTS < qev_SURFACE_FIRST, "Entity and surface pixel tags must not overlap");

static int ready(void) {
    return host_initialized && sv.active && svs.maxclients == 1 && cls.state == ca_connected &&
        cls.signon == SIGNONS && cl.movemessages >= 2 && sv.num_edicts > 1;
}
static edict_t *player(void) { return EDICT_NUM(1); }
static float length3(vec3_t v) { return sqrtf(DotProduct(v, v)); }
static float clampf(float x, float lo, float hi) { return x < lo ? lo : x > hi ? hi : x; }
static void append(const char *format, ...) {
    int n; va_list args;
    if (used >= sizeof(json) - 1) return;
    va_start(args, format); n = vsnprintf(json + used, sizeof(json) - used, format, args); va_end(args);
    if (n > 0) used += (size_t)n < sizeof(json) - used ? (size_t)n : sizeof(json) - used - 1;
}
static void quoted(const char *s) {
    const unsigned char *p = (const unsigned char *)s;
    append("\"");
    for (; *p; p++) {
        if (*p == '"' || *p == '\\') append("\\%c", *p);
        else if (*p < 32 || *p >= 127) append("\\u%04x", *p);
        else append("%c", *p);
    }
    append("\"");
}
/* Standard Quake sends ACTIVEWEAPON as one byte: IT_AXE (4096) arrives
 * as 0, while inventory uses the full bitmask. Normalize the observed HUD once
 * for display, switch suppression AND melee engagement. Never read server gear. */
static int active_weapon(void) {
    int value = cl.stats[STAT_ACTIVEWEAPON];
    return standard_quake && value == 0 && (cl.items & IT_AXE) ? IT_AXE : value;
}
static const char *weapon_name(int weapon) {
    switch (weapon) {
        case IT_AXE: return "axe";
        case IT_SHOTGUN: return "shotgun"; case IT_SUPER_SHOTGUN: return "double shotgun";
        case IT_NAILGUN: return "nailgun"; case IT_SUPER_NAILGUN: return "super nailgun";
        case IT_GRENADE_LAUNCHER: return "grenade launcher"; case IT_ROCKET_LAUNCHER: return "rocket launcher";
        case IT_LIGHTNING: return "lightning"; default: return "unknown";
    }
}
static const int weapons[] = {IT_AXE, IT_SHOTGUN, IT_SUPER_SHOTGUN, IT_NAILGUN, IT_SUPER_NAILGUN,
    IT_GRENADE_LAUNCHER, IT_ROCKET_LAUNCHER, IT_LIGHTNING};
/* Asset metadata cache, NOT an actor/identity cache. Qwasm has 256 model slots.
 * Re-loading a slot replaces even a formerly recognized annotation with NULL.
 * Keep it across levels: alias assets may remain cached without another load. */
static struct { model_t *asset; const qev_animation_model_t *labels; } animation_assets[256];
static int animation_asset_count;
void qev_AliasModel(model_t *asset, const void *bytes, int length) {
    int slot = 0;
    while (slot < animation_asset_count && animation_assets[slot].asset != asset) slot++;
    if (slot == 256) return;
    if (slot == animation_asset_count) animation_asset_count++;
    animation_assets[slot].asset = asset;
    animation_assets[slot].labels = length > 0 ? qev_AnimationModel(bytes, (size_t)length, asset->numframes) : NULL;
}
/* Animation labels describe the CURRENT rendered pose, never the server's next
 * attack, cooldown, enemy health or intent. Known assets have fingerprinted
 * annotations; meaningful MDL names are a fallback. Generic names abstain. */
static const char *pose(entity_t *entity) {
    aliashdr_t *header;
    if (!entity->model || entity->model->type != mod_alias || entity->frame < 0 || entity->frame >= entity->model->numframes) return "unknown";
    header = Mod_Extradata(entity->model);
    /* The loader stores a group's LAST subframe name, not necessarily the one
     * drawn now. Never use it to claim that the current appearance is a corpse. */
    if (header->frames[entity->frame].type != ALIAS_SINGLE) return "unknown";
    for (int i = 0; i < animation_asset_count; i++) if (animation_assets[i].asset == entity->model && animation_assets[i].labels)
        return qev_AnimationPose(animation_assets[i].labels, entity->frame);
    return qev_NamedAnimation(header->frames[entity->frame].name);
}
static const char *entity_kind(edict_t *e, int *group) {
    const char *name = pr_strings + e->v.classname;
    *group = 0;
    if (!strncmp(name, "monster_", 8)) { *group = 1; return name; }
    if (!strncmp(name, "item_health", 11)) return ((int)e->v.spawnflags & 2) ? "mega_health" : "health";
    if (!strncmp(name, "item_armor", 10)) return "armor";
    if (!strcmp(name, "item_key1")) return "silver_key";
    if (!strcmp(name, "item_key2")) return "gold_key";
    if (!strncmp(name, "item_", 5) || !strncmp(name, "weapon_", 7)) return name;
    *group = 2;
    /* Do not reveal brush interaction classes: a plain-looking wall must not
     * become a known door/button just because the server knows what it does. */
    if (!strcmp(name, "missile") || !strcmp(name, "grenade") || strstr(name, "spike") || strstr(name, "fireball")) return "projectile";
    return NULL;
}
static int view_available(void) {
    return qev_PixelsView()->valid && view_tick == tick && key_dest == key_game && !cl.intermission &&
        scr_con_current <= 0 && scr_centertime_off <= 0 && !sb_showscores && !cl.paused && !scr_drawloading && !scr_drawdialog;
}
EMSCRIPTEN_KEEPALIVE int qev_screen_version(void) { return 4; }
EMSCRIPTEN_KEEPALIVE int qev_control_version(void) { return 8; }
EMSCRIPTEN_KEEPALIVE void qev_audio_access(int enabled) { audio_access = enabled == 1; }
void qev_BeginView(int unsupported) {
    qev_PixelsReset(); view_tick = -1; memset(view_nearest, 0, sizeof(view_nearest));
    memset(view_known, 0, sizeof(view_known)); memset(view_kinds, 0, sizeof(view_kinds));
    if (!ready() || cl.intermission) { view_reason = "No active player view"; goto unavailable; }
    if (unsupported || lcd_x.value) { view_reason = "Unsupported debug render"; goto unavailable; }
    if (!qev_PixelsBegin(d_viewbuffer, screenwidth, r_dowarp ? WARP_WIDTH : vid.width,
        r_dowarp ? WARP_HEIGHT : vid.height, r_refdef.vrect.x, r_refdef.vrect.y,
        r_refdef.vrect.width, r_refdef.vrect.height)) { view_reason = "Invalid pixel buffer"; goto unavailable; }
    view_reason = NULL; return;
unavailable:
    memset(view_refs, 0, sizeof(view_refs));
}
/* Engine kind labels are a disclosed concession. Only the rendered model is
 * classified, then FINAL pixels decide whether any label/reference is observable.
 * No corpse filtering from server health/deadflag, no server animation/position. */
void qev_DrawEntity(entity_t *entity) {
    uintptr_t address = (uintptr_t)entity, base = (uintptr_t)cl_entities;
    int slot, group;
    edict_t *e;
    qev_PixelsTag(0);
    if (!qev_pixel_capture || address < base || address - base >= sizeof(cl_entities) || (address - base) % sizeof(*cl_entities)) return;
    slot = (int)((address - base) / sizeof(*cl_entities));
    if (slot <= 1 || slot >= sv.num_edicts) return;
    if (!view_known[slot]) {
        view_known[slot] = 1; e = EDICT_NUM(slot);
        if (!e->free && entity->model && !strcmp(entity->model->name, pr_strings + e->v.model)) {
            view_kinds[slot] = entity_kind(e, &group); view_groups[slot] = group; view_poses[slot] = pose(entity);
        }
    }
    if (view_kinds[slot]) qev_PixelsTag(slot);
}
void qev_DrawSurface(msurface_t *surface, entity_t *entity) {
    int kind;
    const char *texture;
    qev_DrawEntity(entity);
    if (!qev_pixel_capture || !surface) return;
    /* Retain a visible brush object's label rather than overwriting it as a wall. */
    if (entity && entity != &cl_entities[0]) {
        uintptr_t a = (uintptr_t)entity, b = (uintptr_t)cl_entities;
        if (a >= b && a-b < sizeof(cl_entities) && (a-b)%sizeof(*cl_entities)==0 && view_kinds[(a-b)/sizeof(*cl_entities)]) return;
    }
    if (surface->flags & SURF_DRAWSKY) kind = qev_SKY;
    else if (surface->flags & SURF_DRAWTURB) {
        texture = surface->texinfo->texture->name;
        kind = strstr(texture, "lava") ? qev_LAVA : strstr(texture, "slime") ? qev_SLIME : qev_WATER;
    } else {
        /* Descriptive surface orientation, NOT a collision/traversability test. */
        float up = surface->plane->normal[2] * ((surface->flags & SURF_PLANEBACK) ? -1 : 1);
        kind = up > 0.95f ? qev_FLOOR : up < -0.95f ? qev_CEILING : fabsf(up) < 0.1f ? qev_WALL : qev_SLOPE;
    }
    qev_PixelsTag(qev_SURFACE_FIRST + kind);
}
void qev_EndView(void) {
    if (!qev_pixel_capture) return;
    qev_PixelsEnd();
    const qev_pixel_view_t *v = qev_PixelsView();
    if (v->valid) {
        view_tick = tick + 1; view_frame++;
        int covered = key_dest != key_game || scr_con_current > 0 || scr_centertime_off > 0 || sb_showscores || cl.paused || scr_drawloading || scr_drawdialog;
        qev_nearest_t nearest[2]; qev_NearestReset(&nearest[0]); qev_NearestReset(&nearest[1]);
        for (int i = 2; i < MAX_EDICTS; i++) {
            if (covered || !view_kinds[i] || !v->objects[i].count) { view_refs[i] = 0; continue; }
            if (!view_refs[i]) { if (next_ref == INT_MAX) next_ref = 0; view_refs[i] = ++next_ref; }
            int group = view_groups[i];
            if (group > 1 || (group == 1 && qev_FallenAnimation(view_poses[i]))) continue;
            /* Read CURRENT client/render placement only AFTER final visible pixels
             * are confirmed. Brush model bounds can be offset from their origin.
             * This is model-center distance, not a route, contact or hit test. */
            entity_t *entity = &cl_entities[i]; vec3_t center;
            if (!entity->model) continue;
            for (int axis = 0; axis < 3; axis++)
                center[axis] = entity->origin[axis] + (entity->model->mins[axis] + entity->model->maxs[axis]) * 0.5f;
            qev_NearestConsider(&nearest[group], i, 1, r_refdef.vieworg, center);
        }
        view_nearest[0] = nearest[0].slot; view_nearest[1] = nearest[1].slot;
    } else { view_reason = "Incomplete pixel frame"; memset(view_refs, 0, sizeof(view_refs)); }
}
static const qev_pixel_object_t *contact(int ref) {
    if (ref <= 0 || !view_available()) return NULL;
    for (int i = 2; i < MAX_EDICTS; i++) if (view_refs[i] == ref && qev_PixelsView()->objects[i].count) return &qev_PixelsView()->objects[i];
    return NULL;
}
static int enemy_contact(int ref) {
    if (ref <= 0 || !view_available()) return 0;
    for (int i = 2; i < MAX_EDICTS; i++) if (view_refs[i] == ref && qev_PixelsView()->objects[i].count)
        return view_groups[i] == 1;
    return 0;
}
/* Only current visible animation evidence can complete an enemy-attack goal.
 * This is not a server deadflag/health test and never substitutes another target. */
static int fallen_contact(int ref) {
    if (ref <= 0 || !view_available()) return 0;
    for (int i = 2; i < MAX_EDICTS; i++) if (view_refs[i] == ref && qev_PixelsView()->objects[i].count)
        return view_groups[i] == 1 && qev_FallenAnimation(view_poses[i]);
    return 0;
}
/* Called only for nonzero, spatialized PCM samples actually fed to the running
 * mixer. Input is sound identity + channel amplitudes; NO origin/entity/distance.
 * Stereo cannot distinguish front/back, so neither can these captions. */
void qev_AudibleSound(const char *name, int left, int right) {
    const char *kind = "sound";
    int direction, loudness, n;
    if (!audio_access || !ready() || booting || (paused && remaining == 0) || volume.value <= 0 || snd_blocked || !name) return;
    left = (int)(left * clampf(volume.value, 0, 1)); right = (int)(right * clampf(volume.value, 0, 1));
    if (left < 48 && right < 48) return;
    if (strstr(name, "weapons/")) kind = "weapon";
    else if (strstr(name, "doors/") || strstr(name, "plats/")) kind = "mechanism";
    else if (strstr(name, "items/")) kind = "pickup";
    else if (strstr(name, "player/") || strstr(name, "hknight/pain")) kind = "hurt_or_movement";
    else if (strstr(name, "ambience/")) kind = "ambience";
    else if (strstr(name, "water") || strstr(name, "splash")) kind = "water";
    else if (strchr(name, '/')) kind = "creature_or_effect";
    direction = left > right * 1.3f ? -1 : right > left * 1.3f ? 1 : 0;
    loudness = left > 2048 || right > 2048;
    /* At most one recent caption per kind/pan. Not an enemy counter/identity. */
    for (n = 0; n < heard_count; n++) if (heard[n].kind == kind && heard[n].direction == direction) break;
    if (n == heard_count && heard_count < 8) heard_count++;
    if (n >= 8) n = 7;
    for (int i = n; i > 0; i--) heard[i] = heard[i-1];
    heard[0] = (heard_t){kind, direction, loudness, tick + 1};
}
static void clear_action(void) {
    lease = 0; lease_deadline = 0; selected_ref = firing = jumping = selected_weapon = melee_approach = 0;
    input_forward = input_side = input_up = input_yaw_rate = input_pitch_rate = 0;
    qev_ClearKeys();
}
static void cancel_action(const char *reason) {
    if (selected_ref || input_pitch_rate != 0) qev_RecenterRelease(&view_recovery, Sys_FloatTime());
    clear_action(); remaining = 0; stop_reason = reason;
}
static void audio_pause(int stop) { if (SDL_WasInit(SDL_INIT_AUDIO)) SDL_PauseAudio(stop); }
void qev_WorldChanged(void) {
    epoch++; control_session++; tick = 0; paused = owned = booting = 1;
    remaining = 0; accumulator = 0; stop_reason = NULL; heard_count = 0;
    body_moving = motion_requested = no_movement_ticks = 0;
    qev_RecenterReset(&view_recovery);
#ifdef qev_EVALUATION
    eval_distance = eval_displacement = 0;
    eval_move_ticks = eval_attack_ticks = eval_motion_requested = eval_anchor_valid = 0;
#endif
    memset(view_refs, 0, sizeof(view_refs)); memset(view_nearest, 0, sizeof(view_nearest));
    qev_PixelsReset(); view_tick = -1; view_reason = "World changed; awaiting rendered frame";
    clear_action(); audio_pause(1);
}
void qev_EntityFreed(edict_t *e) {
    int slot = NUM_FOR_EDICT(e);
    if (slot >= 0 && slot < MAX_EDICTS) view_refs[slot] = 0;
}
int qev_OwnsInput(void) { return owned; }
void qev_PreRender(void) {
    if (owned && cls.signon == SIGNONS) { scr_con_current = 0; Con_ClearNotify(); }
}
static void screen_objects_json(const qev_pixel_view_t *v, int group, int available) {
    int selected[qev_MAX_SEEN], count = 0, total = 0, i, j, pos;
    int nearest = group < 2 ? view_nearest[group] : 0;
    if (available) for (i = 2; i < MAX_EDICTS; i++) {
        if (!view_kinds[i] || view_groups[i] != group || !v->objects[i].count || !view_refs[i]) continue;
        total++; pos = 0;
        /* Include the automatic target even if tiny; retain coverage ordering
         * for the remaining slots. Never silently choose an omitted object. */
        while (pos < count && i != nearest && (selected[pos] == nearest || v->objects[selected[pos]].count >= v->objects[i].count)) pos++;
        if (pos >= qev_MAX_SEEN) continue;
        if (count < qev_MAX_SEEN) count++;
        for (j = count - 1; j > pos; j--) selected[j] = selected[j-1];
        selected[pos] = i;
    }
    append("[");
    for (i = 0; i < count; i++) {
        int slot = selected[i], same_kind = 0;
        const qev_pixel_object_t *o = &v->objects[slot];
        for (j = 2; j < MAX_EDICTS; j++) if (view_kinds[j] && v->objects[j].count && !strcmp(view_kinds[j], view_kinds[slot])) same_kind++;
        if (i) append(",");
        append("{\"ref\":%d,\"kind\":", view_refs[slot]); quoted(view_kinds[slot]);
        append(",\"pose\":"); quoted(view_poses[slot] ? view_poses[slot] : "unknown");
        append(",\"nearest\":%s", slot == nearest ? "true" : "false");
        append(",\"visible\":true,\"screen\":{\"bounds\":[%.4f,%.4f,%.4f,%.4f],\"pixels\":%d,\"aimOverlap\":%s,\"clipped\":%s,\"sameKindCount\":%d}}",
            (double)o->left/v->width, (double)o->top/v->height, (double)o->right/v->width, (double)o->bottom/v->height,
            o->count, o->at_aim ? "true" : "false", o->clipped ? "true" : "false", same_kind);
    }
    append("],\"%sOmitted\":%d", group == 1 ? "enemies" : group == 0 ? "pickups" : "features", total-count);
}
static void screen_json(void) {
    const qev_pixel_view_t *v = qev_PixelsView();
    const char *reason = view_reason;
    int available = view_available();
    if (!available && !reason) reason = view_tick != tick ? "Awaiting current rendered frame" : "Player view covered";
    append(",\"screen\":{\"source\":\"renderer-visible-pixels\",\"available\":%s,\"frame\":%d,\"tick\":%d,\"distorted\":%s,\"viewport\":[%d,%d,%d,%d],\"reason\":",
        available ? "true" : "false", view_frame, view_tick, v->distorted ? "true" : "false", v->x, v->y, v->width, v->height);
    if (available) append("null"); else quoted(reason ? reason : "No rendered frame");
    append("},\"scene\":[");
    for (int cell = 0; available && cell < 9; cell++) {
        if (cell) append(","); append("[");
        for (int s = 0; s < qev_SURFACES; s++) { if (s) append(","); append("%d", v->scene[cell][s]); }
        append("]");
    }
    append("],\"enemies\":"); screen_objects_json(v, 1, available);
    append(",\"pickups\":"); screen_objects_json(v, 0, available);
    append(",\"features\":"); screen_objects_json(v, 2, available);
}
EMSCRIPTEN_KEEPALIVE const char *qev_snapshot(void) {
    used = 0;
    append("{\"version\":5,\"controlMode\":\"visible-assisted\",\"epoch\":%d,\"tick\":%d,\"ready\":%s,\"paused\":%s,\"remaining\":%d,\"owned\":%s",
        epoch, tick, ready() ? "true" : "false", paused ? "true" : "false", remaining, owned ? "true" : "false");
    append(",\"controlSession\":%d,\"actionSerial\":%d,\"actionTicks\":%d,\"actionTicksLeft\":%d,\"weaponPresses\":%d,\"meleeApproachTicks\":%d,\"stopReason\":", control_session, action_serial, action_ticks, lease, weapon_presses, melee_approach_ticks);
    if (stop_reason) quoted(stop_reason); else append("null");
    /* Own-camera execution feedback, not an angle/heading or a target range. */
    append(",\"viewRecovery\":{\"active\":%s,\"level\":%s,\"ticks\":%u}", view_recovery.active ? "true" : "false",
        fabsf(cl.viewangles[PITCH]) < 0.001f ? "true" : "false", view_recovery.ticks);
    if (!ready()) { append("}"); return json; }
    append(",\"map\":"); quoted(sv.name); append(",\"difficulty\":%d", current_skill);
    append(",\"alive\":%s,\"completed\":%s,\"player\":{\"health\":%d,\"armor\":%d,\"ammo\":%d,\"weapon\":",
        player()->v.health > 0 ? "true" : "false", cl.intermission ? "true" : "false", cl.stats[STAT_HEALTH], cl.stats[STAT_ARMOR], cl.stats[STAT_AMMO]);
    quoted(weapon_name(active_weapon()));
    append(",\"kills\":%d,\"secrets\":%d,\"moving\":%s,\"noMovementTicks\":%d", cl.stats[STAT_MONSTERS], cl.stats[STAT_SECRETS], body_moving ? "true" : "false", no_movement_ticks);
    append(",\"shells\":%d,\"nails\":%d,\"rockets\":%d,\"cells\":%d,\"grounded\":%s,\"inWater\":%s,\"silverKey\":%s,\"goldKey\":%s,\"weapons\":[",
        cl.stats[STAT_SHELLS], cl.stats[STAT_NAILS], cl.stats[STAT_ROCKETS], cl.stats[STAT_CELLS], cl.onground ? "true" : "false",
        cl.inwater ? "true" : "false", cl.items & IT_KEY1 ? "true" : "false", cl.items & IT_KEY2 ? "true" : "false");
    int comma = 0;
    for (int i = 0; i < 8; i++) if (cl.items & weapons[i]) {
        if (comma++) append(","); append("{\"id\":%d,\"name\":", i+1); quoted(weapon_name(weapons[i])); append("}");
    }
    append("],\"powerups\":{\"quad\":%s,\"invulnerable\":%s,\"invisible\":%s,\"suit\":%s}}",
        cl.items & IT_QUAD ? "true" : "false", cl.items & IT_INVULNERABILITY ? "true" : "false", cl.items & IT_INVISIBILITY ? "true" : "false", cl.items & IT_SUIT ? "true" : "false");
    screen_json();
    append(",\"audio\":{\"source\":\"mixed-sound-captions\",\"available\":%s,\"events\":[", audio_access && volume.value > 0 && !snd_blocked ? "true" : "false");
    comma = 0;
    for (int i = 0; i < heard_count && comma < 4; i++) if (tick >= heard[i].tick && tick-heard[i].tick <= 120) {
        if (comma++) append(","); append("{\"kind\":"); quoted(heard[i].kind);
        append(",\"direction\":"); quoted(heard[i].direction < 0 ? "left" : heard[i].direction > 0 ? "right" : "center");
        append(",\"loudness\":\"%s\",\"ageTicks\":%d}", heard[i].loudness ? "clear" : "quiet", tick-heard[i].tick);
    }
    append("]}}"); return json;
}
#ifdef qev_EVALUATION
EMSCRIPTEN_KEEPALIVE const char *qev_evaluation(void) {
    static char report[256];
    snprintf(report, sizeof(report), "{\"testOnly\":true,\"distance\":%.2f,\"maxDisplacement\":%.2f,\"movingTicks\":%d,\"attackTicks\":%d}",
        eval_distance, eval_displacement, eval_move_ticks, eval_attack_ticks);
    return report;
}
static void evaluation_frame(vec3_t before) {
    vec3_t delta, from_start;
    VectorSubtract(player()->v.origin, before, delta);
    if (!eval_anchor_valid || length3(delta) > 128) { VectorCopy(before, eval_anchor); eval_anchor_valid = 1; }
    if (length3(delta) > 128) { VectorCopy(player()->v.origin, eval_anchor); return; }
    double travel = sqrt(delta[0]*delta[0] + delta[1]*delta[1]);
    VectorSubtract(player()->v.origin, eval_anchor, from_start);
    double displacement = sqrt(from_start[0]*from_start[0] + from_start[1]*from_start[1]);
    eval_distance += travel; if (displacement > eval_displacement) eval_displacement = displacement;
    if (eval_motion_requested && travel > 0.1) eval_move_ticks++;
}
#endif
EMSCRIPTEN_KEEPALIVE void qev_pause(void) {
    if (remaining > 0 || lease > 0) stop_reason = "Interrupted by Pause.";
    control_session++; paused = owned = 1; remaining = 0; accumulator = 0; clear_action();
    qev_RecenterSuspend(&view_recovery); audio_pause(1);
}
EMSCRIPTEN_KEEPALIVE int qev_play(void) {
    if (!ready()) return 0;
    control_session++; clear_action(); remaining = 0; owned = paused = 0; accumulator = 0; stop_reason = NULL;
    qev_RecenterForget(&view_recovery);
    key_dest = key_game; Cbuf_AddText("+mlook\n"); audio_pause(0); return 1;
}
EMSCRIPTEN_KEEPALIVE int qev_speed(float scale) {
    if (!isfinite(scale) || scale < 0.05f || scale > 1) return 0;
    speed_scale = scale; accumulator = 0; return 1;
}
/* Structural bounds and observability only. No tactical veto, ammo check, hazard
 * check, speculative collision or automatic alternative. Normal physics decides. */
static int set_command(int ref, float forward, float side, float up, float yaw_rate, float pitch_rate, int attack, int jump, int weapon, int ticks, int approach_melee) {
    if (!ready() || player()->v.health <= 0 || cl.intermission || ticks < 1 || ticks > qev_LIVE_TICKS || ref < 0 ||
        !isfinite(forward) || !isfinite(side) || !isfinite(up) || !isfinite(yaw_rate) || !isfinite(pitch_rate) ||
        forward*forward + side*side > 1.001f || fabsf(up) > 1 || fabsf(yaw_rate) > qev_TURN || fabsf(pitch_rate) > qev_TURN ||
        (attack != 0 && attack != 1) || (jump != 0 && jump != 1) || weapon < 0 || weapon > 8 ||
        (approach_melee != 0 && approach_melee != 1)) return 0;
    if ((ref && (!contact(ref) || (attack && fallen_contact(ref)))) || (weapon && !(cl.items & weapons[weapon-1]))) return 0;
    /* The declared engage goal is enemy-directed attack + conditional advance,
     * never an ambiguous blend with a contradictory raw movement/look command. */
    if (approach_melee && (!enemy_contact(ref) || !attack || forward || side || up || yaw_rate || pitch_rate || jump)) return 0;
    clear_action(); stop_reason = NULL;
    selected_ref = ref; input_forward = forward; input_side = side; input_up = up;
    input_yaw_rate = yaw_rate; input_pitch_rate = pitch_rate; firing = attack; jumping = jump; selected_weapon = weapon;
    melee_approach = approach_melee;
    qev_RecenterCommand(&view_recovery, ref != 0, pitch_rate != 0, Sys_FloatTime());
    lease = ticks; action_serial++; action_ticks = weapon_presses = melee_approach_ticks = 0; key_dest = key_game; return 1;
}
EMSCRIPTEN_KEEPALIVE int qev_command(int expected_epoch, int expected_tick, int ref, float forward, float side, float up,
    float yaw_rate, float pitch_rate, int attack, int jump, int weapon, int ticks, int approach_melee) {
    if (!paused || remaining || epoch != expected_epoch || tick != expected_tick || ticks > 12) return 0;
    if (!set_command(ref, forward, side, up, yaw_rate, pitch_rate, attack, jump, weapon, ticks, approach_melee)) return 0;
    remaining = ticks; owned = paused = 1; accumulator = 0; audio_pause(0); return 1;
}
EMSCRIPTEN_KEEPALIVE int qev_auto(void) {
    if (!ready() || !paused || remaining || player()->v.health <= 0 || cl.intermission) return 0;
    clear_action(); control_session++; owned = 1; paused = 0; remaining = 0;
    accumulator = 0; stop_reason = NULL; key_dest = key_game; audio_pause(0); return control_session;
}
EMSCRIPTEN_KEEPALIVE int qev_live_command(int expected_epoch, int observed_tick, int session, int ref, float forward, float side, float up,
    float yaw_rate, float pitch_rate, int attack, int jump, int weapon, int ticks, int approach_melee) {
    if (paused || !owned || remaining || session != control_session || epoch != expected_epoch || observed_tick < 0 ||
        observed_tick > tick || tick-observed_tick > qev_MAX_AGE) return 0;
    if (!set_command(ref, forward, side, up, yaw_rate, pitch_rate, attack, jump, weapon, ticks, approach_melee)) return 0;
    lease_deadline = Sys_FloatTime() + 1.5; return 1;
}
EMSCRIPTEN_KEEPALIVE int qev_step_frame(int expected_epoch, int expected_tick) {
    if (!ready() || !paused || remaining || epoch != expected_epoch || tick != expected_tick || player()->v.health <= 0 || cl.intermission) return 0;
    clear_action(); qev_RecenterSuspend(&view_recovery);
    stop_reason = NULL; owned = 1; remaining = 1; accumulator = 0; key_dest = key_game; audio_pause(0); return 1;
}
EMSCRIPTEN_KEEPALIVE int qev_new_game(const char *name, int difficulty) {
    char command[112]; size_t i, len;
    if (!host_initialized || !name || difficulty < 0 || difficulty > 3) return 0;
    len = strlen(name); if (len < 1 || len > 40) return 0;
    for (i = 0; i < len; i++) if (!isalnum((unsigned char)name[i]) && name[i] != '_' && name[i] != '-') return 0;
    qev_pause(); booting = 1;
    snprintf(command, sizeof(command), "disconnect\nskill %d\nmap %s\n", difficulty, name); Cbuf_AddText(command); return 1;
}
EMSCRIPTEN_KEEPALIVE int qev_load_map(const char *name) { return qev_new_game(name, current_skill); }
void qev_ApplyInput(usercmd_t *cmd) {
    float dyaw = input_yaw_rate * qev_DT, dpitch = input_pitch_rate * qev_DT;
    int fire = firing;
#ifdef qev_EVALUATION
    eval_motion_requested = 0;
#endif
    qev_Buttons(0, 0, 0);
    if (!ready() || !owned || player()->v.health <= 0 || cl.intermission || (paused && !remaining)) return;
    /* Bounded PITCH-ONLY cleanup after pixel aim or explicit model look releases.
     * No movement/buttons/yaw are retained, no targets are inspected or chosen.
     * Active target/pitch input wins. Stop and frozen Step add no cleanup frames;
     * an ordinary subsequent command can finish. Manual play gives up ownership. */
    if (view_recovery.active && !selected_ref && input_pitch_rate == 0) {
        cl.viewangles[PITCH] = qev_RecenterStep(&view_recovery, cl.viewangles[PITCH], qev_DT, Sys_FloatTime());
        V_StopPitchDrift();
    }
    if (lease <= 0) return;
    if (selected_ref) {
        const qev_pixel_object_t *o = contact(selected_ref);
        const qev_pixel_view_t *v = qev_PixelsView();
        if (!o) { cancel_action("Chosen contact is no longer visible."); return; }
        if (firing && fallen_contact(selected_ref)) { cancel_action("Chosen enemy is visibly dead or dying."); return; }
        /* Image-space servo toward a painted pixel, with camera intrinsics only.
         * No world position, target velocity, LOS/hit test or future interception. */
        dyaw = -atanf((2*(o->aim_x+0.5f)/v->width-1) * tanf(r_refdef.fov_x*M_PI/360)) * 180/M_PI;
        dpitch = atanf((2*(o->aim_y+0.5f)/v->height-1) * tanf(r_refdef.fov_y*M_PI/360)) * 180/M_PI;
        dyaw = clampf(dyaw, -qev_AIM_TURN*qev_DT, qev_AIM_TURN*qev_DT);
        dpitch = clampf(dpitch, -qev_AIM_TURN*qev_DT, qev_AIM_TURN*qev_DT);
        qev_RecenterAimed(&view_recovery);
        fire = firing && o->at_aim; /* A visible center pixel, NOT guaranteed line of fire/hit. */
    } else if (input_pitch_rate != 0) {
        qev_RecenterAimed(&view_recovery); /* A real explicit-look tick owes leveling after release. */
    }
    cl.viewangles[YAW] = anglemod(cl.viewangles[YAW] + dyaw);
    cl.viewangles[PITCH] = clampf(cl.viewangles[PITCH] + dpitch, -70, 80); V_StopPitchDrift();
    /* Only the explicitly selected ENGAGE goal grants this movement. Raw/held
     * attacks stay stationary. Use the actual current HUD weapon, including a
     * switch or ordinary game fallback during the lease. No target-distance,
     * route, collision or damage query: advance along the visible-pixel aim. */
    int melee_forward = melee_approach && active_weapon() == IT_AXE;
    cmd->forwardmove = qev_SPEED * (melee_forward ? 1 : input_forward);
    cmd->sidemove = qev_SPEED * input_side; cmd->upmove = qev_SPEED * input_up;
    if (melee_forward) melee_approach_ticks++;
    /* Equipment accompanies movement/aim, never consumes a separate action. Use
     * the CURRENT HUD: an old observation cannot tell us what is equipped now.
     * Do not spam the held weapon or retry a declined switch within a command.
     * A weapon choice is a keypress request, not a promise the game will equip it.
     * Suppress attack during that press only; thereafter normal Quake weapon
     * refusal/fallback rules apply. Never deadlock a chosen attack waiting for an
     * empty/unavailable gun. No code-level best-weapon picker or ammo veto. */
    int needs_weapon = selected_weapon && active_weapon() != weapons[selected_weapon-1];
    int impulse = action_ticks == 0 && needs_weapon ? selected_weapon : 0;
    if (impulse) fire = 0;
    if (impulse) weapon_presses++;
    qev_Buttons(fire, jumping && action_ticks == 0, impulse);
    motion_requested = melee_forward || input_forward != 0 || input_side != 0 || input_up != 0;
#ifdef qev_EVALUATION
    eval_motion_requested = motion_requested;
    if (fire) eval_attack_ticks++;
#endif
    action_ticks++;
}
void qev_MainLoop(void) {
    double wall = Sys_FloatTime(), elapsed = last_wall ? wall-last_wall : 0; int n = 0;
    last_wall = wall;
    if (!paused && owned && lease > 0 && lease_deadline > 0 && wall >= lease_deadline) cancel_action("Action wall-time watchdog expired.");
    if (ready() && !booting && paused && remaining == 0) { accumulator = 0; Sys_SendKeyEvents(); return; }
    accumulator += fmin(fmax(elapsed, 0), 0.1) * (booting ? 1 : speed_scale);
    while (accumulator >= qev_DT && n++ < 6) {
        int before_epoch = epoch, was_ready = ready(); vec3_t before;
        if (was_ready) VectorCopy(player()->v.origin, before);
        accumulator -= qev_DT; if (owned) key_dest = key_game;
        motion_requested = 0;
        Host_Frame(qev_DT); if (!ready()) continue;
        tick++;
        if (booting) { booting = 0; qev_pause(); break; }
        if (epoch != before_epoch) break;
        /* Own-body feedback about actual PAST movement, not a collision probe or
         * route prediction. Never export a position, velocity or distance. */
        if (was_ready) {
            vec3_t movement; VectorSubtract(player()->v.origin, before, movement);
            float travelled = length3(movement);
            body_moving = travelled > 0.05f && travelled <= 128;
            no_movement_ticks = motion_requested && !body_moving ? (no_movement_ticks < 6000 ? no_movement_ticks + 1 : 6000) : 0;
        }
#ifdef qev_EVALUATION
        if (was_ready) evaluation_frame(before);
#endif
        if (player()->v.health <= 0 || cl.intermission) {
            cancel_action(player()->v.health <= 0 ? "Player died." : "Level completed.");
            qev_RecenterForget(&view_recovery); epoch++; qev_pause(); break;
        }
        /* Own displacement also supplies the binary body-motion feedback above.
         * Coordinates/distances never reach model observation or route planning. */
        if (was_ready) { vec3_t delta; VectorSubtract(player()->v.origin, before, delta);
            if (length3(delta) > 128) { cancel_action("Player teleported."); qev_RecenterForget(&view_recovery); epoch++; memset(view_refs, 0, sizeof(view_refs)); qev_pause(); break; }
        }
        if (lease > 0 && --lease == 0) cancel_action("Action lease expired.");
        if (remaining > 0 && --remaining == 0) { qev_pause(); break; }
        if (paused && remaining == 0) { qev_pause(); break; }
    }
}
