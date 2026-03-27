## [LRN-20260326-001] correction

**Logged**: 2026-03-26T09:11:40Z
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
For interactive line charts, "follow the mouse" may actually mean snap immediately to the nearest real data point on the X axis, not interpolate by cursor position or wait on a 2D distance threshold.

### Details
The initial historical comparison chart hover logic mixed Euclidean-distance snapping with interpolated fallback positions. The user clarified that while the pointer is inside the chart, the hover indicator should always map to the real data point whose X coordinate is nearest to the mouse. This produces faster, more intuitive switching between points.

### Suggested Action
When implementing point-follow hover on discrete time-series charts, default to nearest-X-point snapping unless interpolation is explicitly requested.

### Metadata
- Source: user_feedback
- Related Files: src/components/comparison-dashboard.tsx
- Tags: chart, hover, ux, snapping

---
## [LRN-20260326-002] correction

**Logged**: 2026-03-26T13:02:12Z
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
When a user clarifies a chart sizing request, scope the height change to the exact page/component they named instead of applying the shared style globally.

### Details
A chart-height adjustment initially touched shared trend-chart styles, which also affected the homepage observed chart. The user clarified they only meant the two WU observed / AW observed charts in the right-hand detail panel on `/comparison`. The correct fix is to keep the homepage chart sizing unchanged and use comparison-specific sizing overrides.

### Suggested Action
For UI sizing tweaks, confirm the exact page and component scope from the request and prefer page-specific overrides before changing shared primitives.

### Metadata
- Source: user_feedback
- Related Files: src/globals.css, src/components/comparison-dashboard.tsx, src/components/weather-dashboard.tsx
- Tags: frontend, css, scope, chart, comparison
- See Also: LRN-20260326-001

---
## [LRN-20260326-003] correction

**Logged**: 2026-03-26T13:10:15Z
**Priority**: high
**Status**: pending
**Area**: frontend

### Summary
For fixed-height SVG charts with a `viewBox`, hover X mapping can be badly offset if code uses the full SVG box instead of the actual rendered plot area.

### Details
The `/comparison` observed charts used a fixed `viewBox` width while the SVG element also had `width: 100%` and a fixed pixel height. In wider containers, the browser preserved aspect ratio and centered the rendered content with horizontal padding inside the SVG viewport. Hover logic still mapped `clientX` against the full SVG width, so entering the chart immediately snapped several points ahead and exiting never reached the final points. The robust fix is to size the viewBox width from the real chart container width and map pointer movement using the hitbox rect's rendered width.

### Suggested Action
For responsive SVG charts, avoid assuming the visible plot area equals the SVG element's full CSS box; measure the real rendered hit area or keep the viewBox synchronized with the container.

### Metadata
- Source: user_feedback
- Related Files: src/components/comparison-dashboard.tsx
- Tags: svg, chart, hover, pointer, responsive
- See Also: LRN-20260326-001, LRN-20260326-002

---
## [LRN-20260326-004] best_practice

**Logged**: 2026-03-26T13:12:03Z
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
Discrete chart hover can feel more responsive if snap thresholds are biased slightly toward the cursor's movement direction instead of always switching exactly at the midpoint.

### Details
On the `/comparison` observed charts, nearest-X snapping was correct but still felt a bit slow because the active point changed only after crossing each interval midpoint. A better interaction is to track the previous hover position and switch earlier in the direction of travel, while keeping a small overlap zone to avoid flicker.

### Suggested Action
For dense time-series hover interactions, consider directional snap thresholds (for example around 40% of the gap in the direction of travel) rather than pure midpoint snapping.

### Metadata
- Source: conversation
- Related Files: src/components/comparison-dashboard.tsx
- Tags: chart, hover, ux, snapping, interaction
- See Also: LRN-20260326-001, LRN-20260326-003

---
## [LRN-20260326-005] correction

**Logged**: 2026-03-26T13:17:50Z
**Priority**: medium
**Status**: pending
**Area**: frontend

### Summary
Filter dropdowns should not mix human-readable labels with alternate identifiers like slugs or ICAO codes in the same option list.

### Details
The `/comparison` city control used a free-text input backed by a datalist built from `airport.city`, `airport.slug`, and `airport.stationIcao`. That produced misleading duplicates such as `Ankara`, `ankara`, and `LTAC` for the same airport. The better design is a real `<select>` that displays one canonical city label per airport while submitting a stable internal identifier such as the slug.

### Suggested Action
For filters over known entities, prefer `<select>` with `{label, value}` pairs and keep display labels separate from submitted identifiers.

### Metadata
- Source: user_feedback
- Related Files: src/components/comparison-dashboard.tsx, src/globals.css
- Tags: forms, filters, ux, normalization
- See Also: LRN-20260326-002

---
