// ============================================================
// Fadenkreuz-Renderer (Canvas). Wird vom HUD und von der Vorschau
// im Einstellungsmenue benutzt, damit beide identisch aussehen.
// ============================================================

/**
 * Zeichnet das Fadenkreuz in die Mitte eines Canvas-Kontexts.
 * @param ctx   CanvasRenderingContext2D
 * @param W,H   Groesse des Canvas in CSS-Pixeln (bereits skaliert)
 * @param s     Settings-Objekt (crossStyle, crossSize, ...)
 * @param spread zusaetzlicher Abstand in px (dynamisches Fadenkreuz)
 * @param hit   Treffer-Einfaerbung aktiv
 * @param keep  Canvas vorher nicht loeschen (Vorschau mit Hintergrund)
 */
export function drawCrosshair(ctx, W, H, s, spread, hit, keep) {
  if (!keep) ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const style = s.crossStyle || 'cross';
  const size = +s.crossSize || 8;
  const thick = +s.crossThick || 2;
  const gap = (+s.crossGap || 0) + (spread || 0);
  const color = hit ? (s.crossHitColor || '#ff4444') : (s.crossColor || '#ffffff');
  const outline = s.crossOutline !== false;
  const dotR = (+s.crossDotSize || 2) / 2;
  ctx.globalAlpha = s.crossOpacity !== undefined ? +s.crossOpacity : 1;
  ctx.lineCap = 'butt';

  // Halbe Pixel vermeiden Unschaerfe bei geraden Dicken
  const snap = (v) => Math.round(v);

  const lines = [];
  if (style === 'cross' || style === 'circlecross') {
    lines.push([cx, cy - gap, cx, cy - gap - size]);
    lines.push([cx, cy + gap, cx, cy + gap + size]);
    lines.push([cx - gap, cy, cx - gap - size, cy]);
    lines.push([cx + gap, cy, cx + gap + size, cy]);
  } else if (style === 'tee') {
    lines.push([cx, cy + gap, cx, cy + gap + size]);
    lines.push([cx - gap, cy, cx - gap - size, cy]);
    lines.push([cx + gap, cy, cx + gap + size, cy]);
  } else if (style === 'x') {
    const g = gap * 0.7071, l = size * 0.7071;
    lines.push([cx - g, cy - g, cx - g - l, cy - g - l]);
    lines.push([cx + g, cy - g, cx + g + l, cy - g - l]);
    lines.push([cx - g, cy + g, cx - g - l, cy + g + l]);
    lines.push([cx + g, cy + g, cx + g + l, cy + g + l]);
  }

  const strokeLines = (w, col) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    for (const l of lines) {
      const vertical = Math.abs(l[0] - l[2]) < 0.01;
      const horizontal = Math.abs(l[1] - l[3]) < 0.01;
      // Achsparallele Linien auf das Pixelraster legen
      const x0 = vertical ? snap(l[0]) : l[0], x1 = vertical ? snap(l[2]) : l[2];
      const y0 = horizontal ? snap(l[1]) : l[1], y1 = horizontal ? snap(l[3]) : l[3];
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  };

  const circle = (r, w, col) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  };

  const dot = (r, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const showCircle = style === 'circle' || style === 'circlecross';
  const circleR = gap + size * 0.5 + 1;
  const showDot = style === 'dot' || !!s.crossDot;

  // Umriss zuerst (breiter, schwarz), dann Farbe darueber
  if (outline) {
    const oc = 'rgba(0,0,0,0.85)';
    if (lines.length) strokeLines(thick + 2, oc);
    if (showCircle) circle(circleR, thick + 2, oc);
    if (showDot) dot(dotR + 1, oc);
  }
  if (lines.length) strokeLines(thick, color);
  if (showCircle) circle(circleR, thick, color);
  if (showDot) dot(dotR, color);

  ctx.globalAlpha = 1;
}

/** Cache-Schluessel: nur bei Aenderung neu zeichnen */
export function crosshairKey(s, spread, hit) {
  return [s.crossStyle, s.crossSize, s.crossThick, s.crossGap, s.crossDot, s.crossDotSize,
    s.crossColor, s.crossHitColor, s.crossOutline, s.crossOpacity, Math.round(spread * 2), hit ? 1 : 0].join('|');
}
