/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef qev_NEAREST_H
#define qev_NEAREST_H

/* Disclosed controller assistance. Admit only renderer-confirmed objects;
 * no coordinates or measured ranges are returned to the model. A visible
 * candidate needs two readable three-float vectors; otherwise neither pointer
 * is dereferenced (so they may be absent/unreadable for excluded objects). */
typedef struct { int slot; double squared; } qev_nearest_t;
void qev_NearestReset(qev_nearest_t *selection);
void qev_NearestConsider(qev_nearest_t *selection, int slot, int visible,
    const float *eye, const float *point);

#endif
