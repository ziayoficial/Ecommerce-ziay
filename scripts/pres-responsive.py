#!/usr/bin/env python3
"""
PRES-1: Make all ZIAY presentations responsive.
Injects mobile-first responsive overrides + viewport meta + theme-color
into each .html in public/presentaciones/ (skipping BUSINESS-CANVAS-AGIL.html
which is already responsive, and skipping files already processed by this script).

Idempotent: detects marker `data-pres-responsive="1"` and skips if present.
"""
import os
import re
import sys
from pathlib import Path

PRESENTATIONS_DIR = Path("/home/z/my-project/public/presentaciones")
MARKER_ATTR = 'data-pres-responsive="1"'
THEME_COLOR = "#047857"

# ------------------------------------------------------------------
# CSS templates per presentation pattern
# ------------------------------------------------------------------

# Common header used in ALL injections
CSS_HEADER = """
/* ============================================================
   PRES-1 · Responsive overrides (mobile iPhone/Android + web)
   Injected by scripts/pres-responsive.py
   Strategy: keep existing desktop CSS untouched, only override
   for mobile/touch. Uses clamp() + safe-area-inset + 100dvh.
   ============================================================ */
:root{
  --safe-top:env(safe-area-inset-top,0px);
  --safe-bottom:env(safe-area-inset-bottom,0px);
  --safe-left:env(safe-area-inset-left,0px);
  --safe-right:env(safe-area-inset-right,0px);
}
*{ -webkit-tap-highlight-color:transparent; }
img{ max-width:100%; height:auto; }
"""

# ------------------------------------------------------------------
# Pattern A: scaler-based (1280x720 fixed, transform:scale)
# Files: BUSINESS-CANVAS, ELEVATOR-SPEECH, PRESENTACION-CUSTOMER-JOURNEYS,
#        PRESENTACION-E2E-TESTS, PRESENTACION-EQUIPO-DESARROLLO-V2,
#        PRESENTACION-INVERSIONISTAS, PRESENTACION-NO-TECNICOS-V2
# ------------------------------------------------------------------
CSS_SCALER = CSS_HEADER + """
/* ===== Mobile-first override: disable scaler, make stage fluid ===== */
@media (max-width: 900px){
  html,body{
    height:100%; width:100%;
    overflow:hidden;
    display:block;
    background:var(--bg,#06100c);
  }
  #scaler{
    transform:none !important;
    width:100vw !important;
    height:100vh !important;
    height:100dvh !important;
  }
  .stage{
    position:relative !important;
    width:100vw !important;
    height:100vh !important;
    height:100dvh !important;
    border-radius:0 !important;
    box-shadow:none !important;
    overflow:hidden;
  }
  .slide{
    position:absolute !important;
    inset:0 !important;
    padding-top:calc(clamp(16px,5vw,32px) + var(--safe-top)) !important;
    padding-bottom:calc(clamp(76px,12vw,90px) + var(--safe-bottom)) !important;
    padding-left:calc(clamp(16px,5vw,32px) + var(--safe-left)) !important;
    padding-right:calc(clamp(16px,5vw,32px) + var(--safe-right)) !important;
    overflow-y:auto !important;
    -webkit-overflow-scrolling:touch;
    transform:none !important;
  }
  .slide::-webkit-scrollbar{ width:5px; height:5px; }
  .slide::-webkit-scrollbar-thumb{ background:var(--accent,#10b981); border-radius:3px; }
  .slide::-webkit-scrollbar-track{ background:transparent; }
  .slide>*{ flex-shrink:0; }

  /* Fluid typography */
  .hero-mark{ font-size:clamp(12px,3vw,16px) !important; letter-spacing:.2em !important; margin-bottom:14px !important; }
  .hero-title{ font-size:clamp(28px,9vw,52px) !important; line-height:1.05 !important; margin-bottom:12px !important; }
  .hero-sub{ font-size:clamp(14px,3.2vw,18px) !important; max-width:95vw !important; margin-bottom:18px !important; }
  .hero-badges{ gap:6px !important; margin-bottom:16px !important; }
  h1.title{ font-size:clamp(20px,5.5vw,28px) !important; line-height:1.15 !important; }
  h2.title{ font-size:clamp(16px,4vw,20px) !important; line-height:1.2 !important; margin-bottom:10px !important; }
  h3{ font-size:clamp(12px,2.8vw,14px) !important; }
  p, .lede{ font-size:clamp(12px,2.5vw,14px) !important; line-height:1.55 !important; max-width:100% !important; }
  p.muted{ font-size:clamp(11px,2.2vw,13px) !important; }
  .stat{ font-size:clamp(20px,5vw,28px) !important; }
  .stat-l{ font-size:clamp(9px,1.8vw,11px) !important; }
  .big-quote{ font-size:clamp(20px,5.5vw,30px) !important; line-height:1.25 !important; max-width:100% !important; }
  .stat-card{ padding:clamp(14px,4vw,22px) !important; border-radius:14px !important; }
  .stat-card .v{ font-size:clamp(28px,8vw,44px) !important; margin-bottom:4px !important; }
  .stat-card .l{ font-size:clamp(11px,2.4vw,13px) !important; }
  .stat-card .sub{ font-size:clamp(10px,2.2vw,12px) !important; }
  .kpi-pill{ padding:6px 12px !important; gap:8px !important; border-radius:24px !important; }
  .kpi-pill .v{ font-size:clamp(14px,3.5vw,20px) !important; }
  .kpi-pill .l{ font-size:clamp(9px,1.8vw,11px) !important; }
  .badge{ font-size:clamp(9px,1.8vw,11px) !important; padding:3px 9px !important; }
  .callout{ padding:clamp(11px,3vw,16px) !important; border-radius:10px !important; margin:8px 0 !important; }
  .callout-title{ font-size:clamp(9px,1.8vw,11px) !important; margin-bottom:5px !important; }
  .eyebrow{ gap:8px !important; font-size:clamp(9px,1.8vw,11px) !important; margin-bottom:8px !important; letter-spacing:.12em !important; }
  .eyebrow .dot{ width:6px; height:6px; }
  .eyebrow .bar{ display:none; }

  /* Layout: grids collapse to 1 col on phones */
  .grid,.g2,.g3,.g4,.g5{ grid-template-columns:1fr !important; gap:10px !important; }

  /* Foot: stop absolute (was overlapping content) */
  .foot{
    position:relative !important;
    left:auto !important; right:auto !important; bottom:auto !important;
    padding:8px 0 4px !important;
    margin-top:auto !important;
    background:none !important;
    font-size:clamp(9px,1.8vw,11px) !important;
    flex-shrink:0;
  }
  .foot .brand,.foot .pg{ font-size:clamp(9px,1.8vw,11px) !important; }

  /* Nav: bigger touch targets, fixed to bottom with safe-area-inset */
  .nav{
    position:fixed !important;
    bottom:calc(10px + var(--safe-bottom)) !important;
    left:50% !important;
    transform:translateX(-50%) !important;
    gap:8px !important;
    z-index:100 !important;
    max-width:calc(100vw - 20px);
    background:rgba(15,28,23,0.92) !important;
    backdrop-filter:blur(10px);
    -webkit-backdrop-filter:blur(10px);
    padding:6px 10px !important;
    border-radius:30px !important;
    border:1px solid var(--border,#1f3a30);
    box-shadow:0 4px 20px rgba(0,0,0,.35);
  }
  .nav button{
    width:44px !important; height:44px !important; min-width:44px;
    border-radius:50% !important;
    font-size:20px !important;
  }
  .nav .counter{
    font-size:clamp(11px,2vw,13px) !important;
    min-width:60px !important;
    padding:6px 10px !important;
    border-radius:16px !important;
  }
  .progress{ height:3px !important; z-index:200 !important; }

  /* Ghost watermark: hide (causes horizontal overflow on mobile) */
  .ghost{ display:none !important; }

  /* Cards: tighter padding */
  .card{ padding:10px 12px !important; border-radius:8px !important; }

  /* Tables: horizontal scroll */
  table.tbl, table{
    display:block; overflow-x:auto;
    white-space:nowrap;
    -webkit-overflow-scrolling:touch;
    max-width:100%;
    font-size:clamp(10px,2.2vw,12px) !important;
  }
  table.tbl th, table.tbl td, table th, table td{
    padding:6px 9px !important;
  }

  /* Step rows */
  .step-row{ gap:8px !important; margin-bottom:6px !important; }
  .step-row .body p{ font-size:clamp(11px,2.2vw,12px) !important; }

  /* Tag lists wrap */
  .tag-list{ gap:4px !important; }
  .tag{ font-size:clamp(9px,1.7vw,10px) !important; padding:2px 6px !important; }
}

/* Tablet portrait: 2-col grids where appropriate */
@media (min-width: 641px) and (max-width: 900px){
  .g2{ grid-template-columns:1fr 1fr !important; }
  .g3{ grid-template-columns:1fr 1fr !important; }
  .g4{ grid-template-columns:1fr 1fr !important; }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce){
  *, *::before, *::after{ transition:none !important; animation:none !important; }
}

/* Print */
@media print{
  body{ overflow:visible !important; background:white !important; }
  .stage{ position:relative !important; width:auto !important; height:auto !important; overflow:visible !important; }
  #scaler{ transform:none !important; }
  .slide{ position:relative !important; display:flex !important; page-break-after:always; overflow:visible !important; }
  .nav,.progress,.foot,#swipe-hint{ display:none !important; }
}
"""

# ------------------------------------------------------------------
# Pattern B: fluid deck (.deck width:100vw height:100vh; .slide absolute inset:0)
# Files: PRESENTACION-CLIENTES-COMPLETA, PRESENTACION-NO-TECNICOS,
#        PRESENTACION-STACK-COMPLETO
# ------------------------------------------------------------------
CSS_FLUID = CSS_HEADER + """
/* ===== Use dynamic viewport height + safe-area-inset padding ===== */
.deck{
  width:100vw;
  height:100vh;
  height:100dvh;
  position:relative;
  overflow:hidden;
}
.slide{
  padding-top:calc(clamp(20px,4vw,50px) + var(--safe-top)) !important;
  padding-bottom:calc(clamp(80px,12vw,120px) + var(--safe-bottom)) !important;
  padding-left:calc(clamp(16px,5vw,70px) + var(--safe-left)) !important;
  padding-right:calc(clamp(16px,5vw,70px) + var(--safe-right)) !important;
  overflow-y:auto !important;
  -webkit-overflow-scrolling:touch;
}
.slide::-webkit-scrollbar{ width:5px; height:5px; }
.slide::-webkit-scrollbar-thumb{ background:var(--primary,#10b981); border-radius:3px; }
.slide::-webkit-scrollbar-track{ background:transparent; }

@media (max-width: 900px){
  h1{ font-size:clamp(22px,6vw,32px) !important; line-height:1.15 !important; }
  h2{ font-size:clamp(16px,4vw,22px) !important; }
  h3{ font-size:clamp(13px,2.8vw,16px) !important; }
  p, li{ font-size:clamp(13px,2.4vw,16px) !important; line-height:1.55 !important; }
  .grid-2,.grid-3,.grid-4,.grid-5{ grid-template-columns:1fr !important; gap:10px !important; }
  /* Nav: bigger touch targets, safe-area-inset */
  .nav, #nav{
    position:fixed !important;
    bottom:calc(12px + var(--safe-bottom)) !important;
    left:50% !important;
    transform:translateX(-50%) !important;
    max-width:calc(100vw - 20px);
  }
  .nav button, #nav button{
    width:44px !important; height:44px !important; min-width:44px;
    font-size:20px !important;
  }
  /* Tables horizontal scroll */
  table{ display:block; overflow-x:auto; -webkit-overflow-scrolling:touch; max-width:100%; }
  /* Ensure no horizontal overflow */
  body, html{ overflow-x:hidden; }
  .slide{ max-width:100vw; }
}

@media (min-width: 641px) and (max-width: 900px){
  .grid-2{ grid-template-columns:1fr 1fr !important; }
  .grid-3{ grid-template-columns:1fr 1fr !important; }
}
@media (min-width: 901px){
  .grid-3{ grid-template-columns:repeat(3,1fr) !important; }
  .grid-4{ grid-template-columns:repeat(2,1fr) !important; }
  .grid-5{ grid-template-columns:repeat(3,1fr) !important; }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce){
  *, *::before, *::after{ transition:none !important; animation:none !important; }
}
@media print{
  body{ overflow:visible !important; }
  .deck{ height:auto !important; overflow:visible !important; }
  .slide{ position:relative !important; display:flex !important; page-break-after:always; overflow:visible !important; }
  .nav,.progress,#swipe-hint{ display:none !important; }
}
"""

# ------------------------------------------------------------------
# Pattern C: vertical scrolling slides (.slide min-height:100vh)
# Files: MANUAL-USUARIO, PRESENTACION-DIFERENCIADORES
# ------------------------------------------------------------------
CSS_VERTICAL = CSS_HEADER + """
/* ===== Vertical scrolling deck: safe-area-inset + fluid typography ===== */
.slide{
  min-height:100vh;
  min-height:100dvh;
  padding-top:calc(clamp(20px,4vw,50px) + var(--safe-top)) !important;
  padding-bottom:calc(clamp(60px,8vw,120px) + var(--safe-bottom)) !important;
  padding-left:calc(clamp(16px,5vw,50px) + var(--safe-left)) !important;
  padding-right:calc(clamp(16px,5vw,50px) + var(--safe-right)) !important;
  overflow-y:auto;
}
body{ overflow-x:hidden; }

/* Fluid typography (where author used em — convert to clamp) */
@media (max-width: 900px){
  h1{ font-size:clamp(22px,6vw,32px) !important; line-height:1.2 !important; }
  h2{ font-size:clamp(16px,4vw,22px) !important; }
  h3{ font-size:clamp(13px,3vw,16px) !important; }
  p, li{ font-size:clamp(13px,2.4vw,16px) !important; line-height:1.55 !important; }
  .big-stat{ font-size:clamp(28px,8vw,42px) !important; }
  /* Tables horizontal scroll */
  table{ display:block; overflow-x:auto; -webkit-overflow-scrolling:touch; max-width:100%; font-size:clamp(11px,2.4vw,13px) !important; }
  pre{ font-size:clamp(10px,2vw,12px) !important; padding:12px !important; }
  code{ font-size:clamp(10px,2vw,12px) !important; }
  /* Nav fixed bottom + safe-area-inset */
  .nav, #nav{
    position:fixed !important;
    bottom:calc(12px + var(--safe-bottom)) !important;
  }
  .nav button, #nav button{
    width:44px !important; height:44px !important; min-width:44px;
  }
  /* Back-to-top: respect safe-area */
  .back-to-top{
    bottom:calc(20px + var(--safe-bottom)) !important;
    right:calc(20px + var(--safe-right)) !important;
    padding:12px 18px !important;
    min-height:44px;
    display:inline-flex;
    align-items:center;
  }
  /* vs (compare two-col) collapse */
  .vs{ grid-template-columns:1fr !important; }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce){
  *, *::before, *::after{ transition:none !important; animation:none !important; }
}
@media print{
  .slide{ min-height:auto !important; page-break-after:always; }
  .nav,.progress,.back-to-top{ display:none !important; }
}
"""

# ------------------------------------------------------------------
# Pattern D: static doc / nav page (single-page HTML)
# Files: GUIA-ONBOARDING-CLIENTES, index.html
# ------------------------------------------------------------------
CSS_DOC = CSS_HEADER + """
body{
  overflow-x:hidden;
  padding-top:env(safe-area-inset-top,0px);
  padding-bottom:env(safe-area-inset-bottom,0px);
  padding-left:env(safe-area-inset-left,0px);
  padding-right:env(safe-area-inset-right,0px);
}
.container{
  padding-left:calc(clamp(16px,5vw,40px) + var(--safe-left)) !important;
  padding-right:calc(clamp(16px,5vw,40px) + var(--safe-right)) !important;
  padding-top:calc(clamp(20px,4vw,40px) + var(--safe-top)) !important;
  padding-bottom:calc(clamp(40px,8vw,80px) + var(--safe-bottom)) !important;
}
@media (max-width: 900px){
  h1{ font-size:clamp(20px,6vw,28px) !important; }
  h2{ font-size:clamp(16px,4vw,20px) !important; }
  h3{ font-size:clamp(13px,3vw,16px) !important; }
  p, li{ font-size:clamp(13px,2.4vw,16px) !important; line-height:1.6 !important; }
  table{ display:block; overflow-x:auto; -webkit-overflow-scrolling:touch; max-width:100%; font-size:clamp(11px,2.4vw,13px) !important; }
  pre{ font-size:clamp(10px,2vw,12px) !important; padding:12px !important; }
  code{ font-size:clamp(10px,2vw,12px) !important; }
  .card{ padding:16px !important; }
  .back-to-top{
    bottom:calc(20px + var(--safe-bottom)) !important;
    right:calc(20px + var(--safe-right)) !important;
    padding:12px 18px !important;
    min-height:44px;
    display:inline-flex;
    align-items:center;
  }
}
@media (prefers-reduced-motion: reduce){
  *, *::before, *::after{ transition:none !important; animation:none !important; }
}
"""

# ------------------------------------------------------------------
# Touch swipe script — only injected when no existing touchstart handler
# ------------------------------------------------------------------
TOUCH_SWIPE_JS = """
<script>
(function(){
  // Touch swipe navigation (added by PRES-1 responsive pass).
  // Only activates if the deck has slides and an existing navigate/show function.
  if(!document.querySelector || !document.querySelector('.slide')) return;
  var touchX=0, touchY=0, touchTime=0, touchTarget=null, swipeLock=false;
  document.addEventListener('touchstart', function(e){
    touchX=e.touches[0].clientX; touchY=e.touches[0].clientY;
    touchTime=Date.now(); touchTarget=e.target;
  }, {passive:true});
  document.addEventListener('touchend', function(e){
    var dx=e.changedTouches[0].clientX-touchX;
    var dy=e.changedTouches[0].clientY-touchY;
    var dt=Date.now()-touchTime;
    var isHorizontal=Math.abs(dx)>Math.abs(dy)*1.5;
    var isLongEnough=Math.abs(dx)>60;
    var isFastEnough=dt<800;
    var onScrollable=touchTarget && touchTarget.closest('.scrollable, table, pre, .canvas-cell, .scenario, .journey-flow');
    if(isHorizontal && isLongEnough && isFastEnough && !onScrollable && !swipeLock){
      swipeLock=true;
      if(typeof window.navigate==='function'){ window.navigate(dx<0?1:-1); }
      else if(typeof window.show==='function'){ /* fallback */ }
      setTimeout(function(){ swipeLock=false; }, 400);
    }
  }, {passive:true});
})();
</script>
"""

# ------------------------------------------------------------------
# Per-file config: which CSS pattern + extra custom overrides
# ------------------------------------------------------------------
FILES = {
    # Pattern A: scaler-based
    "BUSINESS-CANVAS.html":               ("scaler", CSS_SCALER),
    "ELEVATOR-SPEECH.html":               ("scaler", CSS_SCALER),
    "PRESENTACION-CUSTOMER-JOURNEYS.html":("scaler", CSS_SCALER),
    "PRESENTACION-E2E-TESTS.html":        ("scaler", CSS_SCALER),
    "PRESENTACION-EQUIPO-DESARROLLO-V2.html":("scaler", CSS_SCALER),
    "PRESENTACION-INVERSIONISTAS.html":   ("scaler", CSS_SCALER),
    "PRESENTACION-NO-TECNICOS-V2.html":   ("scaler", CSS_SCALER),
    # Pattern B: fluid deck
    "PRESENTACION-CLIENTES-COMPLETA.html":("fluid",  CSS_FLUID),
    "PRESENTACION-NO-TECNICOS.html":      ("fluid",  CSS_FLUID),
    "PRESENTACION-STACK-COMPLETO.html":   ("fluid",  CSS_FLUID),
    # Pattern C: vertical scrolling
    "MANUAL-USUARIO.html":                ("vertical", CSS_VERTICAL),
    "PRESENTACION-DIFERENCIADORES.html":  ("vertical", CSS_VERTICAL),
    # Pattern D: static doc
    "GUIA-ONBOARDING-CLIENTES.html":      ("doc",    CSS_DOC),
    "index.html":                         ("doc",    CSS_DOC),
}

VIEWPORT_TAG = '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=5.0">'
THEME_TAG = f'<meta name="theme-color" content="{THEME_COLOR}">'

def process_file(path: Path, css_body: str) -> tuple[bool, str]:
    """Return (modified?, message)."""
    text = path.read_text(encoding="utf-8")
    if MARKER_ATTR in text:
        return (False, "already processed (skip)")

    original = text

    # 1. Update viewport meta (multiple variants exist)
    # Match: <meta name="viewport" content="..."> with any content
    vp_patterns = [
        r'<meta\s+name=["\']viewport["\']\s+content=["\'][^"\']*["\']\s*/?>',
        r'<meta\s+content=["\'][^"\']*["\']\s+name=["\']viewport["\']\s*/?>',
    ]
    vp_matched = False
    for pat in vp_patterns:
        if re.search(pat, text):
            text = re.sub(pat, VIEWPORT_TAG, text, count=1)
            vp_matched = True
            break
    if not vp_matched:
        # Inject right after <head>
        text = text.replace("<head>", "<head>\n" + VIEWPORT_TAG, 1)

    # 2. Inject theme-color (right after viewport)
    if 'name="theme-color"' not in text:
        text = text.replace(VIEWPORT_TAG, VIEWPORT_TAG + "\n" + THEME_TAG, 1)

    # 3. Inject responsive CSS just before </head>
    # Use marker attribute on <html> so we can detect already-processed files
    style_block = f'<style id="pres-responsive" {MARKER_ATTR}>\n{css_body}\n</style>\n'
    if "</head>" in text:
        text = text.replace("</head>", style_block + "</head>", 1)
    else:
        text = style_block + text

    # 4. Inject touch swipe JS just before </body> (only if deck pattern exists
    #    AND no existing touchstart handler — to avoid double-binding)
    has_touch = "touchstart" in text or "touchmove" in text
    if not has_touch and "</body>" in text and ('class="slide"' in text or 'class=\'slide\'' in text):
        text = text.replace("</body>", TOUCH_SWIPE_JS + "</body>", 1)

    if text == original:
        return (False, "no changes (unexpected)")
    path.write_text(text, encoding="utf-8")
    return (True, "updated")


def main():
    if not PRESENTATIONS_DIR.exists():
        print(f"ERROR: {PRESENTATIONS_DIR} does not exist", file=sys.stderr)
        sys.exit(1)

    updated, skipped = [], []
    for fname, (_pattern, css) in FILES.items():
        fpath = PRESENTATIONS_DIR / fname
        if not fpath.exists():
            print(f"  [skip] {fname} (not found)")
            skipped.append(fname)
            continue
        ok, msg = process_file(fpath, css)
        flag = "[ ok ]" if ok else "[skip]"
        print(f"  {flag} {fname:50s} {msg}")
        if ok:
            updated.append(fname)
        else:
            skipped.append(fname)

    print()
    print(f"Total updated: {len(updated)}")
    print(f"Total skipped: {len(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
