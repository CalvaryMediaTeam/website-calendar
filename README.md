# Calvary Church website calendar

The events calendar on calvarychurch.org. It pulls live events from eSpace and shows them as an agenda table on desktop and as day cards on phones, styled with the site's own colors and fonts.

The code is served by GitHub Pages, so a change pushed to `main` reaches the website without editing WordPress.

- **Live files:** https://calvarymediateam.github.io/website-calendar/calendar.js and `calendar.css`
- **Preview page:** https://calvarymediateam.github.io/website-calendar/

## Putting it on a page

Add a **Custom HTML** block in WordPress, directly in the page (not inside a Group or Columns block), with:

```html
<div id="cvcal" class="alignwide"></div>
<script src="https://calvarymediateam.github.io/website-calendar/calendar.js" defer></script>
```

`alignwide` matches the width of other wide sections on the site. Use `alignfull` for edge to edge.

Optional settings on the `div`:

| Attribute | Default | What it does |
| --- | --- | --- |
| `data-ministry` | `13786` | eSpace ministry (organization) ID |
| `data-calendar` | `1884` | eSpace calendar ID |
| `data-days` | `7` | Days shown per page |

Only one calendar per page is supported.

## Making changes

| File | What's in it |
| --- | --- |
| `calendar.js` | Data loading, layout, navigation |
| `calendar.css` | All styling (colors come from the WordPress theme's color presets) |
| `index.html` | Preview page for testing outside WordPress |

1. Edit the file on a branch and open a pull request.
2. Check the change locally by opening `index.html` in a browser (it loads the `calendar.js` next to it).
3. Merge to `main`. GitHub Pages republishes within a minute or two.

Browsers and GitHub's servers may keep the previous version for up to about 10 minutes. To force an update right away, add or bump a version on the script tag in WordPress, for example `calendar.js?v=2`. The stylesheet follows the same version automatically.

## How the data works

The calendar calls eSpace's public event feed (`https://app.espace.cool/Public/GetEvents`), the same one eSpace's own embed uses. That feed isn't officially documented, so if eSpace changes it, the calendar shows a message with a link to the eSpace calendar instead of breaking the page.

- eSpace stores times as local wall-clock times, so visitors always see church time, wherever they are.
- Canceled events are left out. Event descriptions are not shown, because some contain internal notes.
- eSpace "calendar labels" (Communion, Cross Con and the like) show with a bell icon.
- A **Register →** link appears for any event with registration open in eSpace.

## Accuracy check

Every Monday and Friday morning a GitHub Action (`.github/workflows/calendar-check.yml`) opens eSpace's own Agenda view and the live calendar, reads every event for the next 91 days from both, and compares date, start time, end time and title.

- **If they match:** nothing happens (and any open check issue is closed).
- **If anything differs, or the check can't run:** it opens an issue labeled `calendar-check` listing exactly what's different. Later runs comment on that same issue instead of opening new ones.
- **To get the reports by email:** click **Watch** on the repository (or set a custom watch that includes Issues).
- **To run it now:** Actions tab → **Calendar accuracy check** → **Run workflow**.
- It also runs on any pull request that changes `calendar.js` or `calendar.css`, testing that branch's version before it's merged.

GitHub pauses scheduled workflows in public repositories after 60 days without any repository activity and emails the repository admins first. If that happens, re-enable it from the Actions tab.

The comparison script is `scripts/check-calendar.mjs`.

## Who can change this

Anything merged to `main` runs on calvarychurch.org. Keep `main` protected so changes go through a reviewed pull request.
