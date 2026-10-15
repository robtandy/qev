/* SPDX-License-Identifier: GPL-2.0-or-later
 * qev renderer annotation lookup. Asset bytes/current frame only, never entities.
 */
#ifndef qev_ANIMATION_H
#define qev_ANIMATION_H
#include <stddef.h>
#include <stdint.h>
typedef struct qev_animation_model_s qev_animation_model_t;
uint64_t qev_AnimationFingerprint(const void *bytes, size_t length);
const qev_animation_model_t *qev_AnimationModel(const void *bytes, size_t length, int frames);
const char *qev_AnimationPose(const qev_animation_model_t *model, int frame);
/* Input is the engine's fixed-size, possibly unterminated 16-byte MDL name. */
const char *qev_NamedAnimation(const char name[16]);
int qev_FallenAnimation(const char *pose);
#endif
