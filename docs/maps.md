# Maps: new 3D city maps

Status: **research, 2026-11-27; nothing built in REDnode.** The owner wants new cities to have a map like Night City's: a 3D model of the city in the red HUD look, with the same menus, buttons, tooltips and quest tracker. The first case is a fictional Hong Kong. This page records how the game's own map works, what a second map can reuse, what a modder would supply, and the spikes that decide the build.

Sources: the game's files read through REDbridge (game 2.5), the 2.5 game API dump (`gameapi/2.5/rtti.json`), TweakDB as the game ships it, and a decompile of the game's scripts from an earlier version (2.5 may differ). Nothing here has been tried in the game: everything is unverified unless it says otherwise.

Where it stands today: the **Maps test** mod (`E:\Modding\Cyberpunk 2077\Projects\MapsTest`, outside this repo, its own in-game test not yet run) turns the hub's MAP cell into MAPS with NIGHT CITY and HONG KONG buttons, and draws Hong Kong as about 800 flat ink shapes projected by its script. That proves the hub entry. It is not the game's map: no meshes, no native camera, pins, tooltips or quest tracker.

## The short answer

**The game's map is an ordinary entity filmed by a camera, shown as a picture in an ink screen.** The city model is one entity file with plain mesh components. A camera component on it renders to a texture, and the map screen shows that texture as an image with the ink widgets (pins, tooltips, filters, quest tracker) laid over it.

| Question | Answer |
|---|---|
| Can a map show my own building meshes? | Yes, by this reading. The Phantom Liberty landmarks (the obelisk, the pyramid, the statue) are ordinary meshes added to the map entity, each with a map material |
| Do I duplicate special game files? | Two kinds of file at most: the map entity (`3dmap_view.ent`) and, for a screen of its own, the map screen's widget file (`world_map.inkwidget`). The materials, the environment, the cursor, the pin widgets and the animations are referenced as they are, never copied |
| Do I need the game's baked district format? | No. Night City's district buildings are baked into data textures read by a special shader. A new map can use plain meshes instead |
| What cannot be reused as it is? | Districts (a fixed list in the engine), the game's pins (they sit at Night City's coordinates) and the one menu entry named `world_map` |

The recommended build has REDnode own the plumbing: a modder gives **mesh files in an archive and one map description** (name, meshes by role, districts as outlines, pins), and REDnode puts them on the game's own map screen. Which route gets there is decided by the spikes below.

## How the game's map works

| Step | What | Where |
|---|---|---|
| 1 | The hub opens the menu named `world_map` | `menu.inkmenu` entry; `MenuScenario_HubMenu` |
| 2 | The screen's root controller starts, stops the game world's time and makes V invulnerable | `gameuiWorldMapMenuGameController` (script name `WorldMapMenuGameController`) in `world_map.inkwidget`, item `Root` |
| 3 | It spawns the item `EntityPreview` from the same file | controller property `entityPreviewLibraryID` |
| 4 | That item's controller spawns the map entity and the cursor entity | `gameuiWorldMapPreviewGameController`: `viewTemplate`, `cursorTemplate`, `viewEnvironmentDefinition` |
| 5 | The entity's camera renders the model to a dynamic texture each frame | `entRenderToTextureCameraComponent` writing `world_map_texture.dtex` |
| 6 | An ink image shows that texture, full screen | image `MapImage`, part `map` of `world_map_atlas.inkatlas` |
| 7 | The controller projects each mappin's world position through the map camera and places its widget | spawn container `Content/SpawnContainer`; pin widgets from `mappins\default_mappin.inkwidget` |
| 8 | The cursor entity moves over the model; the district trigger it is inside is the hovered district | `3dmap_cursor.ent` (a trigger activator), the entity's trigger areas |

The model is at world scale: one unit is one metre, and a pin at a place in Night City lands on the same place of the model. The map entity lives in a render layer of its own (`WorldMap`), so nothing of the real world shows in the picture.

### Files

| File | What it is | A new map |
|---|---|---|
| `base\gameplay\gui\fullscreen\world_map\world_map.inkwidget` | The screen: 12 library items (`Root`, `EntityPreview`, `Tooltip`, `PoliceTooltip`, `DistrictOutline`, `GangListItem`, `FiltersListItem`, input hints and debug outlines) | Reuse, or copy and change two fields (route B) |
| `base\entities\cameras\3dmap\3dmap_view.ent` | The map entity: 96 parts (table below) | The file to copy and empty, or to add to at run time |
| `base\entities\cameras\3dmap\3dmap_cursor.ent` | The cursor: one trigger activator, radius 0.5, height 250 | Reuse |
| `base\weather\24h_basic\3dmap.envparam`, `3dmap.env` | The map's lighting and colour: most of the look | Reuse |
| `base\materials\3d_map_solid.mt` | Flat colour shader: roads, borders, see-through overlays | Reuse through material instances |
| `base\materials\3d_map_terrain.mt`, `3dmap_terrain.mi`, `3dmap_water.mi` | Terrain with contour lines; water is the same with `Brightness` 0.7 | Reuse |
| `base\entities\cameras\3dmap\3dmap_mesh_static.mi` | Landmark material: `metal_base_proxy.mt`, pink base colour and emissive | Reuse for buildings |
| `base\materials\3d_map_cubes.mt` | District buildings shader (reads a data texture) | Not needed |
| `base\materials\3d_map_metro.mt` | Metro lines | Reuse if the city has lines |
| `base\gameplay\gui\fullscreen\world_map\world_map_texture.dtex` | The render target: 1280 x 720, scaled to the viewport | Reuse |
| `world_map_animations.inkanim`, `world_map_style.inkstyle`, `mappins\*.inkwidget`, `floorplan.inkwidget` | Animations, colours, pin widgets | Reuse |
| `base\gameplay\gui\fullscreen\world_map\world_map_entity.ent` | An older preview entity (a particle mesh and a box); the screen does not name it | Ignore |

### The map entity, part by part

`3dmap_view.ent` has one game object (`gameuiWorldMapGameObject`) and 95 components:

| Parts | Count | What they do |
|---|---|---|
| `virtual_camera_comp` | 1 | The render-to-texture camera: layer `WorldMap`, environment `3dmap.envparam`, far plane 30,000, quality `PreviewLow`, bound to `target_point` |
| `target_point` | 1 | What the camera looks at; the native controller moves it to pan |
| District buildings (`city_center_data`, `watson_data`, ...) | 8 | One per district, all the same small mesh (`3dmap_triangle_soup.mesh`, 256 vertices) drawn 2,000 or 2,100 times, each with its own appearance |
| `3dmap_roads`, `3dmap_roads_borders`, `3dmap_metro` and their `_seethrough` twins | 6 | Plain meshes with `3d_map_solid.mt`. The see-through twins draw the same mesh again, additive and on top, so roads show faintly through buildings |
| `terrain_mesh`, `water_mesh`, `3dmap_cliffs` | 3 | Plain meshes: terrain 16 km square (about 250,000 vertices in 5 chunks), water one flat sheet |
| Landmarks (`obelisk`, `statue_splash_a`, `monument_ave_pyramid`, the ferris wheel, the North Oak sign, ...) | 8 | Ordinary game meshes with an appearance that uses the map material. **This is the pattern a new city's buildings follow** |
| `coll_roads`, `coll_buildings`, `coll_buildings2`, `coll_buildings3` | 4 | Physics meshes (preset `Interaction Object`): what the cursor and the pins rest on, so they sit on rooftops (their exact use is unverified) |
| District trigger areas (`watson_trigger`, `kabuki_trigger`, ...) | 38 | An outline of up to 50 points and a height each, one per district and subdistrict, with backups |
| Transforms | 22 | Parents that place the triggers |
| `highlightEffects` | 1 | Effects that set a material parameter on one district's buildings for 0.25 s: the glow of the hovered district |
| `EnvProbe6824`, `mappin_geo`, a hidden box | 3 | A global light probe, the 3D pin bulb, a workaround |

The game object carries the list that ties it together: `districts`, 26 pairs of a district (`Watson`) and a trigger component's name (`watson_trigger`).

### District buildings: baked, and not needed

Each district's material (`3d_map_cubes.mt`) names two textures: `WorldPosTex`, such as `base\fx\textures\3dmap\static\westbrook_data.xbm`, and `BaseColor`, such as `c_westbrook_m.xbm` (512 x 512, greyscale). The data texture is 591 x 197, 16 bits a channel, uncompressed: three 197 x 197 blocks side by side, with `PointCloudTextureHeight` 197, and `TransMin`, `TransMax` and `CubeSize` to turn its values back into metres. The shader moves the small mesh's vertices to places read from that texture, so each district is a cloud of boxes drawn in one go, with an edge glow (`EdgeColor`, `EdgeThickness`) and a dissolve near the camera and at the map's edge. What each block holds (likely place, turn and size) is unverified.

It is a way to draw about 30,000 boxes cheaply. A new city with a few hundred to a few thousand buildings does not need it: merge the buildings into a few meshes and use a map material. The same shader also accepts ordinary static meshes (`MVF_MeshStatic` with `Is3DMap`), which may give plain meshes the same edge glow: spike MP1 tries it.

### The look

| Part of the look | Comes from |
|---|---|
| Dark red and pink city, cyan roads | Material colours: buildings base `(242, 145, 156)` with emissive, roads `(28, 179, 191)`, terrain `(86, 108, 136)` with lighter lines |
| Glowing edges on buildings | `3d_map_cubes.mt` |
| Haze, contrast, colour grade | The environment `3dmap.envparam` on the camera |
| Roads seen through buildings | The additive, on-top twins of the road meshes |
| Dark corners and top band | Ink: image `vignette`, rectangle `upperBg` |
| Buildings fading at the map's edge | `MapEdgeDissolveRadiusStart` 4,500 and band 1,500 in the cubes shader; `DarkEdgeWidth` 4,500 on the terrain |

### The screen's widgets

All of these are in `world_map.inkwidget`, item `Root`, wired to the controller by name:

| On screen | Widget | Fed by |
|---|---|---|
| The 3D map | `Content/EntityPreviewContainer` | The preview item's image |
| Pins | `Content/SpawnContainer` | The mappin system, natively |
| GPS lines | `GPSPathContainer` (quest, player-tracked, Delamain) | Natively |
| District outlines and icons | `DistrictsContainer`, `SubDistrictsContainer`, item `DistrictOutline` | Natively, from the trigger outlines |
| Time, district name and icon, gangs | `LocationAndGangsBar` | Script: `OnUpdateHoveredDistricts`, `ShowGangsInfo` |
| Quick filter with arrows and four dots | `filterSelector` | Script and TweakDB `WorldMap.WorldMapQuickFiltersList` |
| Custom filter list | `Filters`, item `FiltersListItem` | Script and `WorldMap.WorldMapCustomFiltersList` |
| Quest tracker (quest, objective, Open Journal) | `QuestContainer` | Script: `UpdateTrackedQuest`, the journal |
| Pin tooltip, police tooltip | `TooltipContainer` | Script: `worldMapTooltips` |
| Fast travel and Delamain banners | `FastTravelInstructions`, `DelamainTaxiInstructions` | Script |
| Button hints | `InputHintsContainer` | Script: `RefreshInputHints` |
| Loading spinner | `loading_progress` | Script: `WorldMapPreloader` |

Because the script side is plain redscript, every one of these can be wrapped: a text replaced, a list filled differently, a part hidden.

### Camera settings

The controller names one TweakDB record, `settingsRecordID = WorldMap.DefaultSettings`:

| Setting | Value |
|---|---|
| Cursor bounds | X -5,500 to 6,050, Y -7,300 to 5,000 |
| Zoom levels | 6 (`ZoomLevelDistricts` at 11,000 down to `ZoomLevelExtraMappins`), each with a zoom, a rotation, an icon scale and the pin groups it shows |
| Free camera | Zoom 800 to 10,500, default 3,000; field of view 25; pitch -30 to -85 |
| Transitions | Zoom 0.25 s, camera mode 0.35 s |

A new map needs its own bounds and zoom range when its size differs. Records can be made with TweakXL (`tweakdb.clone`); whether the controller reads the record at each open or once is unverified.

## What is hard-wired

| Limit | Why it matters | Way round |
|---|---|---|
| The entity file is named inside the widget file (`viewTemplate`) | A second map cannot be chosen by a call | Fill or swap the entity at run time (route A), or a copy of the widget file (route B) |
| Districts are a fixed list (`gamedataDistrict`) tied to trigger names on the entity | Hong Kong's districts are not in it | REDnode's own hover test against the map description's outlines, writing the name into the game's district label |
| Pins are the game's mappins at Night City's coordinates | They would show over Hong Kong | Hide them by script while another map shows (`UpdateVisibility` is script); show the map's own pins |
| The player marker | V is not in Hong Kong | Hide it, unless the map says where V is |
| One menu entry, `world_map` | A second screen needs a second entry in `menu.inkmenu`, a file only one mod can replace | Route A needs no entry. Route B ships one generic entry for every map |
| Fast travel, Delamain, GPS lines | They act on the real world | Off on other maps to start with |

## Three routes

| | A. Swap the stage | B. A second screen | C. Own screen (as Maps test) |
|---|---|---|---|
| How | Open the game's own `world_map`; while another map is chosen, hide Night City's parts on the map entity and add the map's meshes to it | A copy of `world_map.inkwidget` with its own `viewTemplate` and settings, opened by a new menu entry | A Codeware popup; REDnode spawns its own entity with a render-to-texture camera, moves it, and places pins with its own projection (as world pins do) |
| Game files replaced | None | `menu.inkmenu` (once, by REDnode) | None |
| Files a modder ships | Meshes and a description | Meshes and a description (or an entity file) | Meshes and a description |
| Native zoom, pan, rotate, cursor, controller support | Yes | Yes | Rebuilt by hand |
| Native pins, tooltips, filters, quest tracker | Yes | Yes | Rebuilt by hand |
| Depends on | Reaching the spawned map entity and changing its components while it shows | The same, or a full entity file per map; plus adding a menu entry | A dynamic texture shown by an ink image made in script |
| Risk | Leftovers if the swap is not undone when the screen closes; the baked districts' effects | Conflicts over `menu.inkmenu` | The most work, and it never matches the game exactly |

**Recommended: A, with C's hub entry from the Maps test.** It replaces no game file, reuses every widget, and asks the least of the modder. B is the fallback if the stage cannot be changed cleanly at run time; C if neither can.

## What a modder would supply for Hong Kong

| Part | Format | Notes |
|---|---|---|
| Buildings | `.mesh` files in the mod's archive, merged by area (one mesh per district is a good size) | Modelled in metres, Z up, placed where they stand; a few thousand boxes with simple roofs is the game's own level of detail |
| Roads | One mesh of flat strips | Drawn twice by REDnode: solid, and the faint see-through pass |
| Terrain and water | One mesh each | Water is a flat sheet just under 0 |
| Landmarks | Any game or custom mesh | Given the map material at run time, or an appearance named for it |
| Districts | Outlines as point lists, with a name, an icon and a line of text | In the description, not in a file |
| Pins | Places with a name, an icon and a tooltip | In the description, or added by code |
| The description | A JSON file in the package (`hongkong.map.json`) | Name, size and bounds, start view, which mesh plays which role, colours if not the default |

No shader, environment, widget or entity file is written by the modder. EDGEfab and Blender make the meshes; REDbridge's `project.import` turns them into `.mesh`.

A sketch of the description and the calls (names open):

```js
import { maps } from "rednode";

await maps.define({
  id: "hongkong",
  name: "Hong Kong",
  bounds: { min: [-1500, -1350], max: [1500, 1350] },
  view: { zoom: 2400, yaw: 20 },
  layers: [
    { role: "terrain", mesh: "mod\\hongkong\\map\\terrain.mesh" },
    { role: "water", mesh: "mod\\hongkong\\map\\water.mesh" },
    { role: "roads", mesh: "mod\\hongkong\\map\\roads.mesh" },
    { role: "buildings", mesh: "mod\\hongkong\\map\\kowloon.mesh", district: "mong-kok" },
    { role: "landmark", mesh: "mod\\hongkong\\map\\clock_tower.mesh", position: [310, -120, 0] },
  ],
  districts: [{ id: "mong-kok", name: "Mong Kok", outline: [[-150, -1200], [520, -1200], [520, -820], [-150, -820]] }],
  pins: [{ id: "ferry", name: "Star Ferry", position: [40, -90, 0], icon: "FastTravelVariant" }],
});

await maps.open("hongkong"); // also from the hub's MAPS panel
```

## Spikes

Each is a small test with one question. MP1 needs no code at all.

| Spike | Question | How |
|---|---|---|
| MP1 Look | Does an ordinary mesh show on the game's map in the right look, and which material suits buildings: `3dmap_mesh_static.mi`, `3d_map_solid.mt`, or `3d_map_cubes.mt` on a static mesh? | A test archive that replaces `3dmap_view.ent` with a copy plus three boxes over Night City, one per material. Open the map and look. Removed after |
| MP2 Reach | Can script or the plugin get the spawned map entity while the screen is open, and switch its components off and on? | Find the entity (by class from the plugin, or through the preview controller); toggle `watson_data`; add a mesh component at run time (Codeware's `AddComponent`, or the plugin) |
| MP3 Stage | With Night City's parts off and a test city's meshes on: do pan, zoom and the cursor behave, with new bounds from a cloned settings record? Is everything back at the next open? | The Maps test's data turned into three meshes; a cloned `WorldMap.DefaultSettings` |
| MP4 Pins and districts | Can the game's pins be hidden and the map's own shown through the mappin system at map coordinates? Does a hover test from the cursor's place give districts, and can the district label take the name? | Script wraps of `UpdateVisibility` and `OnUpdateHoveredDistricts`; one registered mappin |
| MP5 Second screen (only if MP2 or MP3 fails) | Does a copy of the widget file with another `viewTemplate` open from a new menu entry? | Route B's files, made with REDbridge |

## Open questions

1. **Which route**, once MP1 to MP3 have run. Recommended: A.
2. **Where it lives.** Recommended: the `maps` API in REDnode (the stage, the pins, the hub's MAPS panel), with Hong Kong as its first sample; the Maps test stays outside the repo until then.
3. **Is Hong Kong only a map, or a place V can go?** If a playable area comes later at its own world coordinates, the map should be built at those coordinates from the start, so the game's own pins and the player marker work there unchanged.
4. **The district glow and outlines.** The game's hover glow is tied to the baked districts; a plain-mesh city needs its own (a material parameter per district mesh). Wanted for the first version?
5. **Fast travel on other maps**: off to start with, as recommended above?
