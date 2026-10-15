// Layout of the sprite gallery pages, shared by gallery.html (browser) and
// gallery.spec.mjs (Node, to create one test per page).
//
// Sets:
//   sprites-NN  every sprite at scale 1 (its natural size)
//   stage-NN    the full-stage sprites (backgrounds, mouth close-up, hedge,
//               table, bunting) at scale 0.5, i.e. one device pixel per
//               sprite pixel at deviceScaleFactor 2. They are also checked at
//               full in-game density in the scene frames (scenes.spec.mjs).
//   scaled-NN   sprites at the largest scale the game ever shows them, where
//               any loss of resolution would show first.
export const PAGE_W = 1640; // two half-scale backgrounds side by side
export const PAGE_MAX_H = 1100;
export const GAP = 10;
export const FULL_STAGE_W = 1500;

export const SCALED = [
  ['sink', 2.6], ['water', 2.4], ['soap', 1.6], ['toothbrush', 2], ['paste_tube', 1.4],
  ['star', 2], ['badge_potty', 1.6], ['rays', 2.4], ['trophy', 1.3],
];
export const BABY_SCALE = 1.15; // baby scene: every bb_* part

// First-fit decreasing height: items arrive tallest first; each goes into the
// first row (on any page) with room left, else a new row on the first page
// with room, else a new page. items: [{id, s, w, h}] (w/h already scaled)
function pack(prefix, items) {
  const pages = [];
  const place = (page, row, it) => {
    page.cells.push({ id: it.id, s: it.s, x: row.x, y: row.y, w: it.w, h: it.h });
    row.x += it.w + GAP;
  };
  for (const it of items) {
    let done = false;
    for (const page of pages) {
      const row = page.rows.find((r) => it.h <= r.h && r.x + it.w + GAP <= PAGE_W);
      if (row) { place(page, row, it); done = true; break; }
    }
    if (done) continue;
    let page = pages.find((pg) => pg.height + it.h + GAP <= PAGE_MAX_H);
    if (!page) {
      page = { name: `${prefix}-${String(pages.length + 1).padStart(2, '0')}`, width: PAGE_W, height: GAP, cells: [], rows: [] };
      pages.push(page);
    }
    const row = { x: GAP, y: page.height, h: it.h };
    page.rows.push(row);
    page.height += it.h + GAP;
    place(page, row, it);
  }
  return pages.map(({ rows, ...p }) => p);
}

/**
 * @param {string[]} ids   AT.art.list()
 * @param {(id:string)=>number[]} boxOf  AT.art.box
 */
export function galleryPages(ids, boxOf) {
  const sorted = [...ids].sort();
  const item = (id, s) => { const b = boxOf(id); return { id, s, w: Math.ceil(b[2] * s), h: Math.ceil(b[3] * s) }; };
  const byHeight = (a, b) => b.h - a.h || a.id.localeCompare(b.id);
  const isFull = (id) => boxOf(id)[2] >= FULL_STAGE_W;
  const normal = sorted.filter((id) => !isFull(id)).map((id) => item(id, 1)).sort(byHeight);
  const full = sorted.filter(isFull).map((id) => item(id, 0.5)).sort(byHeight);
  const scaled = [...SCALED.filter(([id]) => ids.includes(id)), ...sorted.filter((id) => id.startsWith('bb_')).map((id) => [id, BABY_SCALE])]
    .map(([id, s]) => item(id, s)).sort(byHeight);
  return [...pack('sprites', normal), ...pack('stage', full), ...pack('scaled', scaled)];
}
