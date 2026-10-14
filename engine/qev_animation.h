/* SPDX-License-Identifier: GPL-2.0-or-later
 * Qev renderer annotation lookup. Asset bytes/current frame only, never entities.
 */
#ifndef QEV_ANIMATION_H
#define QEV_ANIMATION_H
#include <stddef.h>
#include <stdint.h>
typedef struct qev_animation_model_s qev_animation_model_t;
uint64_t Qev_AnimationFingerprint(const void *bytes, size_t length);
const qev_animation_model_t *Qev_AnimationModel(const void *bytes, size_t length, int frames);
const char *Qev_AnimationPose(const qev_animation_model_t *model, int frame);
/* Input is the engine's fixed-size, possibly unterminated 16-byte MDL name. */
const char *Qev_NamedAnimation(const char name[16]);
int Qev_FallenAnimation(const char *pose);
#endif
