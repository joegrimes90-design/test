/* Puppets: characters built from separately painted parts that bend at
 * their joints, with swappable faces and simple procedural poses. */
(() => {
  const E = AT.engine;
  const { Node } = E;

  const DEFS = {
    atticus: {
      parts: [
        ['legL', 'at_legL', [-28, -66], 'bob'],
        ['legR', 'at_legR', [28, -66], 'bob'],
        ['sitLegs', 'at_sitLegs', [0, -50], 'bob', true],
        ['shortsDown', 'at_shortsDown', [0, -30], 'bob', true],
        ['upper', null, [0, -66], 'bob'],
        ['shorts', 'at_shorts', [0, -80], 'upper'],
        ['body', 'at_body', [0, -100], 'upper'],
        ['shirtLong', 'at_shirtLong', [0, -90], 'upper', true],
        ['armL', 'at_armL', [-56, -198], 'upper'],
        ['armR', 'at_armR', [56, -198], 'upper'],
        ['head', 'at_head', [0, -215], 'upper'],
      ],
      face: {
        on: 'head',
        eyes: { open: 'at_eyes_open', blink: 'at_eyes_blink', happy: 'at_eyes_happy', wide: 'at_eyes_wide', worry: 'at_eyes_worry', squeeze: 'at_eyes_squeeze' },
        mouth: { smile: 'at_mouth_smile', grin: 'at_mouth_grin', o: 'at_mouth_o', wobble: 'at_mouth_wobble', ahh: 'at_mouth_ahh', flat: 'at_mouth_flat', puff: 'at_mouth_puff' },
      },
      hand: { armL: [-87, -106], armR: [87, -106] },
      talk: ['o', 'grin', 'smile', 'grin'],
    },
    mama: {
      parts: [
        ['hairBack', 'mm_hairBack', [0, -215], 'bob'],
        ['body', 'mm_body', [0, -100], 'bob'],
        ['armL', 'mm_armL', [-90, -195], 'bob'],
        ['armR', 'mm_armR', [90, -195], 'bob'],
        ['head', 'mm_head', [0, -220], 'bob'],
      ],
      face: {
        on: 'head',
        eyes: { open: 'mm_eyes_open', happy: 'mm_eyes_happy', blink: 'mm_eyes_blink' },
        mouth: { smile: 'mm_mouth_smile', laugh: 'mm_mouth_laugh', o: 'mm_mouth_o' },
      },
      hand: { armL: [-116, -30], armR: [116, -30] },
      talk: ['o', 'laugh', 'smile', 'laugh'],
    },
    dada: {
      parts: [
        ['body', 'dd_body', [0, -100], 'bob'],
        ['armL', 'dd_armL', [-100, -205], 'bob'],
        ['armR', 'dd_armR', [100, -205], 'bob'],
        ['head', 'dd_head', [0, -232], 'bob'],
      ],
      face: {
        on: 'head',
        eyes: { open: 'dd_eyes_open', happy: 'dd_eyes_happy', blink: 'dd_eyes_blink' },
        mouth: { smile: 'dd_mouth_smile', laugh: 'dd_mouth_laugh', o: 'dd_mouth_o' },
      },
      hand: { armL: [-127, -30], armR: [127, -30] },
      talk: ['o', 'laugh', 'smile', 'laugh'],
    },
    baby: {
      parts: [
        ['body', 'bb_body', [0, -60], 'bob'],
        ['armL', 'bb_armL', [-40, -142], 'bob'],
        ['armR', 'bb_armR', [40, -142], 'bob'],
        ['head', 'bb_head', [0, -150], 'bob'],
      ],
      face: {
        on: 'head',
        eyes: { open: 'bb_eyes_open', happy: 'bb_eyes_happy', closed: 'bb_eyes_closed', cry: 'bb_eyes_cry', sleepy: 'bb_eyes_sleepy' },
        mouth: { smile: 'bb_mouth_smile', giggle: 'bb_mouth_giggle', cry: 'bb_mouth_cry', o: 'bb_mouth_o', pout: 'bb_mouth_pout' },
        tears: { on: 'bb_tears' },
      },
      hand: { armL: [-72, -84], armR: [72, -84] },
      talk: ['o', 'giggle', 'smile'],
    },
  };

  class Puppet extends Node {
    constructor(parent, kind, opts = {}) {
      super(parent, { cls: 'puppet ' + kind });
      this.kind = kind;
      const def = (this.def = DEFS[kind]);
      this.bob = new Node(this);
      this.parts = {};
      for (const [name, sprite, pivot, parentName, hidden] of def.parts) {
        const par = parentName === 'bob' ? this.bob : this.parts[parentName];
        const nd = new Node(par);
        nd.pivot = pivot;
        nd.inner = document.createElement('div');
        nd.inner.className = 'inner';
        nd.inner.style.transform = `translate(${-pivot[0]}px,${-pivot[1]}px)`;
        nd.el.appendChild(nd.inner);
        if (sprite) nd.inner.appendChild(AT.art.img(sprite));
        nd.set({ x: pivot[0], y: pivot[1], visible: !hidden });
        this.parts[name] = nd;
      }
      // child parts live inside their parent's inner wrapper (in character coordinates)
      for (const [name, , , parentName] of def.parts) {
        if (parentName !== 'bob') this.parts[parentName].inner.appendChild(this.parts[name].el);
      }
      // faces
      this.faceImgs = {};
      this.face = {};
      const host = this.parts[def.face.on].inner;
      for (const g in def.face) {
        if (g === 'on') continue;
        this.faceImgs[g] = {};
        for (const v in def.face[g]) {
          const im = AT.art.img(def.face[g][v]);
          im.style.display = 'none';
          host.appendChild(im);
          this.faceImgs[g][v] = im;
        }
      }
      this.setFace({ eyes: 'open', mouth: 'smile', tears: null });
      this.pose = 'idle';
      this.extra = { armL: 0, armR: 0, head: 0, lean: 0, bobY: 0, legL: 0, legR: 0 };
      this.blinkAt = E.time + 1 + Math.random() * 3;
      this.blinking = false;
      this.talkUntil = 0;
      this.phase = Math.random() * 10;
      this.speed = 1;
      this.set(opts);
      this.stopUpdate = E.every((dt, t) => this.update(dt, t));
    }

    setFace(f) {
      for (const g in f) {
        if (!this.faceImgs[g]) continue;
        const v = f[g];
        if (this.face[g] && this.faceImgs[g][this.face[g]]) this.faceImgs[g][this.face[g]].style.display = 'none';
        this.face[g] = v;
        if (v && this.faceImgs[g][v]) this.faceImgs[g][v].style.display = '';
      }
      return this;
    }
    showEyes(v) {
      for (const k in this.faceImgs.eyes) this.faceImgs.eyes[k].style.display = k === v ? '' : 'none';
    }
    showMouth(v) {
      for (const k in this.faceImgs.mouth) this.faceImgs.mouth[k].style.display = k === v ? '' : 'none';
    }
    talk(sec) { this.talkUntil = E.time + sec; }
    armsFront(on) {
      const host = this.parts.head.el.parentNode;
      if (on) { host.appendChild(this.parts.armL.el); host.appendChild(this.parts.armR.el); }
      else { host.insertBefore(this.parts.armR.el, this.parts.head.el); host.insertBefore(this.parts.armL.el, this.parts.armR.el); }
    }
    setPose(p) { this.pose = p; this.phase = 0; return this; }

    // attach a sprite to a hand, returns the prop node (local coords around the hand)
    hold(sprite, arm = 'armR', o = {}) {
      const [hx, hy] = this.def.hand[arm];
      const holder = new Node(null);
      this.parts[arm].inner.appendChild(holder.el);
      const nd = new Node(holder, { sprite });
      holder.set({ x: hx, y: hy });
      nd.set(o);
      nd.holder = holder;
      const rm = nd.remove.bind(nd);
      nd.remove = () => { rm(); holder.remove(); };
      return nd;
    }

    update(dt, t) {
      this.phase += dt * this.speed;
      const ph = this.phase;
      const p = this.parts;
      let legL = 0, legR = 0, armL = 0, armR = 0, head = 0, bobY = 0, bobRot = 0, upperY = 0, lean = 0, sq = 1;
      const kid = this.kind === 'atticus';
      const sitting = this.pose === 'sit' || this.pose === 'push' || this.pose === 'sitwiggle';
      switch (this.pose) {
        case 'idle':
          head = Math.sin(ph * 1.3) * 2.5;
          armL = Math.sin(ph * 1.7) * 2; armR = -Math.sin(ph * 1.7 + 1) * 2;
          sq = 1 + Math.sin(ph * 2.2) * 0.008;
          break;
        case 'walk': {
          const w = ph * 9;
          legL = Math.sin(w) * 20; legR = -legL;
          armL = -Math.sin(w) * 16; armR = -Math.sin(w) * 16;
          bobY = -Math.abs(Math.sin(w)) * 10; bobRot = Math.sin(w) * 2;
          break;
        }
        case 'run': {
          const w = ph * 14;
          legL = Math.sin(w) * 28; legR = -legL;
          armL = 20 - Math.sin(w) * 26; armR = -20 - Math.sin(w) * 26;
          bobY = -Math.abs(Math.sin(w)) * 18; lean = 4;
          break;
        }
        case 'wiggle': {
          const w = ph * 9;
          legL = -13 + Math.sin(w) * 6; legR = 13 + Math.sin(w) * 6;
          bobRot = Math.sin(w * 0.5) * 5; bobY = -Math.abs(Math.sin(w)) * 9;
          armL = -50 + Math.sin(w) * 4; armR = 50 + Math.sin(w) * 4;
          head = Math.sin(w * 0.5) * 7;
          break;
        }
        case 'cheer': {
          const w = ph * 8;
          armL = (kid ? 122 : 150) + Math.sin(w) * 14; armR = -armL;
          bobY = -Math.abs(Math.sin(w * 0.5)) * (kid ? 46 : 18);
          head = Math.sin(w * 0.5) * 5;
          break;
        }
        case 'dance': {
          const w = ph * 7;
          armL = 60 + Math.sin(w) * 70; armR = -60 + Math.sin(w) * 70;
          bobRot = Math.sin(w) * 7; bobY = -Math.abs(Math.sin(w)) * (kid ? 34 : 14);
          legL = Math.sin(w) * 14; legR = Math.sin(w) * 14;
          head = Math.sin(w) * 8;
          break;
        }
        case 'clap': {
          const w = ph * 10;
          armL = -38 + Math.sin(w) * 12; armR = 38 - Math.sin(w) * 12;
          bobY = -Math.abs(Math.sin(w * 0.5)) * 8;
          break;
        }
        case 'wave':
          head = Math.sin(ph * 1.3) * 3;
          armL = Math.sin(ph * 1.7) * 2;
          armR = (kid ? -118 : -150) + Math.sin(ph * 9) * 18;
          break;
        case 'sit':
          head = Math.sin(ph * 1.3) * 2;
          armL = -14; armR = 14;
          break;
        case 'sitwiggle': {
          const w = ph * 8;
          bobRot = Math.sin(w) * 3; head = Math.sin(w * 0.5) * 6;
          armL = -40; armR = 40;
          break;
        }
        case 'push':
          bobRot = Math.sin(ph * 40) * 1.2; sq = 1 - Math.abs(Math.sin(ph * 2)) * 0.02;
          armL = -30; armR = 30;
          break;
        case 'hold':
          break;
        case 'cry': {
          const w = ph * 7;
          armL = 30 + Math.sin(w) * 25; armR = -30 - Math.sin(w * 1.1) * 25;
          head = Math.sin(w * 0.8) * 8; bobY = -Math.abs(Math.sin(w * 0.5)) * 4;
          break;
        }
        case 'happy': {
          const w = ph * 8;
          armL = 60 + Math.sin(w) * 30; armR = -60 - Math.sin(w) * 30;
          bobY = -Math.abs(Math.sin(w * 0.5)) * 10; head = Math.sin(w * 0.5) * 6;
          break;
        }
        case 'sleep':
          head = 14 + Math.sin(ph * 1.2) * 2; sq = 1 + Math.sin(ph * 1.2) * 0.012;
          armL = -10; armR = 10;
          break;
        case 'eat':
          armL = -55; armR = 55; head = Math.sin(ph * 3) * 2;
          break;
        case 'peek':
          armL = 168; armR = -168;
          break;
        case 'shh':
          armR = -118; head = -4;
          break;
        case 'tummy':
          armL = -50; armR = 50; head = Math.sin(ph * 1.3) * 3;
          break;
      }
      const x = this.extra;
      const set = (n, r) => n && n.set({ rot: r });
      set(p.legL, legL + x.legL); set(p.legR, legR + x.legR);
      set(p.armL, armL + x.armL); set(p.armR, armR + x.armR);
      if (p.head) p.head.set({ rot: head + x.head });
      if (p.hairBack) p.hairBack.set({ rot: head + x.head });
      if (p.upper) p.upper.set({ y: p.upper.pivot[1] + (sitting ? 48 : 0) + upperY, rot: lean + x.lean, sy: sq });
      else if (p.body) p.body.set({ sy: sq });
      this.bob.set({ y: bobY + x.bobY, rot: bobRot });
      if (kid) {
        p.legL.set({ visible: !sitting }); p.legR.set({ visible: !sitting });
        p.shorts.set({ visible: !sitting && !this.pantsDown });
        p.sitLegs.set({ visible: sitting });
        p.shortsDown.set({ visible: !sitting && !!this.pantsDown });
        p.shirtLong.set({ visible: !sitting && !!this.pantsDown });
      }
      // blinking
      const ev = this.face.eyes;
      if (!this.blinking && t > this.blinkAt && this.faceImgs.eyes.blink && (ev === 'open' || ev === 'wide' || ev === 'worry')) {
        this.blinking = true;
        this.showEyes('blink');
        this.blinkEnd = t + 0.13;
      }
      if (this.blinking && t > this.blinkEnd) {
        this.blinking = false;
        this.showEyes(this.face.eyes);
        this.blinkAt = t + 2 + Math.random() * 3.5;
      }
      // lip flap while speaking
      if (t < this.talkUntil) {
        const shapes = this.def.talk;
        this.showMouth(shapes[Math.floor(t * 9) % shapes.length]);
        this.talking = true;
      } else if (this.talking) {
        this.talking = false;
        this.showMouth(this.face.mouth);
      }
    }

    async walkTo(x, speed = 320, pose = 'walk') {
      const d = Math.abs(x - this.x);
      if (d < 2) return;
      this.setPose(pose);
      await E.tween(this, { x }, d / speed, 'linear');
      this.setPose('idle');
    }
    async jump(h = 80, dur = 0.5) {
      const o = { v: 0 };
      await E.tween(o, { v: 1 }, dur, 'linear', () => { this.extra.bobY = -Math.sin(o.v * Math.PI) * h; });
      this.extra.bobY = 0;
    }
  }
  AT.Puppet = Puppet;
  AT.puppet = (parent, kind, opts) => new Puppet(parent, kind, opts);
})();
