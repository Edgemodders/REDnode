# gameCameraSystem

The active camera: the player's view, or a scene's camera.

## GetActiveCameraWorldTransform

Writes the camera's transform into its parameter, which the game does not mark as out. Call it with `api.$out` in place of the parameter to get the value back:

```js
const camera = await api.GameInstance.GetCameraSystem(game.instance);
const r = await camera.GetActiveCameraWorldTransform(api.$out);
const { X, Y, Z } = r.out.transform.position;
```

Measured in game on 2.31 (2026-10-16, [Sound API spike](https://edgemodders.github.io/REDnode/sound.html#s1-spike-results)): the position changes as V walks and stays put while only the camera turns.

## GetActiveCameraForward

The direction the active camera looks along, a unit vector. With `GetActiveCameraWorldTransform`'s position it gives the crosshair's ray: used on 2.5 by the [VATS spike](https://edgemodders.github.io/REDnode/vats.html#spike-test) to find the hit shape under the crosshair (2026-11-14).

## ProjectPoint

A world point (`Vector4`, W 1) to the screen, as the active camera sees it: `X` and `Y` from -1 to 1 with 0 at the screen's centre and `Y` pointing up, `Z` about 0.998 in front of the camera, `W` 1. Read on 2.5 (2026-11-14, [VATS spike](https://edgemodders.github.io/REDnode/vats.html), a body part under the crosshair read about 0, 0; the head above it a positive `Y`, the legs negative). It follows a zoom set through the camera's zoom override. No game script calls it. To page pixels: `x = (X / 2 + 0.5) * width`, `y = (0.5 - Y / 2) * height`.
