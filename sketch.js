'use strict';
// =====================================================================
// "the fern synthesizer: create unique fern fronds"
// =====================================================================

// ---- boring constants ----------------------------------------------
const SKETCH_WIDTH   = 600;
const SKETCH_HEIGHT  = 700;
const PREVIEW_HEIGHT = SKETCH_HEIGHT + 100; // additional height for parameter display
const FROND_LENGTH   = SKETCH_HEIGHT - 40;
const MAX_PINNA_SIZE = 3; // controls recursion depth

// ---- the fun zone (default values; tweak with the keyboard) ---------------
const LEAF_SIZE  = 30;
const LEAF_SPACING = 7;
const SUBFROND_LENGTH_MULTIPLIER = 2.8;
const SUBFROND_DENSITY = 0.001;

const MAX_ANGLE = 85;       // 90: perpendicular to main stem
const SCALE_CURVE = 0.65;   // <1.0 concave curve, >1.0 convex curve
const LEAF_TO_SUBFROND_RATIO = 0.2;

const BENDINESS = 0.01;
const FROND_SPACING = 1.0;
const LEAFLET_SPACING = 0.45;

const STEM_THICKNESS = 4;

const CURVE_FORMULAS = {
  parabola:     (p) => 4 * p * (1 - p),                     // classic arch
  negParabola:  (p) => -(4.0 * p * (1.0 - p)),              // backwards
  sCurve:       (p) => Math.sin(Math.PI * p),
  cCurve:       (p) => Math.sin(Math.PI * p),
  tallS:        (p) => {
    const taper = 0.8;                                      // higher = bigger difference
    const scaleFactor = 0.5 + taper * p;
    return Math.sin(Math.PI * p) * scaleFactor;
  },
  doubleS:      (p) => Math.sin(Math.PI * p),
  asymmetricSSmooth: (p) => {
    const breakpoint = 0.7;
    const k = Math.log(0.5) / Math.log(breakpoint);
    return Math.sin(2 * Math.PI * Math.pow(p, k));
  },
  smoothSFlipped: (p) => {
    const breakpoint = 0.6;
    const k = Math.log(0.5) / Math.log(breakpoint);
    const mirroredP = 1.0 - p;
    return Math.sin(2.0 * Math.PI * Math.pow(mirroredP, k));
  },
  sineArch:     (p) => Math.sin(Math.PI * p),
};

// =====================================================================
// Leaflet drawing
// =====================================================================

function drawHeartLeaf(g, startingX, startingY, leafSize) {
  const leafWidth = leafSize * 0.5;
  const topY = -leafSize;
  const bellyY = -(leafSize * 0.35); // widest point down to 35% of the height
  const adjustedY = topY - 5;

  g.noFill();
  g.push();
  g.translate(startingX, startingY);
  g.beginShape();

  // 1. pointed bottom
  g.vertex(0, 0);

  // 2. left side curve going up
  g.bezierVertex(-leafWidth, bellyY, -(leafWidth / 2), adjustedY, 0, topY);

  // 3. right side curve going down
  g.bezierVertex(leafWidth / 2, adjustedY, leafWidth, bellyY, 0, 0);

  g.endShape(CLOSE);
  g.pop();
}

function drawOvalLeaf(g, startingX, startingY, leafSize) {
  const leafWidth = leafSize * 0.3;   // 0.8 for a wider shape
  const topY = -leafSize;
  const bellyY = -(leafSize * 0.35);

  g.noFill();
  g.push();
  g.translate(startingX, startingY);
  g.beginShape();

  g.vertex(0, 0);
  g.bezierVertex(-leafWidth, bellyY, -(leafWidth / 2), topY, 0, topY);
  g.bezierVertex(leafWidth / 2, topY, leafWidth, bellyY, 0, 0);

  g.endShape(CLOSE);
  g.pop();
}

// skinny leaf with organic pointed tip and flat bottom
function drawBladeLeaf(g, startingX, startingY, leafSize) {
  const leafWidth = leafSize * 0.15;
  const topY = -leafSize;
  const tipY = topY - leafSize * 0.1;  // lower the tip slightly to round it a lil
  const topCpX = leafWidth * 0.75;     // move the top control points out to bulge a lil

  g.noFill();
  g.push();
  g.translate(startingX, startingY);
  g.beginShape();

  // start at the bottom-left corner
  g.vertex(-leafWidth, 0);

  // left side curve up to the tip
  g.bezierVertex(-leafWidth, -(leafSize / 2), -topCpX, topY, 0, tipY);

  // right side curve back down to the bottom-right corner
  g.bezierVertex(topCpX, topY, leafWidth, -(leafSize / 2), leafWidth, 0);

  g.endShape(CLOSE);
  g.pop();
}

// skinny leaf with even edges, a curved tip, and an indented base
function drawSmoothLeaf(g, startingX, startingY, leafSize) {
  const leafWidth = leafSize * 0.12;
  const topY = -leafSize;
  const tipRoundness = leafSize * 0.12; // how far below the tip the control points sit
  const tipCpX = leafWidth * 0.4;       // tip control points stay on their OWN side
  const baseIndentY = leafSize * 0.05;  // how far down the base curves to create the indent

  g.noFill();
  g.push();
  g.translate(startingX, startingY);
  g.beginShape();

  // start at the bottom-left corner
  g.vertex(-leafWidth, 0);

  // left side up to the tip (CP1 directly above start, CP2 on the LEFT)
  g.bezierVertex(-leafWidth, -(leafSize / 2), -tipCpX, topY + tipRoundness, 0, topY);

  // right side back down (CP1 mirrors CP2, CP2 directly below the end)
  g.bezierVertex(tipCpX, topY + tipRoundness, leafWidth, -(leafSize / 2), leafWidth, 0);

  // base curve: draws inward before closing
  g.bezierVertex(leafWidth / 2, baseIndentY, -(leafWidth / 2), baseIndentY, -leafWidth, 0);

  g.endShape(CLOSE);
  g.pop();
}

const LEAF_SHAPES = {
  heart: drawHeartLeaf,
  oval: drawOvalLeaf,
  blade: drawBladeLeaf,
  smooth: drawSmoothLeaf,
};

const LEAF_ORDER = ['heart', 'oval', 'blade', 'smooth'];

// =====================================================================
// Fern drawing
// =====================================================================

function getSpacingRatio(depth, state) {
  return depth === 0 ? state.frondSpacing : state.leafletSpacing;
}

// attachment angle of leaflet/subfrond to stem. 90° -> horizontal, 0° -> vertical.
// exponent 0.3 = very flat (almost 90° until the very tip).
function angleAttrs(yProgress, state) {
  const exponent = 0.3;
  const maxAngle = state.maxAngle;
  const bottomFactor = Math.pow(1 - yProgress, exponent);
  const angleDeg = maxAngle * bottomFactor;
  const randomizedDeg = angleDeg + random(15);
  return Math.max(5, Math.min(maxAngle, randomizedDeg));
}

// bell-shaped envelope peaking at peakPos (0-1).
function smoothEnvelope(t, peakPos, risePower, fallPower) {
  if (t <= 0 || t >= 1 || peakPos === 0) return 0;
  const rise = Math.pow(Math.min(1.0, t / peakPos), risePower);
  const fall = Math.pow(Math.max(0.0, (1.0 - t) / (1.0 - peakPos)), fallPower);
  return Math.min(1.0, rise * fall);
}

// size via smooth bell curve; peak at ~25% from base (like real ferns).
function scaleAttrs(yProgress, leafSize, state) {
  const peakPosition = 0.25;              // peak closer to base
  const risePower = 0.5;                  // gradual rise from base
  const fallPower = state.scaleCurve;     // tip taper (global param)
  const envelope = smoothEnvelope(yProgress, peakPosition, risePower, fallPower);
  const scale = 0.08 + 2 * envelope;      // map envelope 0->1 to scale 0.08->2.0
  return { size: leafSize * scale, envelope };
}

// horizontal leaves (low angle) need more space to avoid overlap
function angleAwareSpacing(size, angleDeg, spacingRatio) {
  const angleFactor = 0.4 + 0.6 * Math.sin(radians(angleDeg));
  const computed = size * spacingRatio * angleFactor;
  return Math.max(2.0, computed);
}

function leafletAttrs(yProgress, leafSize, sr, state) {
  const sa = scaleAttrs(yProgress, leafSize, state);
  const angle = angleAttrs(yProgress, state);
  const spacing = angleAwareSpacing(sa.size, angle, sr);
  return { size: sa.size, angle, spacing, envelope: sa.envelope };
}

function inBounds(currentY, endY, direction) {
  return direction < 0 ? currentY > endY : currentY < endY;
}

function computeSegmentGeometry(i, startY, currentY, length, bend, leafSize, depth, sr, state, curveFn) {
  const distTraveled = Math.abs(startY - currentY);
  const progress = distTraveled / length;
  const curveX = bend * curveFn(progress);
  const attrs = leafletAttrs(progress, leafSize, sr, state);
  const leafRadians = radians(attrs.angle);
  const rotation = i % 2 === 0 ? leafRadians : -leafRadians;
  return { curveX, size: attrs.size, rotation, spacing: attrs.spacing };
}

function shouldRecurse(size, depth, state) {
  return size > state.maxPinnaSize && depth < 1;
}

function drawStemSegment(g, x1, y1, x2, y2, taper, state) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy; // perpendicular
  const py = ux;  // perpendicular
  const thickness = state.stemThickness * (1 - taper);
  const offsetX = 0.5 * thickness * px;
  const offsetY = 0.5 * thickness * py;

  // draw two parallel lines
  g.line(x1 + offsetX, y1 + offsetY, x2 + offsetX, y2 + offsetY);
  g.line(x1 - offsetX, y1 - offsetY, x2 - offsetX, y2 - offsetY);
}

function drawAttachment(g, x, y, rotation, size, depth, state) {
  g.push();
  g.translate(x, y);
  g.rotate(rotation);

  if (shouldRecurse(size, depth, state)) {
    const nextCurveDir = rotation > 0 ? 1 : -1;
    const spacingRatio = getSpacingRatio(depth + 1, state);
    const subfrondLen = size * state.subfrondLengthMultiplier;
    drawFrond(
      g,
      subfrondLen,                        // total length
      size * state.leafToSubfrondRatio,   // leaf-size
      size * state.subfrondDensity,       // base-spacing
      0,                                  // start-y
      -subfrondLen,                       // end-y
      -1,                                 // direction
      depth + 1,                          // depth
      nextCurveDir,
      spacingRatio,
      state
    );
  } else {
    const leafFn = LEAF_SHAPES[state.leafShape] || drawOvalLeaf;
    leafFn(g, 0, 0, size);
  }

  g.pop();
}

function drawFrond(g, length, leafSize, baseSpacing, startY, endY, direction, depth, curveDir, sr, state) {
  g.stroke(0);
  g.strokeWeight(1);

  const bend = depth === 0
    ? length * state.bendiness * curveDir
    : length * 0.08 * curveDir;
  const emptyStem = depth === 0 ? length * 0.1 : length * 0.09;
  const emptyStepSize = 5.0;

  // hard upper-limit for the loop counter to prevent infinite loops
  const emptyStemSteps = Math.floor(emptyStem / emptyStepSize);
  const maxLeavesBySpacing = Math.floor(length / baseSpacing);
  const minPixelsPerLeaf = 3.0;
  const maxLeavesBySize = Math.floor(length / minPixelsPerLeaf);
  const effectiveLoops = emptyStemSteps + Math.max(2, Math.min(maxLeavesBySpacing, maxLeavesBySize));
  const minLocalSpacing = 2;

  const curveFn = depth === 0
    ? CURVE_FORMULAS[state.stemCurve]
    : CURVE_FORMULAS[random(['sCurve', 'parabola'])];

  let i = 0;
  let currentY = startY + direction * emptyStepSize;
  let prevX = 0.0;
  let prevY = startY;

  while (i < effectiveLoops && inBounds(currentY, endY, direction)) {
    const distTraveled = Math.abs(startY - currentY);
    const { curveX, size, rotation, spacing } =
      computeSegmentGeometry(i, startY, currentY, length, bend, leafSize, depth, sr, state, curveFn);
    const localSpacing = Math.max(minLocalSpacing, spacing);
    const taper = i / (effectiveLoops - 1);

    // stem segment
    if (depth === 0) {
      drawStemSegment(g, prevX, prevY, curveX, currentY, taper, state);
    } else {
      g.line(prevX, prevY, curveX, currentY);
    }

    // leaf or subfrond
    if (distTraveled > emptyStem) {
      drawAttachment(g, curveX, currentY, rotation, size, depth, state);
      drawAttachment(g, curveX, currentY, -rotation, size, depth, state);
    }

    // next
    i += 1;
    prevX = curveX;
    prevY = currentY;
    currentY += direction * localSpacing;
  }
}

function drawFern(g, state) {
  const emergenceY = SKETCH_HEIGHT / 2; // 0 = center
  const frondLen = state.frondLength;
  const localState = { ...state, stemCurve: 'tallS' };

  g.push();
  g.translate(0, emergenceY);
  drawFrond(
    g,
    frondLen,
    state.leafSize,
    state.baseSpacing,
    0,
    -frondLen,
    -1,
    0,
    1,
    getSpacingRatio(0, localState),
    localState
  );
  g.pop();
}

// =====================================================================
// State / lifecycle
// =====================================================================
let state;
let fernG;

function makeState() {
  return {
    leafSize: LEAF_SIZE,
    baseSpacing: LEAF_SPACING,
    leafShape: 'blade',
    frondLength: FROND_LENGTH,
    maxPinnaSize: MAX_PINNA_SIZE,
    leafToSubfrondRatio: LEAF_TO_SUBFROND_RATIO,
    subfrondDensity: SUBFROND_DENSITY,
    frondSpacing: FROND_SPACING,
    leafletSpacing: LEAFLET_SPACING,
    scaleCurve: SCALE_CURVE,
    subfrondLengthMultiplier: SUBFROND_LENGTH_MULTIPLIER,
    bendiness: BENDINESS,
    maxAngle: MAX_ANGLE,
    stemThickness: STEM_THICKNESS,
    lastSaved: null,
    seed: Math.floor(Math.random() * 1e9),
  };
}

function redrawFern() {
  if (!fernG) return;
  randomSeed(state.seed);
  fernG.background(255);
  fernG.push();
  fernG.translate(SKETCH_WIDTH / 2, SKETCH_HEIGHT / 2);
  drawFern(fernG, state);
  fernG.pop();
}

function setup() {
  createCanvas(SKETCH_WIDTH, PREVIEW_HEIGHT);
  frameRate(60);
  state = makeState();
  fernG = createGraphics(SKETCH_WIDTH, SKETCH_HEIGHT);
  redrawFern(); // initial render
}

// ------------------------------------------------------------- HUD ----
// CONTROLS fill a grid, HUD.cols per row. Every label in a column shares
// one left x, so the labels align in 3 vertical columns.

let hudFlash = { k: '', t: -1e9 };               // last key pressed → cap highlight
const HUD = { margin: 10, gap: 24, pad: 8, rowH: 17, size: 11, cols: 3 };

const CONTROLS = [
  ['Export SVG',             'Shift R'],
  ['Leaf Size',              '[ ]', () => state.leafSize],
  ['Leaf Shape',             'l',   () => state.leafShape],
  ['Base Spacing',           '- =', () => state.baseSpacing],
  ['Max Angle',              'z a', () => state.maxAngle + '°'],
  ['Bendiness',              'v b', () => state.bendiness.toFixed(3)],
  ['Scale Curve',            'x s', () => state.scaleCurve.toFixed(2)],
  ['Frond Spacing',          'g t', () => state.frondSpacing.toFixed(2)],
  ['Leaflet Spacing',        'h y', () => state.leafletSpacing.toFixed(2)],
  ['Subfrond Length',        'c d', () => state.subfrondLengthMultiplier.toFixed(1) + '×'],
  ['Leaf to Subfrond Ratio', 'w e', () => state.leafToSubfrondRatio.toFixed(2)],
  ['Subfrond Density',       'f r', () => state.subfrondDensity.toFixed(4)],
  ['Stem Thickness',         'j q', () => state.stemThickness],
  ['Max Pinna Size',         'o p', () => state.maxPinnaSize],
];

function drawKeycap(k, x, y) {                   // one cap → the x after it
  const w = textWidth(k) + 8, hot = hudFlash.k === k && millis() - hudFlash.t < 180;
  stroke(hot ? 60 : 150); fill(hot ? 70 : 246); rect(x, y - 10, w, 15, 4);
  noStroke(); fill(hot ? 255 : 0); text(k, x + (w - textWidth(k)) / 2, y);
  return x + w;
}

function cellW(label, keys, val) {               // width of one control, as drawn
  const v = val ? String(val()) : '', [lo, hi] = keys.split(' ');
  let w = textWidth(v ? label + ': ' : label) + (v ? 0 : HUD.pad);
  if (lo && hi) w += textWidth(lo) + 8 + 4;      // [lo] + gap
  if (v) { textStyle(BOLD); w += textWidth(v) + 4; textStyle(NORMAL); }
  return w + textWidth(hi || lo) + 8;            // [hi] or lone [key]
}

function drawHUD() {
  textSize(HUD.size);
  const cols = HUD.cols, colW = new Array(cols).fill(0), colX = [];

  CONTROLS.forEach((c, i) => { const k = i % cols; colW[k] = Math.max(colW[k], cellW(...c)); });
  let cx = HUD.margin;                           // column starts = running sum of widths + gaps
  for (let c = 0; c < cols; c++) { colX[c] = cx; cx += colW[c] + HUD.gap; }
  if (cx - HUD.gap > SKETCH_WIDTH - HUD.margin) console.warn('HUD: columns exceed canvas width');

  let y = SKETCH_HEIGHT + 16;
  CONTROLS.forEach(([label, keys, val], i) => {
    if (i && i % cols === 0) y += HUD.rowH;                       // next grid row
    let x = colX[i % cols];
    const v = val ? String(val()) : '', [lo, hi] = keys.split(' '), head = v ? label + ': ' : label;
    noStroke(); fill(v ? 110 : 0); text(head, x, y);              // gray label, black value
    x += textWidth(head) + (v ? 0 : HUD.pad);
    if (lo && hi) x = drawKeycap(lo, x, y) + 4;
    if (v) { fill(0); textStyle(BOLD); const vw = textWidth(v); text(v, x, y); textStyle(NORMAL); x += vw + 4; }
    drawKeycap(hi || lo, x, y);
  });

  if (state.lastSaved) {                                          // next free grid slot
    const i = CONTROLS.length;
    if (i && i % cols === 0) y += HUD.rowH;
    fill(0, 150, 0); text('✓ ' + state.lastSaved, colX[i % cols], y);
  }
}

function draw() {
  background(255, 255, 255);
  if (fernG) image(fernG, 0, 0);

  stroke(200);
  line(0, SKETCH_HEIGHT, SKETCH_WIDTH, SKETCH_HEIGHT);

  drawHUD();
}

function exportFern() {
  randomSeed(state.seed);
  const svgG = createGraphics(SKETCH_WIDTH, SKETCH_HEIGHT, SVG);
  svgG.push();
  svgG.translate(SKETCH_WIDTH / 2, SKETCH_HEIGHT / 2);
  drawFern(svgG, state);
  svgG.pop();

  const filename = `fern-${frameCount}.svg`;
  svgG.save(filename);
  svgG.remove();        // frees the hidden DOM node the renderer created

  state.lastSaved = filename;
}

function keyPressed() {
  // helper to update a numeric value with bounds checking
  const bump = (v, delta, minV, maxV) => Math.max(minV, Math.min(maxV, v + delta));

  // Shift+R exports
  if (key === 'R') {
    hudFlash = { k: 'R', t: millis() };
    exportFern();
    return false;
  }

  // Forgiving matching: 'A' behaves like 'a', '+' like '=', '_' like '-'.
  const k = key === '+' ? '=' : key === '_' ? '-' : key.toLowerCase();
  hudFlash = { k, t: millis() };

  switch (k) {
    case ']': state.leafSize = bump(state.leafSize, 5, 5, 100); break;
    case '[': state.leafSize = bump(state.leafSize, -5, 5, 100); break;
    case '=': state.baseSpacing = bump(state.baseSpacing, 1, 1, 50); break;
    case '-': state.baseSpacing = bump(state.baseSpacing, -1, 1, 50); break;
    case 'l': {
      const idx = LEAF_ORDER.indexOf(state.leafShape);
      state.leafShape = LEAF_ORDER[(idx + 1) % LEAF_ORDER.length];
      break;
    }
    case 'b': state.bendiness = bump(state.bendiness, 0.01, 0.001, 1.0); break;
    case 'v': state.bendiness = bump(state.bendiness, -0.01, 0.001, 0.2); break;
    case 'a': state.maxAngle = bump(state.maxAngle, 5, 5, 90); break;
    case 'z': state.maxAngle = bump(state.maxAngle, -5, 5, 90); break;
    case 's': state.scaleCurve = bump(state.scaleCurve, 0.05, 0.1, 2.0); break;
    case 'x': state.scaleCurve = bump(state.scaleCurve, -0.05, 0.1, 2.0); break;
    case 'd': state.subfrondLengthMultiplier = bump(state.subfrondLengthMultiplier, 0.1, 1.0, 5.0); break;
    case 'c': state.subfrondLengthMultiplier = bump(state.subfrondLengthMultiplier, -0.1, 1.0, 5.0); break;
    case 'e': state.leafToSubfrondRatio = bump(state.leafToSubfrondRatio, 0.05, 0.05, 1.0); break;
    case 'w': state.leafToSubfrondRatio = bump(state.leafToSubfrondRatio, -0.05, 0.05, 1.0); break;
    case 'r': state.subfrondDensity = bump(state.subfrondDensity, 0.0005, 0.0001, 0.005); break;
    case 'f': state.subfrondDensity = bump(state.subfrondDensity, -0.0005, 0.0001, 0.005); break;
    case 't': state.frondSpacing = bump(state.frondSpacing, 0.05, 0.1, 2.0); break;
    case 'g': state.frondSpacing = bump(state.frondSpacing, -0.05, 0.1, 2.0); break;
    case 'y': state.leafletSpacing = bump(state.leafletSpacing, 0.05, 0.1, 1.0); break;
    case 'h': state.leafletSpacing = bump(state.leafletSpacing, -0.05, 0.1, 1.0); break;
    case 'q': state.stemThickness = bump(state.stemThickness, 1, 1, 20); break;
    case 'j': state.stemThickness = bump(state.stemThickness, -1, 1, 20); break;
    case 'p': state.maxPinnaSize = bump(state.maxPinnaSize, 1, 1, 20); break;
    case 'o': state.maxPinnaSize = bump(state.maxPinnaSize, -1, 1, 20); break;
    default: return; // unhandled key
  }

  redrawFern();
  return false;
}
