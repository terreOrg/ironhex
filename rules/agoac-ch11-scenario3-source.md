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
