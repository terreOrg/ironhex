# MegaMek unit data in IronHex

Pinned upstream: https://github.com/MegaMek/mm-data revision
`5ee1b15ff2877611db4b0ffa864a57d0b9f72938`.

Source work by The MegaMek Team is licensed under **Creative Commons
Attribution-NonCommercial-ShareAlike 4.0 (CC BY-NC-SA 4.0)**.
See `LICENSE`, original source notices preserved inside the archive,
`manifest.json` and `full-index.json` for attribution and provenance.

## Complete original unit records (reference-only)

`archive/all-units.json.gz` is a **lossless** gzip archive of 11,248 original
technical unit records (`.mtf` and `.blk`) from the exact pinned revision,
including all **4,305 MTF files** enumerated in `full-index.json`
(**zero missing**). It includes BattleMechs, tanks, infantry, battle armor,
aerospace fighters, naval and other unit types. Every record retains the
original source content and can be viewed as a paper-folder reference dossier
with a link back to its exact upstream GitHub blob.

Source unit count by family: Meks 4305, infantry 2038, vehicles 1453,
battle armor 1188, ground equipment 1035, fighters 502, dropships 209,
warships 123, advanced buildings 106, ProtoMechs 86, conventional fighters 70,
small craft 39, space stations 33, handheld 32, jump ships 29.

Reproduce using `node scripts/import-mm-data.mjs --source /path/to/mm-data`
with a sparse checkout of the pinned upstream revision. The program refuses
an archive missing any of the 4,305 indexed MTF files.

`meks/` still contains 14 individually adapted playable candidates, used by
the strict `apps/api/src/mtf.mjs` construction validation. The full archive
contains **reference information, not combat implementations**. Only validated
market offers may be purchased and used. Prices in IronHex are separate
noncanonical game-balance values.

The equipment reference indexes distinct component names as found in the
actual source unit records, while full equipment statistics come only from
IronHex's separately verified engine definitions. The Java equipment
definitions in MegaMek itself are not included or represented as imported.

MegaMek and MekBay do not endorse IronHex.
