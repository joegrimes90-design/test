/* Hub: Atticus's dolls house. Each room is an activity; the sticker chart shows progress. */
AT.scenes.hub = {
  build() {
    const E = AT.engine;
    const W = E.world;
    E.node(W, { sprite: 'bg_garden' });
    const sun = E.node(W, { sprite: 'sun' }).set({ x: 130, y: 120, s: 0.75 });
    E.every((dt, t) => sun.set({ rot: Math.sin(t * 0.8) * 8 }));
    const c1 = E.node(W, { sprite: 'cloud2' }).set({ x: 1180, y: 110, s: 0.8 });
    AT.drift(c1, 50, 12);

    const house = E.node(W).set({ x: 700, y: 872, s: 0.98 });
    E.node(house, { sprite: 'dollhouse' });
    const mk = (sprite, x, y) => {
      const r = E.node(house, { sprite }).set({ x, y });
      r.hit(380, 250, 190, 125, false);
      return r;
    };
    const rooms = {
      teeth: mk('room_teeth', -405, -555),
      baby: mk('room_baby', 25, -555),
      potty: mk('room_potty', -405, -285),
      tv: mk('room_tv', 25, -285),
    };
    // furnish the rooms with the real props, small
    E.node(rooms.teeth, { sprite: 'sink' }).set({ x: 150, y: 246, s: 0.42 });
    E.node(rooms.teeth, { sprite: 'toothbrush' }).set({ x: 262, y: 118, s: 0.45, rot: -70 });
    E.node(rooms.teeth, { sprite: 'cup' }).set({ x: 270, y: 150, s: 0.42 });
    E.node(rooms.teeth, { sprite: 'paste_tube' }).set({ x: 300, y: 228, s: 0.32, rot: -8 });
    E.node(rooms.baby, { sprite: 'cot' }).set({ x: 118, y: 246, s: 0.38 });
    E.node(rooms.baby, { sprite: 'mobile' }).set({ x: 118, y: 0, s: 0.32 });
    const babyMini = AT.puppet(rooms.baby, 'baby', { x: 285, y: 238, s: 0.5 });
    babyMini.setFace({ eyes: 'happy', mouth: 'giggle' });
    E.node(rooms.potty, { sprite: 'potty' }).set({ x: 175, y: 238, s: 0.78 });
    E.node(rooms.potty, { sprite: 'tp_holder' }).set({ x: 318, y: 92, s: 0.55 });
    E.node(rooms.potty, { sprite: 'teddy' }).set({ x: 60, y: 240, s: 0.42 });
    E.node(rooms.tv, { sprite: 'tv_stand' }).set({ x: 190, y: 198, s: 0.36 });
    E.node(rooms.tv, { sprite: 'tv' }).set({ x: 190, y: 112, s: 0.3 });
    const tvPlay = E.node(rooms.tv, { sprite: 'ui_play' }).set({ x: 190, y: 112, s: 0.32 });
    E.every((dt, t) => tvPlay.set({ s: 0.32 + Math.sin(t * 4) * 0.02 }));

    // stickers earned show as a little badge in the room corner
    const badgeFor = { potty: 'badge_potty', teeth: 'badge_teeth', baby: 'badge_baby' };
    for (const k in badgeFor) if (AT.progress[k]) E.node(rooms[k], { sprite: badgeFor[k] }).set({ x: 342, y: 40, s: 0.3 });

    // sticker chart
    const chart = E.node(W, { sprite: 'chart' }).set({ x: 1365, y: 485 });
    chart.hit(320, 440, 0, 0, false);
    AT.text(W, 'My Stickers', 'label', 1365, 212);
    const slots = {};
    [['potty', -86], ['teeth', 24], ['baby', 134]].forEach(([k, y]) => {
      const b = E.node(chart, { sprite: badgeFor[k] }).set({ x: 0, y, s: 0.56 });
      slots[k] = { node: b, x: 1365, y: 485 + y };
      if (!AT.progress[k]) b.set({ alpha: 0.18 });
    });

    const atticus = AT.puppet(W, 'atticus', { x: 165, y: 872, s: 0.82 });
    atticus.hit(200, 420, 0, -210, false);
    AT.cast = { A: atticus };

    let reset = null;
    if (AT.allDone()) {
      reset = E.node(W, { sprite: 'sun' }).set({ x: 1365, y: 790, s: 0.45 });
      reset.hit(130, 130, 0, 0);
      AT.text(W, 'New day', 'label', 1365, 868);
    }
    return { atticus, rooms, slots, chart, reset };
  },

  async run(ctx, params) {
    const E = AT.engine;
    const { atticus, rooms, slots, chart, reset } = ctx;
    AT.audio.music('happy');
    let busy = false;
    const names = { potty: 'n_potty_name', teeth: 'n_teeth_name', baby: 'n_baby_name', tv: 'n_tv_name' };
    for (const k in rooms) {
      E.onTap(rooms[k], async () => {
        if (busy) return;
        busy = true;
        AT.audio.sfx('pop');
        rooms[k].to({ s: 1.06 }, 0.12, 'out').then(() => rooms[k].to({ s: 1 }, 0.15));
        await AT.say(names[k]);
        AT.go(k);
      });
    }
    E.onTap(atticus, async () => {
      AT.audio.sfx('boing');
      atticus.setFace({ eyes: 'happy', mouth: 'grin' });
      await atticus.jump(70, 0.5);
      atticus.setFace({ eyes: 'open', mouth: 'smile' });
    });
    E.onTap(chart, () => { if (!AT.voiceBusy()) AT.sayNow('n_chart'); });
    if (reset) {
      E.onTap(reset, () => {
        AT.audio.sfx('magic');
        AT.resetProgress();
        AT.progress.visits = 1;
        AT.save();
        AT.go('hub');
      });
    }

    if (params.newSticker) {
      busy = true;
      const k = params.newSticker;
      const badge = E.node(E.ui, { sprite: 'badge_' + k }).set({ x: 800, y: 450, s: 0 });
      AT.audio.sfx('fanfare');
      E.burst(E.ui, ['star', 'sparkle', 'heart'], 800, 450, { n: 24, speed: 520, scale: 0.6, life: 1.3 });
      await badge.to({ s: 1.6, rot: 360 }, 0.8, 'back');
      atticus.setPose('cheer');
      atticus.setFace({ eyes: 'happy', mouth: 'grin' });
      await E.wait(0.8);
      const sl = slots[k];
      await badge.to({ x: sl.x, y: sl.y, s: 0.56, rot: 720 }, 0.9, 'inOut');
      badge.remove();
      sl.node.set({ alpha: 1 });
      AT.audio.sfx('sparkle');
      E.burst(E.world, ['sparkle', 'star'], sl.x, sl.y, { n: 12, speed: 300, gravity: 150, scale: 0.4, life: 0.8 });
      await E.wait(0.6);
      atticus.setPose('idle');
      atticus.setFace({ eyes: 'open', mouth: 'smile' });
      busy = false;
      if (AT.allDone() && !AT.progress.party) {
        busy = true;
        await AT.say('n_all_done');
        AT.progress.party = true;
        AT.save();
        AT.go('party');
        return;
      }
    }

    const anyDone = AT.progress.potty || AT.progress.teeth || AT.progress.baby;
    if (!busy) await AT.say(anyDone ? 'n_pick_more' : 'n_pick');
    // gentle nudges if nothing happens
    const next = () => ['potty', 'teeth', 'baby'].find((k) => !AT.progress[k]) || 'tv';
    for (let i = 0; i < 2; i++) {
      await E.until(() => E.time - E.lastInput > 12 && !busy && !AT.voiceBusy());
      const hand = E.pointAt(rooms[next()]);
      await AT.say(anyDone ? 'n_pick_more' : 'n_pick');
      await E.wait(3);
      hand.remove();
      E.lastInput = E.time;
    }
  },
};
