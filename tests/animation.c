/* Synthetic pure annotation-unit tests; no world, actor state or game assets. */
#include "qev_animation.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void named(const char *text, const char *expected) {
    char name[16] = {0};
    size_t n = strlen(text); if (n > 16) n = 16;
    memcpy(name, text, n);
    assert(!strcmp(qev_NamedAnimation(name), expected));
}
int main(int argc, char **argv) {
    if (argc == 2) {
        /* Optional asset audit against the same production lookup. Never links
         * Quake or exports this reader to the browser/controller. */
        FILE *f = fopen(argv[1], "rb"); assert(f);
        assert(!fseek(f, 0, SEEK_END)); long size = ftell(f); assert(size >= 84);
        rewind(f); unsigned char *bytes = malloc((size_t)size); assert(bytes);
        assert(fread(bytes, 1, (size_t)size, f) == (size_t)size); fclose(f);
        int frames = bytes[68] | bytes[69] << 8 | bytes[70] << 16 | bytes[71] << 24;
        const qev_animation_model_t *model = qev_AnimationModel(bytes, (size_t)size, frames); assert(model);
        for (int i = 0; i < frames; i++) printf("%s%s", i ? "," : "", qev_AnimationPose(model, i));
        puts(""); bytes[size - 1] ^= 1;
        assert(!qev_AnimationModel(bytes, (size_t)size, frames)); free(bytes); return 0;
    }
    assert(qev_AnimationFingerprint("hello", 5) == UINT64_C(0xa430d84680aabd0b));
    assert(qev_AnimationFingerprint(NULL, 99) == 0);
    const qev_animation_model_t *m = qev_AnimationModel("hello", 5, 4);
    assert(m);
    assert(!strcmp(qev_AnimationPose(m, 0), "idle"));
    assert(!strcmp(qev_AnimationPose(m, 1), "death"));
    assert(!strcmp(qev_AnimationPose(m, 2), "dead"));
    assert(!strcmp(qev_AnimationPose(m, 3), "downed"));
    assert(!strcmp(qev_AnimationPose(m, -1), "unknown"));
    assert(!strcmp(qev_AnimationPose(m, 4), "unknown"));
    assert(!strcmp(qev_AnimationPose(NULL, 0), "unknown"));
    assert(!qev_AnimationModel("hello", 4, 4));
    assert(!qev_AnimationModel("jello", 5, 4));
    assert(!qev_AnimationModel("hello", 5, 5));
    assert(!qev_AnimationModel(NULL, 5, 4));
    named("frame86", "unknown"); named("death1", "death"); named("DEATHB11", "death");
    named("bdeath10", "death"); named("die2", "death"); named("dead", "dead");
    named("dead03", "dead"); named("deathwish", "unknown"); named("deadlyattack1", "attack");
    named("pain10", "hurt"); named("runattack11", "attack"); named("melee_12", "attack");
    named("run1", "moving"); named("stand_9", "idle"); named("", "unknown");
    named("1234567890123456", "unknown"); named("ABCDEFGHIJKLMNOP", "unknown");
    assert(!strcmp(qev_NamedAnimation(NULL), "unknown"));
    assert(qev_FallenAnimation("death")); assert(qev_FallenAnimation("dead"));
    assert(!qev_FallenAnimation("downed")); assert(!qev_FallenAnimation("hurt"));
    assert(!qev_FallenAnimation("unknown")); assert(!qev_FallenAnimation(NULL));
    puts("PASS asset identity, frame boundaries, named/unknown animation and downed-vs-dead semantics");
    return 0;
}
