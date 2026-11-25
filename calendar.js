/*!
 * Calvary Church events calendar  v1.0.0
 * Pulls live events from eSpace and renders an agenda (desktop) or day cards (phones).
 * Source: https://github.com/CalvaryMediaTeam/website-calendar
 *
 * Embed on any page:
 *   <div id="cvcal" class="alignwide"></div>
 *   <script src="https://calvarymediateam.github.io/website-calendar/calendar.js" defer></script>
 *
 * Optional settings on the placeholder div:
 *   data-ministry="13786"  data-calendar="1884"  data-days="7"
 */
(function () {
  var root = document.getElementById('cvcal');
  if (!root || root.getAttribute('data-cvcal-ready')) return;
  root.setAttribute('data-cvcal-ready', '1');

  // Load the stylesheet that sits next to this script.
  var me = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    for (var i = all.length - 1; i >= 0; i--) { if (/calendar\.js/.test(all[i].src)) return all[i]; }
    return null;
  })();
  var base = me ? me.src.replace(/[^\/]*$/, '') : '';
  var version = me ? (me.src.split('?')[1] || '') : '';
  if (base && !document.getElementById('cvcal-css')) {
    var link = document.createElement('link');
    link.id = 'cvcal-css';
    link.rel = 'stylesheet';
    link.href = base + 'calendar.css' + (version ? '?' + version : '');
    // Hide the widget until its styles arrive, so it never flashes unstyled.
    root.style.visibility = 'hidden';
    var show = function () { root.style.visibility = ''; };
    link.onload = show;
    link.onerror = show;
    setTimeout(show, 3000);
    document.head.appendChild(link);
  }

  // Build the widget's markup inside the placeholder.
  root.classList.add('cvcal');
  root.setAttribute('aria-label', 'Church calendar');
  root.innerHTML = "<div class=\"cvcal-bar\">\n    <div class=\"cvcal-nav\">\n      <button type=\"button\" class=\"cvcal-btn\" data-act=\"today\">Today</button>\n      <button type=\"button\" class=\"cvcal-btn cvcal-icon\" data-act=\"prev\" aria-label=\"Previous week\">&#8249;</button>\n      <button type=\"button\" class=\"cvcal-btn cvcal-icon\" data-act=\"next\" aria-label=\"Next week\">&#8250;</button>\n    </div>\n    <h2 class=\"cvcal-range\" aria-live=\"polite\"></h2>\n    <label class=\"cvcal-jump\">\n      <span>Jump to</span>\n      <input type=\"date\" class=\"cvcal-date\">\n    </label>\n  </div>\n  <div class=\"cvcal-body\" aria-live=\"polite\"></div>\n  <div class=\"cvcal-pager\">\n    <button type=\"button\" class=\"cvcal-btn\" data-act=\"prev\" data-scroll>&#8249; Previous week</button>\n    <button type=\"button\" class=\"cvcal-btn\" data-act=\"next\" data-scroll>Next week &#8250;</button>\n  </div>\n  <p class=\"cvcal-foot\">\n    <a href=\"https://app.espace.cool/ClientApi/Monthly/13786?view=a&calendarId=1884\" target=\"_blank\" rel=\"noopener\">Open full calendar</a>\n  </p>";

  var CONFIG = {
    ministryId: +(root.getAttribute('data-ministry') || 13786),
    calendarId: +(root.getAttribute('data-calendar') || 1884),
    endpoint: 'https://app.espace.cool/Public/GetEvents',
    days: +(root.getAttribute('data-days') || 7),             // how many days each page shows
    narrowAt: 720         // below this width (px) use the mobile card layout
  };

  var body = root.querySelector('.cvcal-body');
  var rangeEl = root.querySelector('.cvcal-range');
  var dateInput = root.querySelector('.cvcal-date');

  var DAY = 864e5;
  var DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var MON = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // eSpace stores wall-clock times as UTC, so all date math here is done in UTC "wall time".
  function todayKey() { var n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()); }
  function fmtParam(t) { var d = new Date(t); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear(); }
  function isoDate(t) { return new Date(t).toISOString().slice(0, 10); }
  function parseMs(s) { var m = /-?\d+/.exec(s || ''); return m ? parseInt(m[0], 10) : NaN; }
  function dayStart(t) { return Math.floor(t / DAY) * DAY; }
  // Kept free of the ampersand character so it can also be pasted into a WordPress Custom HTML block.
  var AMP = String.fromCharCode(38);
  function both(a, b) { return !(!a || !b); }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML.split('"').join(AMP + 'quot;');
  }
  function fmtTime(t) {
    var d = new Date(t), h = d.getUTCHours(), m = d.getUTCMinutes(), ap = h < 12 ? 'AM' : 'PM';
    h = h % 12 || 12;
    return h + (m ? ':' + (m < 10 ? '0' : '') + m : '') + ' ' + ap;
  }
  function timeRange(ev) {
    if (ev.allDay) return 'All day';
    var a = fmtTime(ev.start), b = fmtTime(ev.end);
    if (a.slice(-2) === b.slice(-2)) a = a.slice(0, -3);  // "9:30 – 11 AM"
    return a + ' – ' + b;
  }

  var cache = {};          // id -> event
  var loaded = [];         // [from, to) ranges already fetched
  var start = todayKey();
  var reqId = 0;

  function covered(from, to) {
    return loaded.some(function (r) { return both(r[0] <= from, r[1] >= to); });
  }

  function fetchRange(from, to) {
    var params = new URLSearchParams({
      categories: '', locations: '', includeDrafts: 'false',
      ministryId: CONFIG.ministryId, calendarId: CONFIG.calendarId,
      publicOnly: 'true', showNationalHolidays: 'false',
      start: fmtParam(from), end: fmtParam(to)
    });
    return fetch(CONFIG.endpoint, { method: 'POST', body: params })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        if (!j || !Array.isArray(j.Data)) throw new Error('Unexpected response');
        j.Data.forEach(function (e) {
          if (e.IsCanceled || /Hymn Sing/.test(e.Title)) return; // TEMP: deliberate bug to test the check
          var s = parseMs(e.Start), en = parseMs(e.End);
          if (isNaN(s)) return;
          var id = (e.OccurrenceId || 'e' + e.EventId) + '-' + s;
          cache[id] = {
            title: (e.Title || '').trim(),
            start: s,
            end: isNaN(en) ? s : en,
            allDay: !!e.IsAllDay,
            label: !!e.IsCalendarLabel,
            reg: both(e.IsRegistrationAvailable, e.ScheduleId)
              ? 'https://app.espace.cool/PublicEventRegistration/EventDetails?ministryId=' + CONFIG.ministryId + AMP + 'scheduleId=' + e.ScheduleId + AMP + 'occurrenceId=' + e.OccurrenceId
              : null
          };
        });
        loaded.push([from, to]);
      });
  }

  function eventsBetween(from, to) {
    return Object.keys(cache).map(function (k) { return cache[k]; })
      .filter(function (e) { return both(e.start < to, e.end > from || e.start >= from); })
      .sort(function (a, b) { return (b.allDay - a.allDay) || (a.start - b.start) || (a.end - b.end) || a.title.localeCompare(b.title); });
  }

  function groupByDay(evs, from, to) {
    var days = [];
    for (var t = from; t < to; t += DAY) {
      days.push({ t: t, items: evs.filter(function (e) {
        var s = dayStart(e.start), en = e.end > e.start ? dayStart(e.end - 1) : s;
        return both(s <= t, en >= t);   // multi-day events appear on each day they cover
      }) });
    }
    return days.filter(function (d) { return d.items.length; });
  }

  var BELL = '<span class="cvcal-label" role="img" aria-label="Note"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/></svg></span>';
  function titleHtml(e) {
    return (e.label ? BELL : '') +
      '<span class="cvcal-title">' + esc(e.title) + '</span>' +
      (e.reg ? '<br><a class="cvcal-reg" href="' + esc(e.reg) + '" target="_blank" rel="noopener">Register →</a>' : '');
  }
  function dayHtml(t) {
    var d = new Date(t);
    return '<span class="cvcal-daynum">' + d.getUTCDate() + '</span>' +
      '<span class="cvcal-dayname">' + DOW[d.getUTCDay()] + '</span>' +
      '<span class="cvcal-daymonth">' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + '</span>';
  }

  function renderTable(days, today) {
    var h = '<table class="cvcal-table"><thead><tr><th scope="col">Date</th><th scope="col">Time</th><th scope="col">Event</th></tr></thead><tbody>';
    days.forEach(function (d) {
      d.items.forEach(function (e, i) {
        h += '<tr' + (d.t === today ? ' class="cvcal-today"' : '') + '>';
        if (i === 0) h += '<td class="cvcal-day" rowspan="' + d.items.length + '">' + dayHtml(d.t) + '</td>';
        h += '<td class="cvcal-time">' + timeRange(e) + '</td><td>' + titleHtml(e) + '</td></tr>';
      });
    });
    return h + '</tbody></table>';
  }

  function renderCards(days, today) {
    var h = '<div class="cvcal-days">';
    days.forEach(function (d) {
      h += '<section class="cvcal-card' + (d.t === today ? ' cvcal-today' : '') + '"><div class="cvcal-card-head">' + dayHtml(d.t) +
        (d.t === today ? ' <span class="cvcal-today-tag">Today</span>' : '') + '</div>';
      d.items.forEach(function (e) {
        h += '<div class="cvcal-row"><div class="cvcal-time">' + timeRange(e) + '</div><div>' + titleHtml(e) + '</div></div>';
      });
      h += '</section>';
    });
    return h + '</div>';
  }

  var lastDays = null;
  function draw() {
    if (!lastDays) return;
    var narrow = root.clientWidth < CONFIG.narrowAt;
    root.classList.toggle('is-narrow', narrow);
    body.innerHTML = lastDays.length
      ? (narrow ? renderCards(lastDays, todayKey()) : renderTable(lastDays, todayKey()))
      : '<p class="cvcal-msg">No events scheduled for these dates.</p>';
  }

  function setRangeLabel(from, to) {
    var a = new Date(from), b = new Date(to - DAY);
    var sameMonth = a.getUTCMonth() === b.getUTCMonth();
    rangeEl.textContent = MON[a.getUTCMonth()].slice(0, 3) + ' ' + a.getUTCDate() + ' – ' +
      (sameMonth ? '' : MON[b.getUTCMonth()].slice(0, 3) + ' ') + b.getUTCDate() + ', ' + b.getUTCFullYear();
    dateInput.value = isoDate(from);
  }

  function load() {
    var from = start, to = start + CONFIG.days * DAY, my = ++reqId;
    setRangeLabel(from, to);
    var ready = covered(from, to) ? Promise.resolve() : (body.innerHTML = '<p class="cvcal-msg">Loading events…</p>', fetchRange(from, to));
    ready.then(function () {
      if (my !== reqId) return;
      lastDays = groupByDay(eventsBetween(from, to), from, to);
      draw();
      // quietly prefetch the following week so "next" is instant
      var nf = to, nt = to + CONFIG.days * DAY;
      if (!covered(nf, nt)) fetchRange(nf, nt).catch(function () {});
    }).catch(function () {
      if (my !== reqId) return;
      lastDays = null;
      body.innerHTML = '<p class="cvcal-msg">We couldn’t load the calendar right now. ' +
        '<a href="https://app.espace.cool/ClientApi/Monthly/' + CONFIG.ministryId + '?view=a' + AMP + 'calendarId=' + CONFIG.calendarId + '" target="_blank" rel="noopener">View it on eSpace</a> or ' +
        '<a href="#" data-act="retry">try again</a>.</p>';
    });
  }

  root.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'retry') ev.preventDefault();
    if (act === 'prev') start -= CONFIG.days * DAY;
    if (act === 'next') start += CONFIG.days * DAY;
    if (act === 'today') start = todayKey();
    load();
    if (b.hasAttribute('data-scroll')) {
      var top = root.getBoundingClientRect().top + window.pageYOffset - 100;  // leave room for the sticky header
      window.scrollTo({ top: top, behavior: 'smooth' });
    }
  });
  dateInput.addEventListener('change', function () {
    if (!dateInput.value) return;
    var p = dateInput.value.split('-');
    start = Date.UTC(+p[0], +p[1] - 1, +p[2]);
    load();
  });

  if (window.ResizeObserver) {
    var lastNarrow;
    new ResizeObserver(function () {
      var n = root.clientWidth < CONFIG.narrowAt;
      if (n !== lastNarrow) { lastNarrow = n; draw(); }
    }).observe(root);
  } else {
    window.addEventListener('resize', draw);
  }

  load();
})();
