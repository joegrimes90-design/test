/* Character art: Atticus, Mama, Dada and Baby Sister.
 * Change the colours in AT.palette to make the family look like yours.
 * Each character is drawn in its own coordinate system:
 *   Atticus and Baby: (0,0) is between the feet / bottom.  Mama and Dada: (0,0) is the waist.
 */
AT.palette = {
  skin: '#f5c7a4',
  cheek: '#f08c8c',
  hair: '#9c5f33',
  eyes: '#3a2620',
  shirt: '#e8513f',
  shirtStar: '#ffd447',
  shorts: '#4d82c4',
  shoes: '#4fb35a',
  pyjamas: '#7fb6e6',

  mamaSkin: '#f2c19c',
  mamaHair: '#6e3b24',
  mamaTop: '#9a6ad0',
  mamaLips: '#d8606a',

  dadaSkin: '#eebd96',
  dadaHair: '#3e2a20',
  dadaTop: '#35a597',

  babySkin: '#f7cdb0',
  babyHair: '#c88a4c',
  babyRomper: '#f6a6c2',
  babyBow: '#ffd447',
};

(() => {
  const A = AT.art;
  const { C, E, R, smooth, line, blob, star, mix, shade, tint } = A;
  const P = AT.palette;
  const W = '#fffaf1';
  const DARK = '#3a2626';

  // ===================== ATTICUS =====================
  // Feet at y=0, head centre at (0,-300).
  const HEAD_Y = -300;

  // right leg drawn once, mirrored for the left
  const legShapes = () => [
    { d: R(11, -78, 34, 58, 15), f: P.skin },
    { d: R(11, -36, 34, 16, 6), f: W, fx: 'ws', sw: 2.4 },
    { d: smooth([[8, -24], [40, -27], [58, -14], [58, -1], [10, 1], [4, -12]], true, 0.8), f: P.shoes },
    { d: line([[10, -3], [56, -4]]), k: W, sw: 3, f: null },
  ];
  A.define('at_legL', [-72, -90, 80, 96], () => legShapes().map((sh) => ({ ...sh, tf: 'scale(-1 1)' })));
  A.define('at_legR', [-8, -90, 80, 96], legShapes);

  A.define('at_shorts', [-84, -122, 168, 80], () => [
    { d: smooth([[-66, -112], [66, -112], [70, -84], [74, -56], [40, -50], [8, -56], [0, -74], [-8, -56], [-40, -50], [-74, -56], [-70, -84]], true, 0.6), f: P.shorts },
    { d: line([[-64, -102], [64, -102]]), k: shade(P.shorts, 0.35), sw: 2.2, f: null },
    { d: line([[-46, -96], [-38, -80], [-24, -78]]), k: shade(P.shorts, 0.3), sw: 2, f: null },
    { d: line([[46, -96], [38, -80], [24, -78]]), k: shade(P.shorts, 0.3), sw: 2, f: null },
    { d: smooth([[20, -60], [70, -64], [72, -56], [40, -52], [10, -57]]), f: shade(P.shorts, 0.3), fx: 't', k: false, o: 0.5 },
  ]);

  A.define('at_shortsDown', [-80, -52, 160, 44], () => [
    { d: smooth([[-66, -38], [-30, -44], [0, -40], [30, -44], [66, -38], [70, -24], [40, -16], [0, -20], [-40, -16], [-70, -24]], true, 0.7), f: P.shorts },
    { d: line([[-50, -30], [-20, -26], [10, -31], [44, -27]]), k: shade(P.shorts, 0.35), sw: 2, f: null },
  ]);

  A.define('at_body', [-92, -232, 184, 146], () => [
    { d: R(-16, -226, 32, 30, 10), f: P.skin, k: false },
    { d: smooth([[-56, -206], [-26, -214], [0, -206], [26, -214], [56, -206], [66, -150], [76, -100], [40, -94], [0, -96], [-40, -94], [-76, -100], [-66, -150]], true, 0.55), f: P.shirt },
    { d: smooth([[-24, -213], [0, -199], [24, -213]], false), k: shade(P.shirt, 0.4), sw: 3, f: null },
    { d: star(0, -156, 30, 14), f: P.shirtStar, fx: 'ws', sw: 2.6 },
    { d: smooth([[30, -200], [58, -204], [70, -148], [76, -102], [44, -96], [52, -150]]), f: shade(P.shirt, 0.35), fx: 't', k: false, o: 0.55 },
  ]);

  // longer shirt shown while the shorts are down, so Atticus stays covered
  A.define('at_shirtLong', [-92, -124, 184, 80], () => [
    { d: smooth([[-72, -116], [72, -116], [78, -88], [82, -58], [40, -52], [0, -54], [-40, -52], [-82, -58], [-78, -88]], true, 0.55), f: P.shirt },
    { d: smooth([[40, -114], [74, -112], [80, -60], [46, -54], [56, -90]]), f: shade(P.shirt, 0.35), fx: 't', k: false, o: 0.5 },
  ]);

  const arm = (side, sleeveColor) => () => {
    const s = side;
    return [
      // arm (skin)
      { d: smooth([[50 * s, -190], [68 * s, -192], [86 * s, -150], [94 * s, -116], [78 * s, -112], [66 * s, -146], [54 * s, -176]], true, 0.7), f: P.skin },
      // hand
      { d: C(87 * s, -106, 16), f: P.skin },
      { d: line([[80 * s, -100], [90 * s, -97]]), k: A.inkOf(P.skin), sw: 2, f: null },
      // sleeve
      { d: smooth([[44 * s, -212], [62 * s, -210], [80 * s, -188], [88 * s, -166], [66 * s, -158], [48 * s, -170]], true, 0.6), f: sleeveColor },
    ];
  };
  A.define('at_armL', [-116, -224, 86, 142], arm(-1, P.shirt));
  A.define('at_armR', [30, -224, 86, 142], arm(1, P.shirt));

  A.define('at_head', [-122, -432, 244, 228], () => [
    // ears
    { d: E(-94, HEAD_Y + 6, 17, 22), f: P.skin },
    { d: E(94, HEAD_Y + 6, 17, 22), f: P.skin },
    { d: E(-94, HEAD_Y + 7, 7, 11), f: mix(P.skin, P.cheek, 0.4), fx: 't', k: false, o: 0.7 },
    { d: E(94, HEAD_Y + 7, 7, 11), f: mix(P.skin, P.cheek, 0.4), fx: 't', k: false, o: 0.7 },
    // face
    { d: smooth([[0, -388], [62, -378], [96, -330], [96, -280], [80, -232], [40, -208], [0, -204], [-40, -208], [-80, -232], [-96, -280], [-96, -330], [-62, -378]], true, 0.95), f: P.skin },
    // soft shading under hair / side
    { d: smooth([[66, -324], [92, -304], [88, -262], [72, -236], [82, -282]]), f: shade(P.skin, 0.2), fx: 't', k: false, o: 0.18 },
    // cheeks
    { d: E(-58, -258, 19, 13), f: P.cheek, fx: 't', k: false, o: 0.55 },
    { d: E(58, -258, 19, 13), f: P.cheek, fx: 't', k: false, o: 0.55 },
    // nose
    { d: smooth([[-6, -276], [0, -270], [7, -276]], false), k: A.inkOf(P.skin), sw: 2.6, f: null },
    // hair
    { d: smooth([[-100, -300], [-104, -340], [-82, -382], [-40, -402], [10, -404], [58, -394], [94, -362], [104, -318], [98, -296], [86, -318], [80, -338], [60, -336], [44, -346], [26, -334], [6, -346], [-14, -334], [-32, -346], [-52, -334], [-70, -340], [-84, -320], [-92, -296]], true, 0.8), f: P.hair },
    { d: smooth([[4, -400], [16, -420], [34, -424], [24, -410], [20, -398]], true, 0.8), f: P.hair },
    { d: smooth([[-60, -388], [-20, -396], [30, -392], [10, -380], [-40, -378]]), f: tint(P.hair, 0.45), fx: 't', k: false, o: 0.6 },
  ]);

  // --- face features (all relative to head) ---
  const EY = -293, EX = 34;
  const eyePair = (rx, ry, extra = []) => [
    { d: E(-EX, EY, rx, ry), f: P.eyes, fx: 'ws', sw: 1.6 },
    { d: E(EX, EY, rx, ry), f: P.eyes, fx: 'ws', sw: 1.6 },
    { d: C(-EX - 4, EY - 6, rx * 0.38), f: W, fx: 'flat', k: false },
    { d: C(EX - 4, EY - 6, rx * 0.38), f: W, fx: 'flat', k: false },
    { d: C(-EX + 4, EY + 5, rx * 0.17), f: W, fx: 'flat', k: false },
    { d: C(EX + 4, EY + 5, rx * 0.17), f: W, fx: 'flat', k: false },
    ...extra,
  ];
  const brows = (dy = 0, tilt = 0) => [
    { d: line([[-EX - 14, EY - 30 + dy + tilt], [-EX, EY - 34 + dy], [-EX + 13, EY - 31 + dy - tilt]]), k: shade(P.hair, 0.3), sw: 4, f: null },
    { d: line([[EX - 13, EY - 31 + dy - tilt], [EX, EY - 34 + dy], [EX + 14, EY - 30 + dy + tilt]]), k: shade(P.hair, 0.3), sw: 4, f: null },
  ];
  const FB = [-70, -340, 140, 80];
  A.define('at_eyes_open', FB, () => [eyePair(11.5, 15), brows()]);
  A.define('at_eyes_wide', FB, () => [eyePair(14, 18), brows(-8)]);
  A.define('at_eyes_worry', FB, () => [eyePair(11.5, 15), brows(-4, -7)]);
  A.define('at_eyes_blink', FB, () => [
    { d: line([[-EX - 12, EY + 1], [-EX, EY + 6], [-EX + 12, EY + 1]]), k: P.eyes, sw: 5.2, kf: 'ke', f: null },
    { d: line([[EX - 12, EY + 1], [EX, EY + 6], [EX + 12, EY + 1]]), k: P.eyes, sw: 5.2, kf: 'ke', f: null },
    brows(),
  ]);
  A.define('at_eyes_happy', FB, () => [
    { d: line([[-EX - 13, EY + 4], [-EX, EY - 8], [-EX + 13, EY + 4]]), k: P.eyes, sw: 6.0, kf: 'ke', f: null },
    { d: line([[EX - 13, EY + 4], [EX, EY - 8], [EX + 13, EY + 4]]), k: P.eyes, sw: 6.0, kf: 'ke', f: null },
    brows(-4),
  ]);
  A.define('at_eyes_squeeze', FB, () => [
    { d: line([[-EX - 12, EY - 7], [-EX + 8, EY], [-EX - 12, EY + 7]]), k: P.eyes, sw: 5.7, kf: 'ke', f: null },
    { d: line([[EX + 12, EY - 7], [EX - 8, EY], [EX + 12, EY + 7]]), k: P.eyes, sw: 5.7, kf: 'ke', f: null },
    brows(2, -6),
  ]);
  const MB = [-50, -275, 100, 62];
  const MY = -246;
  const lipInk = mix(P.skin, '#7a2a2a', 0.7);
  A.define('at_mouth_smile', MB, () => [
    { d: line([[-20, MY - 4], [0, MY + 7], [20, MY - 4]]), k: lipInk, sw: 3.6, f: null },
  ]);
  A.define('at_mouth_grin', MB, () => [
    { d: smooth([[-26, MY - 8], [26, MY - 8], [18, MY + 12], [0, MY + 18], [-18, MY + 12]], true, 0.7), f: '#9c2f37', fx: 'ws', k: lipInk, sw: 2.6 },
    { d: smooth([[-12, MY + 12], [0, MY + 7], [12, MY + 12], [0, MY + 16]], true), f: '#ef7f8a', fx: 'flat', k: false },
    { d: R(-18, MY - 8, 36, 7, 3), f: W, fx: 'flat', k: false },
  ]);
  A.define('at_mouth_o', MB, () => [
    { d: E(0, MY + 2, 9, 11), f: '#9c2f37', fx: 'ws', k: lipInk, sw: 2.6 },
  ]);
  A.define('at_mouth_wobble', MB, () => [
    { d: line([[-20, MY + 3], [-10, MY - 2], [0, MY + 3], [10, MY - 2], [20, MY + 3]]), k: lipInk, sw: 3.4, f: null },
  ]);
  A.define('at_mouth_ahh', MB, () => [
    { d: smooth([[-24, MY - 10], [0, MY - 13], [24, MY - 10], [20, MY + 14], [0, MY + 22], [-20, MY + 14]], true, 0.8), f: '#8e2a33', fx: 'ws', k: lipInk, sw: 2.6 },
    { d: smooth([[-14, MY + 14], [0, MY + 6], [14, MY + 14], [0, MY + 20]], true), f: '#ef7f8a', fx: 'flat', k: false },
    { d: R(-17, MY - 11, 34, 7, 3), f: W, fx: 'flat', k: false },
  ]);
  A.define('at_mouth_flat', MB, () => [
    { d: line([[-12, MY + 1], [12, MY + 1]]), k: lipInk, sw: 3.6, f: null },
  ]);
  A.define('at_mouth_puff', MB, () => [
    { d: line([[-10, MY + 2], [10, MY + 2]]), k: lipInk, sw: 3.6, f: null },
    { d: E(-44, MY - 4, 16, 12), f: P.cheek, fx: 't', k: false, o: 0.6 },
    { d: E(44, MY - 4, 16, 12), f: P.cheek, fx: 't', k: false, o: 0.6 },
  ]);

  // sitting legs (on the potty), shorts around the ankles
  A.define('at_sitLegs', [-92, -96, 184, 100], () => [
    { d: R(-56, -70, 34, 56, 14), f: P.skin },
    { d: R(22, -70, 34, 56, 14), f: P.skin },
    { d: E(-40, -70, 30, 24), f: P.skin },
    { d: E(40, -70, 30, 24), f: P.skin },
    { d: smooth([[-74, -32], [-30, -38], [0, -34], [30, -38], [74, -32], [76, -16], [40, -10], [0, -14], [-40, -10], [-76, -16]], true, 0.7), f: P.shorts },
    { d: smooth([[-64, -14], [-22, -16], [-16, -2], [-30, 2], [-70, 1], [-76, -8]]), f: P.shoes },
    { d: smooth([[64, -14], [22, -16], [16, -2], [30, 2], [70, 1], [76, -8]]), f: P.shoes },
  ]);

  // ===================== MAMA (waist up) =====================
  const mamaFace = (cx, cy) => smooth([[cx, cy - 78], [cx + 50, cy - 66], [cx + 64, cy - 20], [cx + 56, cy + 30], [cx + 30, cy + 64], [cx, cy + 74], [cx - 30, cy + 64], [cx - 56, cy + 30], [cx - 64, cy - 20], [cx - 50, cy - 66]], true, 0.95);
  const MHY = -300;
  A.define('mm_hairBack', [-130, -400, 260, 260], () => [
    { d: smooth([[-80, -360], [-40, -392], [40, -392], [80, -360], [100, -290], [110, -220], [120, -170], [80, -160], [40, -176], [-40, -176], [-80, -160], [-120, -170], [-110, -220], [-100, -290]], true, 0.8), f: P.mamaHair },
  ]);
  A.define('mm_body', [-120, -240, 240, 250], () => [
    { d: R(-20, -236, 40, 40, 12), f: P.mamaSkin, k: false },
    { d: smooth([[-90, -200], [-40, -214], [0, -196], [40, -214], [90, -200], [96, -120], [86, -40], [84, 0], [-84, 0], [-86, -40], [-96, -120]], true, 0.55), f: P.mamaTop },
    { d: smooth([[-30, -212], [0, -184], [30, -212]], false), k: shade(P.mamaTop, 0.4), sw: 3, f: null },
    { d: smooth([[-30, -212], [0, -184], [30, -212], [0, -206]]), f: P.mamaSkin, fx: 'ws', k: false },
    // little flowers on the top
    ...[[-50, -140], [36, -100], [-20, -60], [56, -160], [-60, -30], [20, -150]].map(([x, y]) => ({ d: A.fluff(x, y, 9, 9, 5, x + y, 0.4), f: tint(P.mamaTop, 0.6), fx: 'ws', k: false })),
    { d: smooth([[40, -200], [88, -196], [92, -120], [84, -20], [56, -10], [70, -110]]), f: shade(P.mamaTop, 0.35), fx: 't', k: false, o: 0.5 },
  ]);
  const mamaArm = (s) => () => [
    { d: smooth([[78 * s, -196], [100 * s, -194], [120 * s, -140], [126 * s, -80], [124 * s, -40], [106 * s, -38], [104 * s, -84], [96 * s, -140], [80 * s, -170]], true, 0.7), f: P.mamaSkin },
    { d: E(116 * s, -30, 18, 20), f: P.mamaSkin },
    { d: smooth([[70 * s, -210], [96 * s, -208], [118 * s, -170], [124 * s, -128], [96 * s, -122], [78 * s, -160]], true, 0.6), f: P.mamaTop },
  ];
  A.define('mm_armL', [-150, -226, 100, 220], mamaArm(-1));
  A.define('mm_armR', [50, -226, 100, 220], mamaArm(1));
  A.define('mm_head', [-90, -390, 180, 180], () => [
    { d: E(-62, MHY + 6, 11, 16), f: P.mamaSkin },
    { d: E(62, MHY + 6, 11, 16), f: P.mamaSkin },
    { d: C(-62, MHY + 26, 5), f: P.shirtStar, fx: 'ws', sw: 1.6 },
    { d: C(62, MHY + 26, 5), f: P.shirtStar, fx: 'ws', sw: 1.6 },
    { d: mamaFace(0, MHY), f: P.mamaSkin },
    { d: E(-34, MHY + 28, 14, 9), f: P.cheek, fx: 't', k: false, o: 0.5 },
    { d: E(34, MHY + 28, 14, 9), f: P.cheek, fx: 't', k: false, o: 0.5 },
    { d: smooth([[-4, MHY + 4], [-6, MHY + 18], [3, MHY + 20]], false), k: A.inkOf(P.mamaSkin), sw: 2.4, f: null },
    // fringe / top hair
    { d: smooth([[-70, MHY + 10], [-72, MHY - 40], [-50, MHY - 78], [0, MHY - 92], [50, MHY - 80], [72, MHY - 40], [70, MHY + 10], [60, MHY - 30], [30, MHY - 56], [0, MHY - 50], [-20, MHY - 62], [-50, MHY - 40], [-62, MHY - 10]], true, 0.85), f: P.mamaHair },
    { d: smooth([[-40, MHY - 80], [10, MHY - 88], [-10, MHY - 74]]), f: tint(P.mamaHair, 0.4), fx: 't', k: false, o: 0.6 },
  ]);
  const MEY = MHY - 2, MEX = 25;
  const mmEyes = (ry) => [
    { d: E(-MEX, MEY, 8, ry), f: P.eyes, fx: 'ws', sw: 1.4 },
    { d: E(MEX, MEY, 8, ry), f: P.eyes, fx: 'ws', sw: 1.4 },
    { d: C(-MEX - 3, MEY - 4, 3), f: W, fx: 'flat', k: false },
    { d: C(MEX - 3, MEY - 4, 3), f: W, fx: 'flat', k: false },
    { d: line([[-MEX - 11, MEY - 6], [-MEX - 16, MEY - 11]]), k: P.eyes, sw: 3.1, kf: 'ke', f: null },
    { d: line([[MEX + 11, MEY - 6], [MEX + 16, MEY - 11]]), k: P.eyes, sw: 3.1, kf: 'ke', f: null },
    { d: line([[-MEX - 10, MEY - 22], [-MEX, MEY - 26], [-MEX + 10, MEY - 23]]), k: shade(P.mamaHair, 0.2), sw: 3, f: null },
    { d: line([[MEX - 10, MEY - 23], [MEX, MEY - 26], [MEX + 10, MEY - 22]]), k: shade(P.mamaHair, 0.2), sw: 3, f: null },
  ];
  const MFB = [-56, -336, 112, 60];
  A.define('mm_eyes_open', MFB, () => mmEyes(11));
  A.define('mm_eyes_happy', MFB, () => [
    { d: line([[-MEX - 10, MEY + 3], [-MEX, MEY - 6], [-MEX + 10, MEY + 3]]), k: P.eyes, sw: 4.7, kf: 'ke', f: null },
    { d: line([[MEX - 10, MEY + 3], [MEX, MEY - 6], [MEX + 10, MEY + 3]]), k: P.eyes, sw: 4.7, kf: 'ke', f: null },
    { d: line([[-MEX - 10, MEY - 22], [-MEX, MEY - 28], [-MEX + 10, MEY - 24]]), k: shade(P.mamaHair, 0.2), sw: 3, f: null },
    { d: line([[MEX - 10, MEY - 24], [MEX, MEY - 28], [MEX + 10, MEY - 22]]), k: shade(P.mamaHair, 0.2), sw: 3, f: null },
  ]);
  A.define('mm_eyes_blink', MFB, () => [
    { d: line([[-MEX - 9, MEY], [-MEX, MEY + 4], [-MEX + 9, MEY]]), k: P.eyes, sw: 3.9, kf: 'ke', f: null },
    { d: line([[MEX - 9, MEY], [MEX, MEY + 4], [MEX + 9, MEY]]), k: P.eyes, sw: 3.9, kf: 'ke', f: null },
  ]);
  const MMY = MHY + 44;
  const MMB = [-40, MMY - 24, 80, 50];
  A.define('mm_mouth_smile', MMB, () => [
    { d: smooth([[-18, MMY - 4], [0, MMY + 8], [18, MMY - 4], [0, MMY + 2]], true, 0.8), f: P.mamaLips, fx: 'ws', k: A.inkOf(P.mamaLips), sw: 2 },
  ]);
  A.define('mm_mouth_laugh', MMB, () => [
    { d: smooth([[-22, MMY - 6], [22, MMY - 6], [14, MMY + 12], [0, MMY + 17], [-14, MMY + 12]], true, 0.7), f: '#9c2f37', fx: 'ws', k: A.inkOf(P.mamaLips), sw: 2.4 },
    { d: R(-15, MMY - 6, 30, 6, 3), f: W, fx: 'flat', k: false },
    { d: smooth([[-9, MMY + 11], [0, MMY + 7], [9, MMY + 11], [0, MMY + 15]], true), f: '#ef7f8a', fx: 'flat', k: false },
  ]);
  A.define('mm_mouth_o', MMB, () => [
    { d: E(0, MMY + 2, 8, 10), f: '#9c2f37', fx: 'ws', k: A.inkOf(P.mamaLips), sw: 2.4 },
  ]);

  // ===================== DADA (waist up) =====================
  const DHY = -310;
  A.define('dd_body', [-136, -250, 272, 260], () => [
    { d: R(-24, -246, 48, 44, 14), f: P.dadaSkin, k: false },
    { d: smooth([[-104, -206], [-44, -222], [0, -212], [44, -222], [104, -206], [108, -120], [96, -40], [94, 0], [-94, 0], [-96, -40], [-108, -120]], true, 0.55), f: P.dadaTop },
    // collar
    { d: smooth([[-40, -222], [-6, -196], [-18, -180], [-44, -210]]), f: tint(P.dadaTop, 0.25), fx: 'ws', sw: 2.4 },
    { d: smooth([[40, -222], [6, -196], [18, -180], [44, -210]]), f: tint(P.dadaTop, 0.25), fx: 'ws', sw: 2.4 },
    { d: line([[0, -196], [0, 0]]), k: shade(P.dadaTop, 0.35), sw: 2.4, f: null },
    ...[-150, -110, -70, -30].map((y) => ({ d: C(8, y, 4), f: W, fx: 'flat', k: shade(P.dadaTop, 0.4), sw: 1.6 })),
    { d: smooth([[50, -210], [102, -204], [104, -120], [94, -20], [64, -10], [80, -110]]), f: shade(P.dadaTop, 0.35), fx: 't', k: false, o: 0.5 },
  ]);
  const dadaArm = (s) => () => [
    { d: smooth([[88 * s, -204], [114 * s, -200], [134 * s, -140], [138 * s, -80], [136 * s, -40], [116 * s, -38], [114 * s, -84], [106 * s, -140], [90 * s, -170]], true, 0.7), f: P.dadaSkin },
    { d: E(127 * s, -30, 20, 22), f: P.dadaSkin },
    { d: smooth([[80 * s, -218], [110 * s, -214], [134 * s, -168], [140 * s, -112], [108 * s, -106], [90 * s, -160]], true, 0.6), f: P.dadaTop },
  ];
  A.define('dd_armL', [-166, -236, 110, 230], dadaArm(-1));
  A.define('dd_armR', [56, -236, 110, 230], dadaArm(1));
  A.define('dd_head', [-96, -406, 192, 196], () => [
    { d: E(-66, DHY + 6, 12, 17), f: P.dadaSkin },
    { d: E(66, DHY + 6, 12, 17), f: P.dadaSkin },
    { d: smooth([[0, DHY - 80], [52, DHY - 70], [68, DHY - 24], [64, DHY + 28], [44, DHY + 66], [0, DHY + 80], [-44, DHY + 66], [-64, DHY + 28], [-68, DHY - 24], [-52, DHY - 70]], true, 0.9), f: P.dadaSkin },
    // beard
    { d: smooth([[-64, DHY + 10], [-56, DHY + 50], [-30, DHY + 76], [0, DHY + 84], [30, DHY + 76], [56, DHY + 50], [64, DHY + 10], [48, DHY + 30], [24, DHY + 36], [0, DHY + 32], [-24, DHY + 36], [-48, DHY + 30]], true, 0.8), f: mix(P.dadaHair, P.dadaSkin, 0.55), fx: 't', k: false, o: 0.55 },
    { d: E(-36, DHY + 22, 13, 8), f: P.cheek, fx: 't', k: false, o: 0.4 },
    { d: E(36, DHY + 22, 13, 8), f: P.cheek, fx: 't', k: false, o: 0.4 },
    { d: smooth([[-5, DHY + 2], [-8, DHY + 18], [4, DHY + 20]], false), k: A.inkOf(P.dadaSkin), sw: 2.6, f: null },
    // hair
    { d: smooth([[-70, DHY - 10], [-74, DHY - 50], [-48, DHY - 88], [0, DHY - 98], [52, DHY - 88], [76, DHY - 50], [70, DHY - 10], [62, DHY - 40], [40, DHY - 58], [10, DHY - 52], [-20, DHY - 62], [-50, DHY - 50], [-62, DHY - 30]], true, 0.85), f: P.dadaHair },
    // glasses
    { d: C(-26, DHY - 4, 20), f: 'none', k: '#4a3a5a', sw: 3.4 },
    { d: C(26, DHY - 4, 20), f: 'none', k: '#4a3a5a', sw: 3.4 },
    { d: line([[-7, DHY - 6], [7, DHY - 6]]), k: '#4a3a5a', sw: 3, f: null },
  ]);
  const DEY = DHY - 4, DEX = 26;
  const DFB = [-56, -350, 112, 60];
  A.define('dd_eyes_open', DFB, () => [
    { d: E(-DEX, DEY, 7, 9.5), f: P.eyes, fx: 'ws', sw: 1.4 },
    { d: E(DEX, DEY, 7, 9.5), f: P.eyes, fx: 'ws', sw: 1.4 },
    { d: C(-DEX - 2.5, DEY - 3, 2.6), f: W, fx: 'flat', k: false },
    { d: C(DEX - 2.5, DEY - 3, 2.6), f: W, fx: 'flat', k: false },
    { d: line([[-DEX - 12, DEY - 26], [-DEX, DEY - 30], [-DEX + 12, DEY - 27]]), k: P.dadaHair, sw: 4.4, f: null },
    { d: line([[DEX - 12, DEY - 27], [DEX, DEY - 30], [DEX + 12, DEY - 26]]), k: P.dadaHair, sw: 4.4, f: null },
  ]);
  A.define('dd_eyes_happy', DFB, () => [
    { d: line([[-DEX - 9, DEY + 3], [-DEX, DEY - 5], [-DEX + 9, DEY + 3]]), k: P.eyes, sw: 4.4, kf: 'ke', f: null },
    { d: line([[DEX - 9, DEY + 3], [DEX, DEY - 5], [DEX + 9, DEY + 3]]), k: P.eyes, sw: 4.4, kf: 'ke', f: null },
    { d: line([[-DEX - 12, DEY - 28], [-DEX, DEY - 33], [-DEX + 12, DEY - 29]]), k: P.dadaHair, sw: 4.4, f: null },
    { d: line([[DEX - 12, DEY - 29], [DEX, DEY - 33], [DEX + 12, DEY - 28]]), k: P.dadaHair, sw: 4.4, f: null },
  ]);
  A.define('dd_eyes_blink', DFB, () => [
    { d: line([[-DEX - 8, DEY], [-DEX, DEY + 4], [-DEX + 8, DEY]]), k: P.eyes, sw: 3.9, kf: 'ke', f: null },
    { d: line([[DEX - 8, DEY], [DEX, DEY + 4], [DEX + 8, DEY]]), k: P.eyes, sw: 3.9, kf: 'ke', f: null },
    { d: line([[-DEX - 12, DEY - 26], [-DEX, DEY - 30], [-DEX + 12, DEY - 27]]), k: P.dadaHair, sw: 4.4, f: null },
    { d: line([[DEX - 12, DEY - 27], [DEX, DEY - 30], [DEX + 12, DEY - 26]]), k: P.dadaHair, sw: 4.4, f: null },
  ]);
  const DMY = DHY + 42;
  const DMB = [-40, DMY - 24, 80, 50];
  const dLip = '#9a3a3a';
  A.define('dd_mouth_smile', DMB, () => [
    { d: line([[-20, DMY - 3], [0, DMY + 8], [20, DMY - 3]]), k: dLip, sw: 3.6, f: null },
  ]);
  A.define('dd_mouth_laugh', DMB, () => [
    { d: smooth([[-24, DMY - 6], [24, DMY - 6], [16, DMY + 13], [0, DMY + 18], [-16, DMY + 13]], true, 0.7), f: '#8e2a33', fx: 'ws', k: dLip, sw: 2.4 },
    { d: R(-17, DMY - 6, 34, 6, 3), f: W, fx: 'flat', k: false },
    { d: smooth([[-9, DMY + 12], [0, DMY + 8], [9, DMY + 12], [0, DMY + 16]], true), f: '#ef7f8a', fx: 'flat', k: false },
  ]);
  A.define('dd_mouth_o', DMB, () => [
    { d: E(0, DMY + 2, 8, 10), f: '#8e2a33', fx: 'ws', k: dLip, sw: 2.4 },
  ]);

  // ===================== BABY SISTER (sitting) =====================
  const BHY = -205;
  A.define('bb_body', [-110, -160, 220, 166], () => [
    // legs out in front
    { d: smooth([[-40, -40], [-86, -34], [-100, -14], [-90, 2], [-50, 0], [-20, -10]], true, 0.7), f: P.babyRomper },
    { d: smooth([[40, -40], [86, -34], [100, -14], [90, 2], [50, 0], [20, -10]], true, 0.7), f: P.babyRomper },
    { d: E(-96, -12, 15, 14), f: P.babySkin },
    { d: E(96, -12, 15, 14), f: P.babySkin },
    // round body
    { d: smooth([[-40, -150], [40, -150], [66, -96], [70, -40], [40, -8], [0, -4], [-40, -8], [-70, -40], [-66, -96]], true, 0.9), f: P.babyRomper },
    { d: smooth([[-24, -150], [0, -134], [24, -150], [0, -142]]), f: W, fx: 'ws', sw: 2 },
    { d: A.heart(0, -84, 18), f: tint(P.babyRomper, 0.55), fx: 'ws', sw: 2 },
    { d: smooth([[30, -140], [62, -96], [66, -44], [40, -14], [50, -80]]), f: shade(P.babyRomper, 0.3), fx: 't', k: false, o: 0.45 },
  ]);
  const babyArm = (s) => () => [
    { d: smooth([[34 * s, -148], [56 * s, -144], [74 * s, -110], [80 * s, -90], [62 * s, -84], [50 * s, -112], [38 * s, -130]], true, 0.7), f: P.babyRomper },
    { d: C(72 * s, -84, 14), f: P.babySkin },
  ];
  A.define('bb_armL', [-100, -160, 76, 96], babyArm(-1));
  A.define('bb_armR', [24, -160, 76, 96], babyArm(1));
  A.define('bb_head', [-84, -290, 168, 150], () => [
    { d: E(-62, BHY + 8, 12, 15), f: P.babySkin },
    { d: E(62, BHY + 8, 12, 15), f: P.babySkin },
    { d: smooth([[0, BHY - 66], [50, BHY - 56], [66, BHY - 10], [58, BHY + 34], [30, BHY + 58], [0, BHY + 62], [-30, BHY + 58], [-58, BHY + 34], [-66, BHY - 10], [-50, BHY - 56]], true, 0.95), f: P.babySkin },
    { d: E(-38, BHY + 24, 15, 10), f: P.cheek, fx: 't', k: false, o: 0.6 },
    { d: E(38, BHY + 24, 15, 10), f: P.cheek, fx: 't', k: false, o: 0.6 },
    { d: smooth([[-4, BHY + 8], [0, BHY + 13], [5, BHY + 8]], false), k: A.inkOf(P.babySkin), sw: 2.2, f: null },
    // little curl of hair
    { d: smooth([[-30, BHY - 58], [-10, BHY - 70], [12, BHY - 68], [30, BHY - 58], [10, BHY - 60], [-10, BHY - 58]], true, 0.8), f: P.babyHair, o: 0.9 },
    { d: smooth([[-4, BHY - 64], [2, BHY - 84], [16, BHY - 86], [20, BHY - 76], [10, BHY - 72], [8, BHY - 66]], true, 0.9), f: P.babyHair },
    // bow
    { d: smooth([[30, BHY - 60], [52, BHY - 72], [56, BHY - 52], [36, BHY - 52]], true, 0.7), f: P.babyBow, sw: 2.4 },
    { d: smooth([[30, BHY - 56], [16, BHY - 44], [34, BHY - 36], [38, BHY - 50]], true, 0.7), f: P.babyBow, sw: 2.4 },
  ]);
  const BEY = BHY - 4, BEX = 24;
  const BFB = [-50, -236, 100, 50];
  A.define('bb_eyes_open', BFB, () => [
    { d: E(-BEX, BEY, 8, 10), f: P.eyes, fx: 'ws', sw: 1.4 },
    { d: E(BEX, BEY, 8, 10), f: P.eyes, fx: 'ws', sw: 1.4 },
    { d: C(-BEX - 3, BEY - 4, 3.2), f: W, fx: 'flat', k: false },
    { d: C(BEX - 3, BEY - 4, 3.2), f: W, fx: 'flat', k: false },
  ]);
  A.define('bb_eyes_happy', BFB, () => [
    { d: line([[-BEX - 9, BEY + 3], [-BEX, BEY - 5], [-BEX + 9, BEY + 3]]), k: P.eyes, sw: 4.4, kf: 'ke', f: null },
    { d: line([[BEX - 9, BEY + 3], [BEX, BEY - 5], [BEX + 9, BEY + 3]]), k: P.eyes, sw: 4.4, kf: 'ke', f: null },
  ]);
  A.define('bb_eyes_closed', BFB, () => [
    { d: line([[-BEX - 9, BEY], [-BEX, BEY + 5], [-BEX + 9, BEY]]), k: P.eyes, sw: 3.9, kf: 'ke', f: null },
    { d: line([[BEX - 9, BEY], [BEX, BEY + 5], [BEX + 9, BEY]]), k: P.eyes, sw: 3.9, kf: 'ke', f: null },
  ]);
  A.define('bb_eyes_cry', BFB, () => [
    { d: line([[-BEX - 10, BEY - 4], [-BEX + 6, BEY + 1], [-BEX - 10, BEY + 6]]), k: P.eyes, sw: 4.4, kf: 'ke', f: null },
    { d: line([[BEX + 10, BEY - 4], [BEX - 6, BEY + 1], [BEX + 10, BEY + 6]]), k: P.eyes, sw: 4.4, kf: 'ke', f: null },
  ]);
  A.define('bb_eyes_sleepy', BFB, () => [
    { d: E(-BEX, BEY + 3, 8, 5), f: P.eyes, fx: 'ws', sw: 1.4 },
    { d: E(BEX, BEY + 3, 8, 5), f: P.eyes, fx: 'ws', sw: 1.4 },
    { d: line([[-BEX - 10, BEY], [-BEX + 10, BEY]]), k: P.eyes, sw: 3.4, kf: 'ke', f: null },
    { d: line([[BEX - 10, BEY], [BEX + 10, BEY]]), k: P.eyes, sw: 3.4, kf: 'ke', f: null },
  ]);
  const BMY = BHY + 32;
  const BMB = [-34, BMY - 20, 68, 44];
  const bLip = mix(P.babySkin, '#8a2a3a', 0.7);
  A.define('bb_mouth_smile', BMB, () => [
    { d: line([[-12, BMY - 2], [0, BMY + 6], [12, BMY - 2]]), k: bLip, sw: 3.2, f: null },
  ]);
  A.define('bb_mouth_giggle', BMB, () => [
    { d: smooth([[-16, BMY - 5], [16, BMY - 5], [10, BMY + 9], [0, BMY + 13], [-10, BMY + 9]], true, 0.7), f: '#a03040', fx: 'ws', k: bLip, sw: 2.2 },
    { d: smooth([[-7, BMY + 8], [0, BMY + 5], [7, BMY + 8], [0, BMY + 11]], true), f: '#f08a96', fx: 'flat', k: false },
  ]);
  A.define('bb_mouth_cry', BMB, () => [
    { d: smooth([[-16, BMY + 2], [0, BMY - 8], [16, BMY + 2], [12, BMY + 14], [0, BMY + 17], [-12, BMY + 14]], true, 0.8), f: '#a03040', fx: 'ws', k: bLip, sw: 2.2 },
  ]);
  A.define('bb_mouth_o', BMB, () => [
    { d: E(0, BMY + 2, 7, 8), f: '#a03040', fx: 'ws', k: bLip, sw: 2.2 },
  ]);
  A.define('bb_mouth_pout', BMB, () => [
    { d: line([[-10, BMY + 4], [0, BMY - 1], [10, BMY + 4]]), k: bLip, sw: 3.2, f: null },
  ]);
  A.define('bb_tears', [-60, -220, 120, 70], () => [
    { d: smooth([[-34, -196], [-28, -180], [-34, -170], [-40, -180]], true, 0.8), f: '#8fd0f4', fx: 'ws', k: '#4b9cd0', sw: 1.8 },
    { d: smooth([[34, -196], [40, -180], [34, -170], [28, -180]], true, 0.8), f: '#8fd0f4', fx: 'ws', k: '#4b9cd0', sw: 1.8 },
    { d: smooth([[-44, -172], [-40, -160], [-44, -154], [-48, -160]], true, 0.8), f: '#8fd0f4', fx: 'ws', k: '#4b9cd0', sw: 1.6 },
    { d: smooth([[44, -172], [48, -160], [44, -154], [40, -160]], true, 0.8), f: '#8fd0f4', fx: 'ws', k: '#4b9cd0', sw: 1.6 },
  ]);
})();
