# AGoAC source board geometry

Pinned MegaMek/mm-data revision: `5ee1b15ff2877611db4b0ffa864a57d0b9f72938` (The MegaMek Team, CC BY-NC-SA 4.0).

- Desert #2: `data/boards/AGoAC Maps/16x17 Desert 2.board`
- Desert #3: `data/boards/AGoAC Maps/16x17 Desert 3.board`
- Grassland #2: `data/boards/AGoAC Maps/16x17 Grassland 2.board`
- Grassland #3: `data/boards/AGoAC Maps/16x17 Grassland 3.board`

The source-native 16×17 map elevation and printed hex identifiers are preserved in `packages/engine/agoac-boards.js`; woods, rough, water, roads and bridge annotations are converted to IronHex tiles. No original paper artwork or complete stacked bridge physics is included. Rotation is applied independently to each of two mapsheets.
