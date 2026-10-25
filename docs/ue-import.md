---
title: UE5 assets
---

# Unreal Engine 5 assets in Cyberpunk 2077: research

**Status: research only.** Asked for by the user on 2026-10-25. Nothing is built or scheduled. This page asks one question: how feasible is it to take Unreal Engine 5.x assets (props, NPCs, their materials, rigs and animations) into Cyberpunk 2077 through the EDGE tools, how much work it is, and what it costs in quality. Facts not checked against the game or the tools are marked unverified.

## The short answer

| Asset | Feasible? | Effort, one asset by hand | Effort, once EDGE automates it | The main tradeoff |
|---|---|---|---|---|
| Static prop, simple PBR material | **Yes** | 1 to 4 hours | Minutes | Nanite meshes must be cut down and given LODs |
| Prop with a complex UE material | **Yes, baked** | Half a day | Minutes plus a check | The material becomes fixed textures: no tiling layers, parameters or world-aligned effects |
| Animated prop (fan, door, sign) | Yes | A day | Hours | A simple looping clip only. No physics, no state logic |
| Humanoid NPC on the game's body rig | **Yes, with skill** | 2 to 5 days | About a day | The mesh is moved onto Cyberpunk's skeleton, so the game's own animations and AI drive it. UE's own rig and IK are dropped |
| That NPC's face: speech, expressions | **Barely** | Weeks, research | Unknown | The game's facial rigs and lipsync are not open to modders. Plan for a still face or a borrowed game head |
| Humanoid animations (poses, idles, emotes) | Yes | Hours each | Minutes each | Retarget onto the game's rig. They play through workspots or photo mode, not as the NPC's walk or combat |
| Locomotion or combat sets for an NPC | Hard | Weeks | Unknown | Replacing an NPC's walk and fight means its animation graph |
| Creatures or any custom skeleton with AI | **No** (for now) | Months | Unknown | The game's AI and animation graphs only know its own rigs |
| Cloth, strand hair, physics | Partly | Days | Hours | UE Chaos cloth and strand hair (groom) don't carry over. Cards and the game's dangle bones instead |

Props are the strong case: high feasibility and a clear path to automation. NPCs work if the mesh is moved onto Cyberpunk's body rig and keeps the game's animations. Talking faces and new skeletons are where it gets expensive.

## Rights come first

Converting is the easy part. What may be shipped in a mod is set by each asset's license, so the EDGE tools should ask about it and record it at import.

| Source | Can it go into a Cyberpunk mod? |
|---|---|
| Your own UE project's assets | Yes |
| Fab, Standard License | At its launch (Oct 2024) Epic said Standard License assets, Megascans included, can be used in any engine. Some listings carry their own restriction (UE-only or UEFN-only). Check each listing. Whether a free mod that others can unpack counts as an allowed use is **unverified**: read the license text before releasing. |
| MetaHumans | Since MetaHuman 5.6 (June 2025) the EULA allows MetaHuman characters and animations in other engines and tools, with UE 5.6 or later. Earlier versions keep the old cloud EULA. |
| Epic's own UE-only samples (Paragon, City Sample and the like) | Assume no, unless the license says otherwise. |
| Assets pulled from another game's `.pak` | No. That is ripping. Nexus removes ripped assets, and the EDGE tools should not help. |

So the input is always **the UE editor with the project open**, never a cooked `.pak`/`.utoc`. That also helps the work: the editor exports clean FBX, keeps the source textures and can bake materials, so there is no need to read Epic's cooked formats.

## The pipeline

```
UE 5.x editor ──export──► FBX + textures + manifest ──► Blender (headless) ──► glTF ──► REDbridge (WolvenKit) ──► .mesh .xbm .mi .ent .app .anims ──► archive
   (UE Python:              (units, axes,                 (rig moves,                     (import over a                    │
    export, bake,            names, LODs)                  weights, LODs)                  template file)                   ▼
    retarget)                                                                                                    EDGEbuilder places it,
                                                                                                                 REDnode swaps it in
```

| Stage | Tool | Already in EDGE? |
|---|---|---|
| Export from UE: meshes, skeletal meshes, animations, textures; bake materials; retarget animations | UE's Python editor scripting, Merge Actors (material baking), IK Retargeter | No. A small UE editor plugin or script |
| Clean-up: centimeters to meters, axes, names, triangulation, LODs, weight limits, moving onto the game's rig | Blender in the background, with WolvenKit's Blender IO Suite for the game's conventions | No |
| Mesh, texture and animation import | WolvenKit's importers, through REDbridge | Partly: REDbridge runs WolvenKit; `project.import` with texture setup (REDbridge #8) |
| Materials | Cyberpunk material templates | EDGEmat makes materials; it would gain "from a PBR set" |
| Entities, appearances, NPC records | `.ent`, `.app`, TweakXL `Character` records | EDGEbuilder's scenes; REDnode's `tweakdb` and `world` |
| Seeing it in game | REDnode `world.spawn`, archive hot swap | Yes (the swap waits for RED Hot Tools on 2.5) |

## Meshes

What WolvenKit's importer asks for (its wiki, checked 2026-10-25):

| Rule | What it means for UE assets |
|---|---|
| Import over an **existing** `.mesh` | Every new mesh starts from a template: a prop mesh for props, a body-part mesh on the right rig for NPCs. EDGE keeps a small set of templates |
| Triangulated, no loose geometry | Blender triangulates and cleans |
| **Under 65,535 triangles per mesh** | Nanite meshes often have millions of triangles. Use UE's Nanite fallback mesh, Approximate or Simplify merges, or Blender decimation. **The largest single cost in quality for UE5 content** |
| Submeshes named `submesh_00`, `submesh_01` ...; LODs as 1, 2, 4, 8 | One submesh per UE material slot. UE's LODs map to these. Assets with none get generated LODs |
| A `.rig` for skinned meshes | NPC meshes must name one of the game's rigs |

Also needed, from general knowledge, **unverified** for Cyberpunk in detail:

| Item | Note |
|---|---|
| Units and axes | UE uses centimeters and a left-handed Z-up frame. Blender and glTF use meters, right-handed. The export settings decide it; check once against a known object |
| Bone weights per vertex | UE allows 8 or more. Cyberpunk takes up to 8 through glTF's two weight sets (unverified). Clamp and normalize |
| Collision | UE's simple collision (boxes, capsules, convex hulls) maps onto `entColliderComponent` shapes for simple props. Mesh-exact collision is harder |
| UDIMs and virtual textures | Cyberpunk has no UDIMs. Split by tile into submeshes, or re-pack into one atlas |

## Materials

A UE material is a shader graph. Cyberpunk materials are instances of fixed templates. No general translation exists, so there are two routes:

| Route | When | Result |
|---|---|---|
| **Map** the texture parameters of a UE material instance (BaseColor, Normal, ORM) onto `metal_base.remt` (BaseColor, Normal, Roughness, Metalness, Emissive) | The common UE PBR setup, most Fab props | Close to the source look, cheap, fully automatic. A packed ORM is split into separate maps |
| **Bake** the material to textures with UE's Merge Actors (flatten to BaseColor, Normal, Roughness, Metallic, Emissive, Opacity) | Layered, procedural, vertex-blended or world-aligned materials | It works for anything UE can render onto the UVs, but it is fixed at bake time and costs texture memory. Known gaps: some nodes bake black (Simplygon's notes); Substrate materials fail with the Simplify merge in 5.6 and 5.7 (UE-341753) |

Special cases:

| UE material | Cyberpunk template | Feasibility |
|---|---|---|
| Opaque PBR | `metal_base.remt` | High |
| Masked (foliage, fences) | the same, with an alpha cutoff | High |
| Glass and translucent | the game's glass templates | Medium: tuned by hand |
| Emissive and screens | emissive parameters, or the game's screen materials | Medium |
| Skin (subsurface) | the game's skin template | Medium: it wants the game's own maps (detail, subsurface masks). A MetaHuman's skin textures fit only roughly |
| Hair | the game's hair template with gradient profiles | Medium for **hair cards** (MetaHumans ship card LODs). Strand hair (groom) needs cards made first: UE's Hair Card Generator (experimental) or by hand |
| Eyes | the game's eye templates | Low to medium: a game eye mesh is easier |
| Multilayered (`.mlsetup`) | Cyberpunk's own layering, which EDGEmat edits | Optional: rebuilding a UE look as layers keeps tiling detail sharp, but takes an artist or EDGEmat's AI |

Normal maps: UE uses the DirectX convention (green down). Which one Cyberpunk's importer expects is **unverified**. Check with one test texture and flip the green channel if needed.

## Rigs: the decision that sets the cost

Cyberpunk's NPCs run on a handful of body rigs (man, woman, big man, child and so on), each with its own facial rig. Its animations, animation graphs, AI behaviours, workspots and scenes all assume those rigs. That gives two paths:

| Path | What happens | Gains | Losses |
|---|---|---|---|
| **A. Onto the game's rig** (recommended) | The UE character is fitted onto the closest body (proportions, bind pose), then weights are copied from a game body and fixed by hand (the wiki's clothing refit method) | Walks, fights, sits, uses workspots, takes the game's AI and clothing: a real NPC | Proportions far from human (very tall, stylised) look wrong. UE-specific bones (twist, corrective) are dropped or folded into the nearest bone |
| **B. Keep the UE skeleton** | A new `.rig` from the UE skeleton, with its own animations | The shape and motion stay as in UE | No game animation or AI works: it is a puppet. Fine for a statue or an animated set piece, not for an NPC |

Path A is the realistic one for "NPCs primarily". Automating it is the largest part of the work:

1. A bone map per source skeleton: UE5 Mannequin (Manny, Quinn), MetaHuman body, and generic Mixamo-style. Cyberpunk's bone names and rest poses come from its `.rig` files (read with REDbridge).
2. Fitting: scale and pose the source onto the target rig's bind pose. Mannequin and MetaHuman bodies are close to human proportions, so this mostly works. The rest needs a person.
3. Weights: copy from the matching game body, then let the source's own weights win where they agree (hands, fingers). Clamp to 8, normalize.
4. Split into the parts a game appearance expects (head, torso, arms, legs, feet, hair) where the asset allows it. One whole-body part also works, but loses mixing with game clothes.

### Faces

The face is the weak point.

| Option | Effort | Result |
|---|---|---|
| A game head, with the UE character's skin or a near match | Low | Speaks, emotes, takes lipsync. Doesn't look like the UE face |
| The UE head weighted to the head's few big bones (jaw, eyes, neck) | Medium | Looks like the source; blinks and opens its jaw at best. No real expressions |
| The UE head on one of the game's facial rigs (22 exist, per the wiki) | High: research | Full expressions and lipsync, if it works. The wiki said in March 2024 that importing your own facial expressions was not yet supported by the tools. A MetaHuman's face (blendshapes, RigLogic) has no direct match |

Recommendation: start with the first or second option. Treat speaking UE faces as research.

## Animations

| Kind | Path | Feasible? |
|---|---|---|
| Poses and idles for photo mode or AMM | Retarget in UE (IK Retargeter, with the game's skeleton imported into UE as the target), export FBX, then glTF, then WolvenKit's Anims import into an `.anims` set (an existing community workflow) | **Yes**, the best-trodden path |
| Clips an NPC plays in a scene | The same, played through a workspot (an invisible device `.ent` with a workspot component: the wiki's method) or a scene | Yes |
| Replacing an NPC's walk, run, combat | The NPC's animation graph and its animation sets | Hard: many clips, root motion, blending. Not a first phase |
| Animated props | A clip on the prop's own small rig, with a simple looping graph | Yes |

Doing the retarget **inside UE** is the key choice: its IK Retargeter is better than Blender's options and is scriptable. The wiki warns that arm bones often don't carry over cleanly between rigs, so expect a check pass.

## What EDGE would build

If this goes ahead, one phase at a time, each with an in-game test:

| Phase | What | Rough effort (Claude building, the user testing) | Proves |
|---|---|---|---|
| **U0 Spike** | One Fab prop and one Mannequin-based character, by hand through UE, Blender and WolvenKit. Note every manual step | 2 to 3 sessions | The real rules: units, normal map green channel, weight limits, what breaks |
| **U1 Props** | A UE editor script (export and manifest), a headless Blender step, REDbridge import onto templates, EDGEmat "from PBR set", `.ent` output, an EDGEbuilder scene to place it | 4 to 6 sessions | Fab prop to in game in minutes |
| **U2 Baked materials and LODs** | Merge Actors baking for complex materials, Nanite reduction, generated LODs, collision shapes | 3 to 4 sessions | Typical UE5 environment kits |
| **U3 Characters** | Bone maps (Mannequin, MetaHuman), fitting and weight transfer in Blender, part splitting, `.app` and a TweakXL `Character` record, spawn through REDnode's `world` | 6 to 10 sessions | A UE character as a walking, idle, fighting NPC with a game head or a simple face |
| **U4 Animations** | The game's skeleton into UE, IK Retargeter presets, batch export and `.anims` import, workspot hook-up | 3 to 5 sessions | UE animations played by NPCs and in photo mode |
| U5 Faces (optional) | Research on the facial rigs | Open-ended | Whether UE faces can speak |

U0 to U2 are low risk and give the most value per hour. U3 is where the time goes. U5 should wait until the rest proves worth it.

## Tradeoffs in one place

| Tradeoff | Why |
|---|---|
| Polygons and detail | Nanite assets must be cut under 65,535 triangles per mesh, with LODs |
| Live materials become textures | Baked looks can't be changed in game, and cost more texture memory than the game's tiling layers |
| UE skeleton or game behaviour | Keeping the UE rig loses every game animation and the AI. Moving to the game's rig loses UE-specific bones and odd proportions |
| Faces | Talking UE faces are research. Game heads are the practical choice |
| Licenses | Each asset's terms decide what may ship. The tool can record them but can't decide for the modder |
| Dependencies | Needs the UE editor (large install) and Blender beside REDbridge. Players need neither, only modders |
| Game versions | WolvenKit's import follows the game. On 2.5 that is WolvenKit 10 (beta for now), which REDbridge doesn't ship yet |

## Sources

- WolvenKit wiki, [Import/Export: Mesh](https://wiki.redmodding.org/wolvenkit/wolvenkit-app/usage/import-export/models): import rules.
- RED Modding wiki: [Poses/Animations: make your own](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators/modding-guides/animations/poses-animations-make-your-own), [Retargeting poses and animations](https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/animations/animations/retargeting-poses-animations), [Replace player clothes with an NPC garment](https://wiki.redmodding.org/cyberpunk-2077-modding/for-mod-creators/modding-guides/items-equipment/editing-existing-items/replace-a-player-item-with-an-npc-item/replace-a-player-clothes-with-npc-garment-that-requires-blender-editing) (weight transfer), [Fixing eye clipping by replacing facial rigs](https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/npcs/fixing-eye-clipping-in-npvs-by-replacing-facial-rigs), [Other facial expressions](https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/animations/facial-animations/custom-facial-expressions), [Play animations with workspots](https://wiki.redmodding.org/cyberpunk-2077-modding/modding-guides/animations/abusing-workspots).
- Epic: [Fab launch](https://www.unrealengine.com/blog/fab-epics-new-unified-content-marketplace-launches-today) (Standard License, any engine); [Merging actors](https://dev.epicgames.com/documentation/en-us/unreal-engine/merging-actors-in-unreal-engine); [UE-341753](https://issues.unrealengine.com/issue/UE-341753) (Substrate baking).
- [CG Channel, June 2025](https://www.cgchannel.com/2025/06/you-can-now-sell-metahumans-or-use-them-in-unity-or-godot/): MetaHumans in other engines.
- [Simplygon: material baking in UE5](https://documentation.simplygon.com/SimplygonSDK_10.4.132.0/ue5/concepts/materialbaking.html): nodes that bake black.
