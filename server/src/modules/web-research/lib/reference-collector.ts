/**
 * The measuring script that runs inside a rendered reference page.
 *
 * It is a string, not a function, for two reasons: the server has no DOM types,
 * and `tsx` wraps named functions in a `__name` helper that does not exist in
 * the page. A string is evaluated exactly as written.
 *
 * It runs in the page's own world, so a hostile page can tamper with anything
 * it calls. Nothing it returns is trusted: `sanitizeMeasurement` validates every
 * value on the server. It reads computed styles and geometry. Page text is
 * only measured or matched against to produce a number or a yes/no, and none of
 * it is returned.
 */

/** Walks the page once so lazily loaded sections exist, then returns to the top. */
export const SCROLL_SCRIPT = String.raw`(async function () {
  var height = Math.min(document.documentElement.scrollHeight, 30000);
  var step = Math.max(400, Math.ceil(height / 10));
  for (var y = 0, i = 0; y < height && i < 12; y += step, i += 1) {
    window.scrollTo(0, y);
    await new Promise(function (resolve) { setTimeout(resolve, 120); });
  }
  window.scrollTo(0, 0);
  await new Promise(function (resolve) { setTimeout(resolve, 300); });
  return true;
})()`;

export const COLLECTOR_SCRIPT = String.raw`(function () {
  var MAX_SCAN = 2500;
  var body = document.body, root = document.documentElement;
  if (!body) return null;
  var vw = window.innerWidth, vh = window.innerHeight;
  var pageH = Math.max(root.scrollHeight, body.scrollHeight, 1);
  var pageW = Math.max(root.clientWidth, 1);

  function n(value) { var x = parseFloat(value); return isFinite(x) ? x : 0; }
  function css(el) { return window.getComputedStyle(el); }
  function box(el) { return el.getBoundingClientRect(); }
  function shown(el) {
    var r = box(el), s = css(el);
    return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility !== 'hidden' && n(s.opacity === '' ? '1' : s.opacity) > 0.02;
  }
  function all(scope, selector) { return Array.prototype.slice.call(scope.querySelectorAll(selector)); }
  function visible(scope, selector) { return all(scope, selector).slice(0, 400).filter(shown); }
  function clippedArea(r) {
    var w = Math.max(0, Math.min(r.right, pageW) - Math.max(r.left, 0));
    var h = Math.max(0, Math.min(r.bottom, pageH) - Math.max(r.top, 0));
    return w * h;
  }
  function hasBackgroundImage(s) { return s.backgroundImage !== 'none' && s.backgroundImage.indexOf('url(') !== -1; }
  function median(list) {
    if (list.length === 0) return 0;
    var sorted = list.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.floor(sorted.length / 2)];
  }

  // A challenge page renders fine and measures as a site, so it is ruled out here.
  var challenge = !!document.querySelector('#challenge-form, #cf-wrapper, .cf-browser-verification, iframe[src*="captcha"], script[src*="challenge-platform"]') ||
    /just a moment|attention required|access denied|verify you are human|captcha/i.test(document.title || '');

  var scanned = all(body, '*').slice(0, MAX_SCAN);
  var mediaEls = [];
  var bg = {}, ink = {}, accent = {};
  var transitions = 0, animations = 0, pinned = 0, grids = 0;
  function bump(map, key, by) { map[key] = (map[key] || 0) + by; }
  function solid(colour) {
    var m = /^rgba?\(([^)]+)\)$/.exec(colour);
    if (!m) return false;
    var parts = m[1].split(/[,\s/]+/).filter(Boolean);
    return parts.length < 4 || n(parts[3]) > 0.5;
  }
  var totalArea = pageW * pageH;
  bump(bg, css(body).backgroundColor === 'rgba(0, 0, 0, 0)' ? css(root).backgroundColor : css(body).backgroundColor, totalArea * 0.2);

  scanned.forEach(function (el) {
    if (!shown(el)) return;
    var s = css(el), r = box(el), tag = el.tagName;
    var area = clippedArea(r);
    if (n(s.transitionDuration) > 0) transitions += 1;
    if (s.animationName !== 'none' && s.animationName !== '') animations += 1;
    if ((s.position === 'fixed' || s.position === 'sticky') && r.height < vh * 0.5) pinned += 1;
    if (s.display.indexOf('grid') !== -1) grids += 1;
    var isControl = tag === 'BUTTON' || (tag === 'A' && s.backgroundColor !== 'rgba(0, 0, 0, 0)' && r.height >= 24 && r.height < 120);
    if (solid(s.backgroundColor)) bump(isControl ? accent : bg, s.backgroundColor, area);
    var ownText = 0;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) ownText += (c.nodeValue || '').trim().length;
    }
    if (ownText > 0 && solid(s.color)) bump(ink, s.color, ownText * n(s.fontSize));
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'PICTURE' || (tag === 'svg' && area > 4000) || hasBackgroundImage(s)) {
      if (r.width >= 24 && r.height >= 24 && tag !== 'PICTURE') mediaEls.push(el);
    }
  });

  function top(map, limit) {
    return Object.keys(map).sort(function (a, b) { return map[b] - map[a]; }).slice(0, limit)
      .map(function (key) { return { colour: key, weight: map[key] }; });
  }

  // How many children of the busiest container inside el share one row. Only
  // children wide enough to hold content count: a row of inline links is not columns.
  function columnsOf(el) {
    var best = 1, queue = [el], seen = 0, minWidth = Math.max(100, vw * 0.1);
    while (queue.length > 0 && seen < 80) {
      var current = queue.shift();
      seen += 1;
      var kids = Array.prototype.slice.call(current.children).filter(shown);
      var wide = kids.filter(function (kid) { return box(kid).width >= minWidth; });
      if (wide.length >= 2) {
        var rowTop = box(wide[0]).top, inRow = 0;
        wide.forEach(function (kid) { if (Math.abs(box(kid).top - rowTop) < 16) inRow += 1; });
        if (inRow > best) best = inRow;
      }
      queue.push.apply(queue, kids.slice(0, 12));
    }
    return best;
  }

  function sectionRoot() {
    var current = document.querySelector('main,[role=main]') || body;
    for (var depth = 0; depth < 6; depth += 1) {
      var kids = Array.prototype.slice.call(current.children).filter(shown);
      if (kids.length !== 1) break;
      current = kids[0];
    }
    return current;
  }

  function classify(el, isFirstContent) {
    var tag = el.tagName, role = el.getAttribute('role');
    if (tag === 'HEADER' || role === 'banner') return 'header';
    if (tag === 'FOOTER' || role === 'contentinfo') return 'footer';
    var r = box(el);
    var media = mediaEls.filter(function (m) { return el === m || el.contains(m); }).length;
    var columns = columnsOf(el);
    var headings = visible(el, 'h1,h2,h3').length;
    if (isFirstContent && r.top < vh && (visible(el, 'h1').length > 0 || r.height >= vh * 0.5)) return 'hero';
    if (visible(el, 'input,select,textarea').length >= 2) return 'form';
    if (columns >= 3 && media >= 3) return 'media-grid';
    if (columns >= 2 && headings >= 2) return 'card-grid';
    if (columns >= 2 && media >= 1) return 'split-media';
    if (media >= 1) return 'media-band';
    if (headings >= 1 || visible(el, 'p').length >= 1) return 'text-block';
    return 'other';
  }

  var rootEl = sectionRoot();
  var blocks = Array.prototype.slice.call(rootEl.children).filter(function (el) {
    return shown(el) && box(el).height >= 40 && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE';
  });
  if (rootEl !== body) {
    var outerHeader = document.querySelector('body header, [role=banner]');
    var outerFooter = document.querySelector('body footer, [role=contentinfo]');
    if (outerHeader && shown(outerHeader) && !rootEl.contains(outerHeader)) blocks.unshift(outerHeader);
    if (outerFooter && shown(outerFooter) && !rootEl.contains(outerFooter)) blocks.push(outerFooter);
  }
  blocks = blocks.slice(0, 24);
  var heroEl = null, sawContent = false;
  var sections = blocks.map(function (el) {
    var kind = classify(el, !sawContent);
    // A promo strip above the page is not where the hero would be.
    if (kind !== 'header' && kind !== 'other' && !sawContent) sawContent = true;
    if (kind === 'hero') heroEl = el;
    return kind;
  });

  var navEl = visible(document, 'nav,[role=navigation]').sort(function (a, b) {
    return visible(b, 'a,button').length - visible(a, 'a,button').length;
  })[0] || null;
  var navLinks = navEl ? visible(navEl, 'a,button') : [];
  var burgerScope = document.querySelector('header') || navEl || body;
  var burger = visible(burgerScope, 'button,[role=button],[aria-controls],[class*=burger],[class*=menu-toggle],[class*=nav-toggle]').some(function (el) {
    var r = box(el);
    return r.top < vh * 0.3 && r.width <= 90 && r.height <= 90 && /menu|nav|burger/i.test((el.getAttribute('aria-label') || '') + ' ' + (typeof el.className === 'string' ? el.className : ''));
  });
  var navPattern = 'none';
  if (navLinks.length >= 2) {
    var firstTop = box(navLinks[0]).top, sameRow = 0;
    navLinks.forEach(function (link) { if (Math.abs(box(link).top - firstTop) < 12) sameRow += 1; });
    navPattern = sameRow / navLinks.length >= 0.6 ? 'horizontal-bar' : 'vertical-list';
  }
  if (burger && navLinks.length < 3) navPattern = 'hamburger';
  var navPinned = false;
  for (var walker = navEl || document.querySelector('header'), hops = 0; walker && hops < 8; walker = walker.parentElement, hops += 1) {
    var position = css(walker).position;
    if (position === 'fixed' || position === 'sticky') { navPinned = true; break; }
  }

  var headings = [];
  // Many sites mark their logo up as a small h1 in the header; it is not a heading.
  function isLogoHeading(el) {
    return !!el.closest('header,nav,[role=banner]') && n(css(el).fontSize) < 32;
  }
  [1, 2, 3, 4].forEach(function (level) {
    visible(document, 'h' + level).filter(function (el) { return !isLogoHeading(el); }).slice(0, 8).forEach(function (el) {
      var s = css(el);
      headings.push({ level: level, family: s.fontFamily, size: n(s.fontSize), weight: n(s.fontWeight) });
    });
  });

  var textEls = visible(document, 'p,li').filter(function (el) { return (el.textContent || '').trim().length > 40; }).slice(0, 60);
  var bodyText = null;
  if (textEls.length > 0) {
    var sizes = textEls.map(function (el) { return n(css(el).fontSize); });
    var size = median(sizes);
    var match = textEls.filter(function (el) { return n(css(el).fontSize) === size; })[0] || textEls[0];
    var lineHeights = textEls.map(function (el) { return n(css(el).lineHeight) / (n(css(el).fontSize) || 1); }).filter(function (x) { return x > 0; });
    bodyText = {
      family: css(match).fontFamily,
      size: size,
      lineHeightRatio: lineHeights.length > 0 ? median(lineHeights) : null,
      measure: median(textEls.map(function (el) { return box(el).width; }))
    };
  }

  var spacingCounts = {};
  function countSpacing(value) { var v = Math.round(n(value)); if (v >= 2 && v <= 240) bump(spacingCounts, String(v), 1); }
  blocks.forEach(function (block) {
    [block].concat(Array.prototype.slice.call(block.querySelectorAll('div,section,ul,article')).slice(0, 40)).forEach(function (el) {
      var s = css(el);
      countSpacing(s.paddingTop); countSpacing(s.paddingBottom); countSpacing(s.marginBottom);
      if (s.display.indexOf('flex') !== -1 || s.display.indexOf('grid') !== -1) { countSpacing(s.rowGap); countSpacing(s.columnGap); }
    });
  });
  var sectionPads = blocks.map(function (el) { var s = css(el); return Math.max(n(s.paddingTop), n(s.paddingBottom)); }).filter(function (x) { return x > 0; });

  var mediaArea = mediaEls.reduce(function (sum, el) { return sum + clippedArea(box(el)); }, 0);
  var hero = null;
  var mainHeading = visible(document, 'h1').filter(function (el) { return !isLogoHeading(el); })[0] || null;
  var heroTarget = heroEl || (mainHeading ? mainHeading.parentElement : null);
  if (heroTarget) {
    var heroBox = box(heroTarget);
    var heroMedia = mediaEls.filter(function (m) { return heroTarget === m || heroTarget.contains(m) || m.contains(heroTarget); })
      .sort(function (a, b) { return clippedArea(box(b)) - clippedArea(box(a)); })[0] || null;
    var h1 = heroTarget.querySelector('h1') || heroTarget.querySelector('h2');
    var layout = 'text-only';
    if (heroMedia && !h1) layout = 'media-only';
    if (heroMedia && h1) {
      var m = box(heroMedia), t = box(h1);
      var overlaps = t.left < m.right && t.right > m.left && t.top < m.bottom && t.bottom > m.top;
      if (overlaps) layout = 'text-over-media';
      else if (t.right <= m.left || m.right <= t.left) layout = 'split';
      else layout = 'stacked';
    }
    var cta = visible(heroTarget, 'a,button').filter(function (el) {
      var s = css(el);
      return el.tagName === 'BUTTON' || solid(s.backgroundColor) || n(s.borderTopWidth) > 0;
    }).length;
    hero = { layout: layout, height: heroBox.height, align: h1 ? css(h1).textAlign : null, cta: cta };
  }

  return {
    viewport: { width: vw, height: vh },
    pageHeight: pageH,
    challenge: challenge,
    renderedElements: scanned.length,
    sections: sections,
    landmarks: {
      header: all(document, 'header,[role=banner]').length,
      nav: all(document, 'nav,[role=navigation]').length,
      main: all(document, 'main,[role=main]').length,
      aside: all(document, 'aside,[role=complementary]').length,
      footer: all(document, 'footer,[role=contentinfo]').length
    },
    nav: { items: navLinks.length, pattern: navPattern, pinned: navPinned },
    headings: headings,
    body: bodyText,
    colours: { background: top(bg, 5), text: top(ink, 4), accent: top(accent, 4) },
    spacing: { counts: spacingCounts, sectionGap: sectionPads.length > 0 ? median(sectionPads) : null },
    images: { count: mediaEls.length, areaShare: totalArea > 0 ? mediaArea / totalArea : 0 },
    hero: hero,
    motion: {
      transitions: transitions,
      animations: animations,
      pinnedElements: pinned,
      smoothScroll: css(root).scrollBehavior === 'smooth'
    },
    maxColumns: Math.max.apply(null, [1].concat(blocks.map(columnsOf))),
    horizontalOverflow: root.scrollWidth > vw + 2
  };
})()`;
