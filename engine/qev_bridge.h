/* SPDX-License-Identifier: GPL-2.0-or-later
 * qev's narrow bridge, 2026-10-04; included after Quake's engine type definitions.
 * See COPYING and README.md for license, source, and modification notices.
 */
#ifndef qev_BRIDGE_H
#define qev_BRIDGE_H
#include "qev_pixels.h"
#include "qev_animation.h"
void qev_AliasModel(model_t *asset, const void *bytes, int length);
void qev_BeginView(int unsupported);
void qev_DrawEntity(entity_t *entity);
void qev_DrawSurface(msurface_t *surface, entity_t *entity);
void qev_AudibleSound(const char *name, int left_peak, int right_peak);
void qev_EndView(void);
void qev_MainLoop(void);
int qev_DeferVideo(void);
void qev_VideoPresented(double milliseconds);
void qev_FlushVideo(void);
void qev_PreRender(void);
int qev_OwnsInput(void);
void qev_ApplyInput(usercmd_t *cmd);
void qev_ClearKeys(void);
void qev_Buttons(int attack, int jump, int impulse);
void qev_WorldChanged(void);
void qev_EntityFreed(edict_t *ed);
#endif
