/* SPDX-License-Identifier: GPL-2.0-or-later
 * Qev's narrow bridge, 2026-10-04; included after Quake's engine type definitions.
 * See COPYING and README.md for license, source, and modification notices.
 */
#ifndef QEV_BRIDGE_H
#define QEV_BRIDGE_H
#include "qev_pixels.h"
#include "qev_animation.h"
void Qev_AliasModel(model_t *asset, const void *bytes, int length);
void Qev_BeginView(int unsupported);
void Qev_DrawEntity(entity_t *entity);
void Qev_DrawSurface(msurface_t *surface, entity_t *entity);
void Qev_AudibleSound(const char *name, int left_peak, int right_peak);
void Qev_EndView(void);
void Qev_MainLoop(void);
void Qev_PreRender(void);
int Qev_OwnsInput(void);
void Qev_ApplyInput(usercmd_t *cmd);
void Qev_ClearKeys(void);
void Qev_Buttons(int attack, int jump, int impulse);
void Qev_WorldChanged(void);
void Qev_EntityFreed(edict_t *ed);
#endif
