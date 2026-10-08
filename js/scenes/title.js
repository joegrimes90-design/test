/* Title: the family outside their house. Tap Play to start. */
AT.scenes.title = {
  build() {
    const E = AT.engine;
    const W = E.world;
    E.node(W, { sprite: 'bg_garden' });
    const sun = E.node(W, { sprite: 'sun' }).set({ x: 150, y: 140, s: 0.9 });
    E.every((dt, t) => sun.set({ rot: Math.sin(t * 0.8) * 8 }));
    const c1 = E.node(W, { sprite: 'cloud1' }).set({ x: 520, y: 260, s: 0.8 });
    const c2 = E.node(W, { sprite: 'cloud2' }).set({ x: 1080, y: 300, s: 0.9 });
    AT.drift(c1, 60, 14); AT.drift(c2, -50, 11);
    E.node(W, { sprite: 'tree' }).set({ x: 1500, y: 700, s: 0.8 });
    E.node(W, { sprite: 'house_ext' }).set({ x: 1230, y: 660, s: 0.62 });
    const mama = AT.puppet(W, 'mama', { x: 960, y: 772, s: 0.8 });
    const dada = AT.puppet(W, 'dada', { x: 1290, y: 772, s: 0.8 });
    E.node(W, { sprite: 'fg_hedge' });
    const baby = AT.puppet(W, 'baby', { x: 300, y: 885, s: 0.85 });
    const atticus = AT.puppet(W, 'atticus', { x: 570, y: 885, s: 0.95 });
    atticus.setPose('wave');
    mama.setFace({ mouth: 'smile' });
    baby.setFace({ eyes: 'happy', mouth: 'giggle' });
    AT.cast = { A: atticus, M: mama, D: dada };

    // painted title letters
    const word = "Atticus's Big Day!";
    const colours = ['#e8513f', '#f08c3c', '#e2a91c', '#4fae4a', '#3f8fd8', '#9a6ad0', '#e85f9a'];
    const letters = [];
    let x = 800 - word.length * 30;
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      const w = ch === ' ' ? 34 : ch === "'" ? 26 : ch === 'i' || ch === 't' ? 46 : 66;
      if (ch !== ' ') {
        const t = AT.text(W, ch, 'title-letter', x + w / 2, 120);
        t.el.querySelector('.txtc').style.color = colours[i % colours.length];
        letters.push({ t, x: x + w / 2, i });
      }
      x += w;
    }
    E.every((dt, tt) => letters.forEach(({ t, x: lx, i }) => t.set({ x: lx, y: 118 + Math.sin(tt * 3 + i * 0.5) * 9, rot: Math.sin(tt * 2 + i) * 4 })));

    const play = E.node(W, { sprite: 'ui_play' }).set({ x: 800, y: 385, s: 1.1 });
    play.hit(260, 260, 0, 0);
    E.every((dt, t) => play.set({ s: 1.1 + Math.sin(t * 4) * 0.06 }));
    const tap = AT.text(W, 'Tap to play!', 'tapme', 800, 540);
    E.every((dt, t) => tap.set({ alpha: 0.6 + 0.4 * Math.sin(t * 3) }));
    return { atticus, mama, dada, baby, play, tap };
  },

  async run(ctx) {
    const E = AT.engine;
    const { atticus, mama, dada, baby, play, tap } = ctx;
    // the first tap anywhere starts the game (and switches the sound on)
    await new Promise((resolve) => {
      const go = (ev) => {
        if (ev.target.closest && ev.target.closest('.hudbtn')) return;
        AT.audio.unlock();
        document.removeEventListener('pointerup', go, true);
        resolve();
      };
      document.addEventListener('pointerup', go, true);
    });
    const t0 = E.time;
    await E.until(() => AT.audio.ready || E.time - t0 > 1);
    AT.audio.sfx('pop');
    AT.audio.music('happy');
    tap.hide();
    await play.to({ s: 0 }, 0.3, 'in');
    play.hide();
    E.burst(E.world, ['star', 'heart', 'sparkle'], 800, 385, { n: 18, speed: 500, scale: 0.6, life: 1.2 });
    AT.audio.sfx('sparkle');
    await AT.say('n_hello');
    atticus.setPose('cheer');
    atticus.setFace({ eyes: 'happy', mouth: 'grin' });
    await AT.say('a_hi', atticus);
    atticus.setPose('idle');
    atticus.setFace({ eyes: 'open', mouth: 'smile' });
    mama.setPose('wave'); dada.setPose('wave'); baby.setPose('happy');
    AT.audio.sfx('giggle');
    await AT.say('n_intro');
    AT.progress.visits++;
    AT.save();
    AT.go('hub');
  },
};
