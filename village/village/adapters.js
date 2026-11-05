// LexPace village: game action -> the exact answer value the classic journey page sends.
// Pure functions (no DOM, no network) so they can be unit-tested with node.
(function (root) {
  'use strict';

  // Word Rush (Real or Not?). The classic page offers ['Real word', 'Made-up word'] and sends the
  // chosen index as `response`; the backend reads 0 as "real word". Left shelf = 0, right shelf = 1.
  const WordRush = {
    SHELVES: ['real', 'madeup'],
    LABELS: ['Real word', 'Made-up word'],
    toResponse(shelf) {
      const i = this.SHELVES.indexOf(shelf);
      if (i < 0) throw new Error('Unknown shelf: ' + shelf);
      return i;
    },
  };

  const api = { WordRush };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameAdapters = api;
})(this);
