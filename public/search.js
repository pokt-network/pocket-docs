/**
 * Pagefind-backed search with live autocomplete dropdown.
 *
 * Behavior:
 *   - Live results as you type (debounced 120ms)
 *   - Arrow Up/Down to move through results, Enter to navigate
 *   - Enter with no highlighted result navigates to the top match
 *   - Esc closes the dropdown
 *   - Click outside closes the dropdown
 *
 * Works for both the desktop input (.search-input-wrapper > input.search-input)
 * and the mobile dropdown bar (.mobile-search-bar > input.search-input).
 */
(function () {
  var pagefindPromise = null;
  function loadPagefind() {
    if (pagefindPromise) return pagefindPromise;
    pagefindPromise = import('/pagefind/pagefind.js')
      .then(function (pf) { pf.init && pf.init(); return pf; })
      .catch(function (err) {
        console.warn('[search] Pagefind not available (expected in dev):', err.message);
        return null;
      });
    return pagefindPromise;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function attach(input) {
    if (!input || input.dataset.searchBound === '1') return;
    input.dataset.searchBound = '1';

    var wrapper = input.parentElement;
    var dropdown = document.createElement('div');
    dropdown.className = 'search-results';
    dropdown.setAttribute('role', 'listbox');
    dropdown.hidden = true;
    wrapper.appendChild(dropdown);

    var items = [];
    var activeIdx = -1;
    var debounceTimer = null;
    var lastQuery = '';

    function render(results, query) {
      if (!results || !results.length) {
        dropdown.innerHTML =
          '<div class="search-results-empty">No matches for ' +
          '<strong>' + escapeHtml(query) + '</strong></div>';
        items = [];
        activeIdx = -1;
        dropdown.hidden = false;
        return;
      }
      var html = '';
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var title = escapeHtml(r.meta && r.meta.title ? r.meta.title : r.url);
        var excerpt = r.excerpt || '';
        html +=
          '<a class="search-result" role="option" href="' + escapeHtml(r.url) + '" data-idx="' + i + '">' +
            '<span class="search-result-title">' + title + '</span>' +
            '<span class="search-result-excerpt">' + excerpt + '</span>' +
          '</a>';
      }
      dropdown.innerHTML = html;
      items = Array.prototype.slice.call(dropdown.querySelectorAll('.search-result'));
      activeIdx = items.length ? 0 : -1;
      updateActive();
      dropdown.hidden = false;
    }

    function updateActive() {
      for (var i = 0; i < items.length; i++) {
        if (i === activeIdx) items[i].classList.add('active');
        else items[i].classList.remove('active');
      }
      if (activeIdx >= 0 && items[activeIdx]) {
        items[activeIdx].scrollIntoView({ block: 'nearest' });
      }
    }

    function close() {
      dropdown.hidden = true;
      activeIdx = -1;
    }

    async function runSearch(q) {
      if (!q || q.length < 2) { close(); return; }
      var pagefind = await loadPagefind();
      if (!pagefind) {
        dropdown.innerHTML =
          '<div class="search-results-empty">Search index not available in dev mode.</div>';
        dropdown.hidden = false;
        return;
      }
      if (q !== lastQuery) return; // a newer query has already fired
      var search = await pagefind.search(q);
      if (q !== lastQuery) return;
      var top = await Promise.all(search.results.slice(0, 8).map(function (r) { return r.data(); }));
      render(top, q);
    }

    input.addEventListener('input', function () {
      var q = input.value.trim();
      lastQuery = q;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () { runSearch(q); }, 120);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        if (!items.length) return;
        e.preventDefault();
        activeIdx = (activeIdx + 1) % items.length;
        updateActive();
      } else if (e.key === 'ArrowUp') {
        if (!items.length) return;
        e.preventDefault();
        activeIdx = (activeIdx - 1 + items.length) % items.length;
        updateActive();
      } else if (e.key === 'Enter') {
        if (items.length && activeIdx >= 0) {
          e.preventDefault();
          window.location.href = items[activeIdx].href;
        } else if (items.length) {
          e.preventDefault();
          window.location.href = items[0].href;
        }
      } else if (e.key === 'Escape') {
        close();
        input.blur();
      }
    });

    input.addEventListener('focus', function () {
      if (items.length) dropdown.hidden = false;
    });

    document.addEventListener('click', function (e) {
      if (!wrapper.contains(e.target)) close();
    });
  }

  function init() {
    var inputs = document.querySelectorAll('.search-input');
    for (var i = 0; i < inputs.length; i++) attach(inputs[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
