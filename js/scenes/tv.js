/* Cartoon TV: three short videos showing Atticus using the potty,
 * brushing his teeth and looking after baby sister. */
AT.scenes.tv = {
  EPISODES: [
    { key: 'potty', badge: 'badge_potty' },
    { key: 'teeth', badge: 'badge_teeth' },
    { key: 'baby', badge: 'badge_baby' },
  ],
  build() {
    const E = AT.engine;
    const W = E.world;
    E.node(W, { sprite: 'bg_lounge' });
    E.node(W, { sprite: 'tv_stand' }).set({ x: 800, y: 830 });
    E.node(W, { sprite: 'tv' }).set({ x: 800, y: 500, s: 0.95 });
    const atticus = AT.puppet(W, 'atticus', { x: 190, y: 885, s: 0.85 });
    const baby = AT.puppet(W, 'baby', { x: 1410, y: 885, s: 0.85 });
    baby.setFace({ eyes: 'happy', mouth: 'smile' });
    AT.cast = { A: atticus };

    const screen = document.createElement('div');
    screen.className = 'tvscreen';
    Object.assign(screen.style, { left: '458px', top: '301px', width: '684px', height: '389px' });
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.preload = 'metadata';
    screen.appendChild(video);
    const msg = document.createElement('div');
    msg.className = 'tvmsg';
    screen.appendChild(msg);
    E.ui.appendChild(screen);
    const screenNode = E.node(E.ui).set({ x: 800, y: 495 });
    screenNode.hit(684, 389, 0, 0, false);
    const bigPlay = E.node(E.ui, { sprite: 'ui_play' }).set({ x: 800, y: 495, s: 0.9 });

    const buttons = this.EPISODES.map((ep, i) => {
      const b = E.node(W, { sprite: ep.badge }).set({ x: 560 + i * 240, y: 858, s: 0.52 });
      b.hit(200, 200, 0, 0);
      b.ep = ep;
      return b;
    });
    return { atticus, baby, video, msg, screenNode, bigPlay, buttons };
  },

  async run(c) {
    const E = AT.engine;
    const { video, msg, screenNode, bigPlay, buttons, atticus, baby } = c;
    AT.audio.music('happy');
    let current = null;
    const setPlayingLook = (on) => {
      bigPlay.set({ visible: !on });
      atticus.setFace(on ? { eyes: 'happy', mouth: 'grin' } : { eyes: 'open', mouth: 'smile' });
      baby.setPose(on ? 'happy' : 'idle');
    };
    const play = (ep) => {
      current = ep;
      msg.textContent = '';
      const mp4 = video.canPlayType('video/mp4; codecs="avc1.640028, mp4a.40.2"');
      video.src = `videos/${ep.key}.${mp4 ? 'mp4' : 'webm'}`;
      video.poster = `videos/${ep.key}.jpg`;
      video.muted = AT.audio.muted;
      AT.audio.stopMusic();
      AT.hideCaption();
      const p = video.play();
      if (p && p.catch) p.catch(() => setPlayingLook(false));
      setPlayingLook(true);
      buttons.forEach((b) => b.set({ s: b.ep === ep ? 0.62 : 0.52 }));
    };
    video.addEventListener('ended', () => { setPlayingLook(false); AT.audio.music('happy'); });
    video.addEventListener('pause', () => setPlayingLook(false));
    video.addEventListener('play', () => setPlayingLook(true));
    video.addEventListener('error', () => { msg.textContent = 'This cartoon is still being painted!'; setPlayingLook(false); });
    E.onEnd(() => { video.pause(); video.removeAttribute('src'); video.load(); });

    // 'click' so the video is allowed to start with sound on phones and tablets
    buttons.forEach((b) => E.onTap(b, () => { AT.audio.sfx('pop'); play(b.ep); }, { event: 'click' }));
    E.onTap(screenNode, () => {
      if (!current) { play(this.EPISODES[0]); return; }
      if (video.paused) { video.muted = AT.audio.muted; video.play().catch(() => {}); AT.audio.stopMusic(); } else video.pause();
    }, { event: 'click' });
    E.every((dt, t) => buttons.forEach((b, i) => { if (b.ep !== current) b.set({ y: 858 + Math.sin(t * 3 + i) * 6 }); }));
    await AT.say('n_tv_pick');
    if (!current) {
      const hand = E.pointAt(buttons[0]);
      await E.until(() => current);
      hand.remove();
    }
  },
};
