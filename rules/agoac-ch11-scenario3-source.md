# AGoAC Chapter 11 — Scenario 3, four mandatory die-cut counters

## Source and errata precedence

Source: *BattleTech: A Game of Armored Combat*, 2018 CAT3500D,
printed p.47 (PDF physical page 49, zero-based page index 48),
the **Scenario 3: Divide and Conquer** layout illustration.
The 2018 text and illustration label the west sheet **Desert #3**.
Official [AGoAC errata v8.01, p.5](https://battletech.com/wp-content/uploads/2025/06/64_A-Game-of-Armored-Combat-2023-09-17-v8.01.pdf)
corrects it to **Desert #2**; the east sheet stays **Grassland #3**.
No code or test may regress to west Desert #3. Horizontal board = 32×17 =
544 source tiles, 272 per sheet.

## Source figure digitization

The actual publisher-printed figure was opened and visually inspected as
a rasterized source page, then magnified. The visible red outlines were
projected onto the original 16-column ×17-row paper hex grid. The labels
below are **printed col (2 digits) + printed row (2 digits)**. They are
not positions invented for tests. The 2018 source image is an illustration
and does not itself print numeric labels inside the red outlines; these
labels are a geometric transcription, subject to pixel-grid review.

| Piece | Source sheet | Source hexes | Shape |
| --- | --- | --- | --- |
| 1 | West Desert #2 | 0711, 0712 | two hexes, original pictured rotation |
| 2 | West Desert #2 | 1213, 1114, 1214 | fixed triangle |
| 3 | East Grassland #3 | 0908, 1009 | two hexes, original pictured rotation |
| 4 | East Grassland #3 | 0310, 0311, 0411 | fixed triangle |

Original source figure crop calibration: x ≈25–770 west, x≈770–1517 east,
y≈20–633 (image 1553×690 pixels), grid horizontal center interval ≈44 px,
vertical row interval ≈36 px. West pair centers ≈(333,398),(354,435);
west triangle ≈(549,473),(527,510),(571,510); east pair ≈(1187,289),
(1209,326); east triangle ≈(924,360),(902,398),(947,398).
This evidence was obtained using the temporary unmerged GitHub Actions
source-inspection run 44963200341, job 137026342133, which downloaded
the original public PDF and rendered its original figure directly.

The physical pair markers permit rotating the two-hex piece and selecting
a die-cut face subject to binding 2D6 dispute arbitration. The triangular
shape **and rotation** cannot be changed. Source triangle coordinates are
validated by the engine and PostgreSQL snapshot integrity guard. The
separate free/optional-terrain margin rule must not reject mandatory
publisher-illustrated pieces adjacent to that margin.

## Implementation and verification

Single immutable source manifest:
`packages/engine/agoac-scenario3-figure.js`.
Game engine `placeScenarioLooseTerrain()` and API `assertScenario3SourceMap()`
enforce the same coordinates. The three-user signed setup UI displays all
four contours before placement and leaves only the book-permitted pair
rotation and counter-face decisions interactive. Source and browser `dist`
are byte-synchronized. Direct source regression, PostgreSQL full/shortened
rosters, and independent three-Chromium-client E2E must all pass on exact PR
head and on the merged main quality-gate run.

This figure image is **not copied** into the application's proprietary
art assets. Never assert complete Chapter 11 certification or mark
`agoac-150/151` Verified merely because the coordinates were coded:
pixel-based transcription and gameplay correctness need final source QA and
CI/SonarQube confirmation.

No deployment and no Chapter 12.

## Final source certification — 2026-11-22

The actual CAT3500D printed p.47 (PDF zero-based page 48) was
revisited visually: one blue two-hex outline and one fixed red
three-hex triangle occur on each pictured source mapsheet.
The numbered cells above are *geometry-derived transcriptions*
of the printed source grid: the printed artwork itself does not place
four-digit coordinate labels within each outline.

Printed p.48 deployment and official errata v8.01 jointly establish
command NW, recon SE, and attacker row 1510–1517 on one chosen map.
The old 2018 west sheet label is superseded: **Desert #2 WEST,
Grassland #3 EAST**, permanently fixed.

The actual merged `main` commit
`a56975ae15447f73d91f83454fa04803173b1e7b` passed all four
checks: Ironhex CI 45010069558, full Browser E2E 45010069604
(51 tests), Container Smoke 45010069553 (including both full and
shortened PostgreSQL scenario rooms) and SonarQube 45010069626
(strict Quality Gate PASSED). The source-figure and printed deployment
atomic requirements `agoac-150` and `agoac-151` are independently
certified. This certification does not redistribute publisher art.

The map, underlying engine, source physical hexes and UI are
unchanged in this documentation-only closeout. No deployment or
Chapter 12 work.
