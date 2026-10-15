/* The big party once all three stickers are earned. */
AT.scenes.party = {
  build() {
    const E = AT.engine;
    const W = E.world;
    E.node(W, { sprite: 'bg_lounge' });
    E.node(W, { sprite: 'bunting' });
    const balloons = E.layer(W);
    const mama = AT.puppet(W, 'mama', { x: 300, y: 780, s: 0.92 });
    const dada = AT.puppet(W, 'dada', { x: 1300, y: 780, s: 0.92 });
    E.node(W, { sprite: 'party_table' });
    E.node(W, { sprite: 'cake' }).set({ x: 800, y: 690, s: 0.9 });
    const atticus = AT.puppet(W, 'atticus', { x: 560, y: 912, s: 1 });
    const baby = AT.puppet(W, 'baby', { x: 1060, y: 925, s: 0.95 });
    AT.cast = { A: atticus, M: mama, D: dada };
    return { mama, dada, atticus, baby, balloons };
  },

  async run(c) {
    const E = AT.engine;
    const { mama, dada, atticus, baby, balloons } = c;
    AT.audio.music('party');
    AT.audio.sfx('fanfare');
    AT.confetti(70);
    [mama, dada].forEach((p) => { p.setPose('cheer'); p.setFace({ eyes: 'happy', mouth: 'laugh' }); });
    atticus.setPose('dance');
    atticus.setFace({ eyes: 'happy', mouth: 'grin' });
    baby.setPose('happy');
    baby.setFace({ eyes: 'happy', mouth: 'giggle' });
    this.balloonMachine(c);
    await AT.say('n_party');

    // the Big Boy award
    const rays = E.node(E.ui, { sprite: 'rays' }).set({ x: 800, y: 380, s: 0, alpha: 0.8 });
    const trophy = E.node(E.ui, { sprite: 'trophy' }).set({ x: 800, y: 380, s: 0 });
    E.every((dt, t) => rays.set({ rot: t * 30 }));
    AT.audio.sfx('fanfare');
    AT.audio.sfx('applause');
    await Promise.all([rays.to({ s: 2.4 }, 0.6, 'back'), trophy.to({ s: 1.3 }, 0.7, 'back')]);
    AT.confetti(50);
    atticus.setPose('cheer');
    await AT.say('n_award');
    mama.setPose('clap');
    await AT.say('m_superstar', mama);
    dada.setPose('clap');
    await AT.say('d_hip_hip', dada);
    AT.audio.sfx('applause');
    await AT.say('m_love', mama);
    await Promise.all([rays.to({ s: 0 }, 0.4, 'in'), trophy.to({ x: 1460, y: 210, s: 0.45 }, 0.8, 'inOut')]);
    rays.remove();
    mama.setPose('cheer'); dada.setPose('cheer');
    atticus.setPose('dance');

    await AT.say('n_pop');
    c.popped = 0;
    await E.until(() => c.popped >= 8 || E.time - E.lastInput > 20);
    const home = document.getElementById('btn-home');
    home.classList.add('pulse');
    E.onEnd(() => home.classList.remove('pulse'));
    await AT.say('n_play_again');
  },

  balloonMachine(c) {
    const E = AT.engine;
    const colours = ['balloon_red', 'balloon_blue', 'balloon_yellow', 'balloon_green', 'balloon_purple'];
    let next = 0;
    E.every((dt) => {
      next -= dt;
      if (next > 0) return;
      next = 0.7 + Math.random() * 0.8;
      const b = E.node(c.balloons, { sprite: E.pick(colours) });
      const x0 = 120 + Math.random() * 1360;
      const sp = 90 + Math.random() * 70;
      const ph = Math.random() * 6;
      b.set({ x: x0, y: 1000, s: 0.8 + Math.random() * 0.4 });
      b.hit(110, 150, 0, -10);
      let alive = true;
      const stop = E.every((d, t) => {
        if (!alive) return;
        b.set({ y: b.y - sp * d, x: x0 + Math.sin(t * 1.5 + ph) * 30, rot: Math.sin(t * 2 + ph) * 6 });
        if (b.y < -320) { alive = false; stop(); b.remove(); }
      });
      E.onTap(b, () => {
        if (!alive) return;
        alive = false;
        stop();
        c.popped = (c.popped || 0) + 1;
        AT.audio.sfx('pop');
        E.burst(c.balloons, ['confetti0', 'confetti1', 'confetti2', 'confetti3', 'star'], b.x, b.y, { n: 12, speed: 380, gravity: 500, life: 1, scale: 0.9 });
        b.remove();
      });
    });
  },
};
