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
    assert(!strcmp(Qev_NamedAnimation(name), expected));
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
        const qev_animation_model_t *model = Qev_AnimationModel(bytes, (size_t)size, frames); assert(model);
        for (int i = 0; i < frames; i++) printf("%s%s", i ? "," : "", Qev_AnimationPose(model, i));
        puts(""); bytes[size - 1] ^= 1;
        assert(!Qev_AnimationModel(bytes, (size_t)size, frames)); free(bytes); return 0;
    }
    assert(Qev_AnimationFingerprint("hello", 5) == UINT64_C(0xa430d84680aabd0b));
    assert(Qev_AnimationFingerprint(NULL, 99) == 0);
    const qev_animation_model_t *m = Qev_AnimationModel("hello", 5, 4);
    assert(m);
    assert(!strcmp(Qev_AnimationPose(m, 0), "idle"));
    assert(!strcmp(Qev_AnimationPose(m, 1), "death"));
    assert(!strcmp(Qev_AnimationPose(m, 2), "dead"));
    assert(!strcmp(Qev_AnimationPose(m, 3), "downed"));
    assert(!strcmp(Qev_AnimationPose(m, -1), "unknown"));
    assert(!strcmp(Qev_AnimationPose(m, 4), "unknown"));
    assert(!strcmp(Qev_AnimationPose(NULL, 0), "unknown"));
    assert(!Qev_AnimationModel("hello", 4, 4));
    assert(!Qev_AnimationModel("jello", 5, 4));
    assert(!Qev_AnimationModel("hello", 5, 5));
    assert(!Qev_AnimationModel(NULL, 5, 4));
    named("frame86", "unknown"); named("death1", "death"); named("DEATHB11", "death");
    named("bdeath10", "death"); named("die2", "death"); named("dead", "dead");
    named("dead03", "dead"); named("deathwish", "unknown"); named("deadlyattack1", "attack");
    named("pain10", "hurt"); named("runattack11", "attack"); named("melee_12", "attack");
    named("run1", "moving"); named("stand_9", "idle"); named("", "unknown");
    named("1234567890123456", "unknown"); named("ABCDEFGHIJKLMNOP", "unknown");
    assert(!strcmp(Qev_NamedAnimation(NULL), "unknown"));
    assert(Qev_FallenAnimation("death")); assert(Qev_FallenAnimation("dead"));
    assert(!Qev_FallenAnimation("downed")); assert(!Qev_FallenAnimation("hurt"));
    assert(!Qev_FallenAnimation("unknown")); assert(!Qev_FallenAnimation(NULL));
    puts("PASS asset identity, frame boundaries, named/unknown animation and downed-vs-dead semantics");
    return 0;
}
