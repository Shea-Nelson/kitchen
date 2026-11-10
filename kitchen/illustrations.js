/* Original cooking illustrations. No third-party artwork.
   Classic script in the browser (window.KitchenArt) and CommonJS in tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KitchenArt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const scenes = {
    oven: {
      label: 'Illustrated oven with a warm glow',
      body: [
        '<rect x="48" y="28" width="144" height="112" rx="16" fill="#3b322b"/>',
        '<rect x="62" y="42" width="116" height="70" rx="8" fill="#f6d7a2"/>',
        '<rect class="cook-glow" x="70" y="50" width="100" height="54" rx="6" fill="#ffb15a"/>',
        '<path d="M78 78h84M78 90h84" stroke="#c9892d" stroke-width="3" stroke-linecap="round"/>',
        '<circle cx="120" cy="124" r="6" fill="#e7d7c3"/>',
        '<path class="cook-steam" d="M96 24c6 8 6 8 0 16M120 18c8 10 8 10 0 20M146 24c6 8 6 8 0 16" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".8"/>'
      ].join('')
    },
    skillet: {
      label: 'Illustrated skillet with bubbling butter',
      body: [
        '<ellipse cx="108" cy="96" rx="70" ry="22" fill="#2a2420"/>',
        '<path d="M168 90h46c8 0 12 8 8 14-6 8-22 8-32 2" fill="#6d5844"/>',
        '<ellipse cx="108" cy="88" rx="62" ry="18" fill="#5c4636"/>',
        '<ellipse cx="108" cy="84" rx="52" ry="13" fill="#e2b15a"/>',
        '<circle class="cook-bubble" cx="86" cy="80" r="4" fill="#fff6df"/>',
        '<circle class="cook-bubble delay" cx="112" cy="76" r="3" fill="#fff6df"/>',
        '<circle class="cook-bubble delay-2" cx="132" cy="82" r="5" fill="#fff6df"/>',
        '<path class="cook-steam" d="M90 62c8-10 8-10 0-20M118 58c10-12 10-12 0-24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
      ].join('')
    },
    bowl: {
      label: 'Illustrated bowl with steam',
      body: [
        '<path d="M48 78h144c-8 36-40 54-72 54S56 114 48 78z" fill="#f4efe6"/>',
        '<path d="M58 78h124c-6 28-34 42-62 42S64 106 58 78z" fill="#c24e2c"/>',
        '<ellipse cx="120" cy="78" rx="74" ry="16" fill="#8d341c"/>',
        '<ellipse cx="120" cy="74" rx="60" ry="10" fill="#e7b089"/>',
        '<path class="cook-leaf" d="M96 70c10-16 18-8 16 6-12 2-18-2-16-6z" fill="#2f6a45"/>',
        '<path class="cook-steam" d="M100 52c8-12 8-12 0-22M128 48c8-12 8-12 0-24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
      ].join('')
    },
    pot: {
      label: 'Illustrated pot with a lid and steam',
      body: [
        '<path d="M62 86h116l-8 40c-2 10-16 16-50 16s-48-6-50-16z" fill="#d7d1c8"/>',
        '<path d="M70 86h100l-6 34c-2 8-14 12-44 12s-42-4-44-12z" fill="#6e8f98"/>',
        '<rect x="54" y="74" width="132" height="16" rx="8" fill="#3b322b"/>',
        '<rect x="108" y="48" width="24" height="28" rx="8" fill="#3b322b"/>',
        '<path class="cook-steam" d="M84 46c8-10 8-10 0-20M120 40c10-12 10-12 0-24M156 46c8-10 8-10 0-20" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>'
      ].join('')
    }
  };

  function illustration(kind) {
    const scene = scenes[kind] || scenes.skillet;
    return '<svg class="illu" viewBox="0 0 240 160" role="img" aria-label="' + scene.label + '">' +
      '<rect width="240" height="160" rx="28" fill="#2a2118"/>' +
      scene.body +
      '</svg>';
  }

  return { illustration: illustration, kinds: Object.keys(scenes) };
});
