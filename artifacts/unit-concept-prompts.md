# Unit concept prompts (gpt-image-2 → Tripo image-to-3D)

Reference images for every unit, written for OpenAI's gpt-image-2 and shaped for Tripo's image-to-3D input rules. The units and colors follow the procedural models in `src/scene/rigs.ts`, so the generated models keep the same roles, palette and silhouettes.

## How to keep the style consistent

1. **Generate the anchor first.** Run the assault prompt alone, as a few variations, and pick one. Every other prompt attaches that image as **Image 1** and says to match its rendering, proportions, lighting, background, camera and scale. That is OpenAI's own advice: reuse the anchor image as an input, not only "same style as before".
2. **Keep the shared blocks word for word.** Every prompt below repeats the same Style, Lighting, Camera and Constraints text. Change only the Subject. When something drifts (helmet shape, head size), say it explicitly in the next prompt instead of adding new style words.
3. **One change per edit.** When fixing an image, attach it, name the one thing to change, and end with "Keep everything else the same."
4. **Settings:** each prompt states its aspect ratio (2:3 for characters, 3:2 for rifles, 1:1 for other props), because the ChatGPT app no longer offers an aspect ratio picker. Through the API, use `size=1024x1536`, `1536x1024` or `1024x1024` to match, with `quality=high`. Keep the background opaque (the light gray in the prompt): Tripo takes white or light-gray backgrounds, and gpt-image-2's transparent background is still a preview feature.

## Why the prompts look like this (Tripo's input rules)

- One subject per image, centered, filling 70–85% of the frame, nothing touching the edges.
- A plain white or light-gray background, with soft, even light. Directional light and shadows get baked into the texture.
- A front or slightly angled view, never a steep top-down one, even though the game's camera looks down.
- Characters stand in an A-pose with empty hands. Tripo's rigging wants nothing fused to the silhouette, and the game already moves the rifle and the riot shield on their own bones. So weapons, the shield and the briefcase are separate props.
- Glows (visors, lamps, lens rings, trim) are painted as flat bright color with no bloom. A halo would become geometry and texture. The game adds its glow at runtime.
- The turret and the camera are split at the joints the game animates: base and rotating head.
- Thin parts may not reconstruct: whip antennas, the camera pole, the laser line. Keep those procedural if Tripo drops them.
- For multi-view input, generate the back and side views by editing the approved front image (see the end). Tripo's own Multi-View generator also works. All views must match in pose, light, background and scale.

---

## Characters

### 1. Assault (anchor: run this first, without an input image)

```text
Use case: clean reference image for image-to-3D generation of a single game character. Not a poster, not a scene.

Style: stylized 3D game character render for a near-future neon-noir squad-tactics game, seen in-game from a high isometric camera at about 24 pixels tall. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, chunky stylized proportions: the helmeted head is large, about one sixth of the total height, with slightly oversized hands and boots. No fine surface noise, scratches or texture grain. Light-emitting parts (visors, lamps, lenses, trim) are painted as flat bright color, not glowing.

Aspect ratio: 2:3 portrait, taller than wide.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor line, no props, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: straight-on front view at chest height, orthographic-looking, no perspective distortion, zoomed out. The whole figure is centered and fills only the middle 80% of the image height: leave empty background equal to about one tenth of the image height above the top of the head and the same below the soles of the boots, and empty space on both sides.
Pose: symmetric A-pose for 3D rigging. Both arms hang straight and angle out about 45 degrees from the torso, so arms and body form a wide upside-down V. The hands sit well outside the hips, palms facing inward, fingers together. A clear gap of background separates each arm from the torso from armpit to wrist, and each hand from the thigh by at least a hand's width. Legs straight, feet shoulder-width apart and flat, with a clear gap between the legs. Facing the camera, neutral expression. Empty hands: no weapon, shield or bag in the hands or touching the body.

Subject: squad assault operative. Dark teal-gray tactical suit (#4f7370) with a darker teal vest (#3d5e5b) and dark teal trousers (#253c3f). Burnt-orange armor (#b4613f): large shoulder plates raked outward, a chest plate, shoulder caps and knee pads. Rounded teal helmet (#3b5a58) with a wide visor across the face painted bright orange (#ff8a5b). Belt with small pouches, black gloves, black boots. Broad, sturdy build.

Constraints: one character only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

### 2. Support

```text
Image 1 is the approved style reference. Match its rendering style, proportions, head and hand size, lighting, background, camera angle, framing and scale exactly. Do not copy its outfit, colors or gear.

Use case: clean reference image for image-to-3D generation of a single game character. Not a poster, not a scene.

Style: stylized 3D game character render for a near-future neon-noir squad-tactics game, seen in-game from a high isometric camera at about 24 pixels tall. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, chunky stylized proportions: the helmeted head is large, about one sixth of the total height, with slightly oversized hands and boots. No fine surface noise, scratches or texture grain. Light-emitting parts (visors, lamps, lenses, trim) are painted as flat bright color, not glowing.

Aspect ratio: 2:3 portrait, taller than wide.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor line, no props, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: straight-on front view at chest height, orthographic-looking, no perspective distortion, zoomed out. The whole figure is centered and fills only the middle 80% of the image height: leave empty background equal to about one tenth of the image height above the top of the head and the same below the soles of the boots, and empty space on both sides.
Pose: symmetric A-pose for 3D rigging. Both arms hang straight and angle out about 45 degrees from the torso, so arms and body form a wide upside-down V. The hands sit well outside the hips, palms facing inward, fingers together. A clear gap of background separates each arm from the torso from armpit to wrist, and each hand from the thigh by at least a hand's width. Legs straight, feet shoulder-width apart and flat, with a clear gap between the legs. Facing the camera, neutral expression. Empty hands: no weapon, shield or bag in the hands or touching the body.

Subject: squad field medic. Dark teal-gray tactical suit (#4f7370) with a darker teal vest and trousers. Mint-green (#4cc39b) shoulder caps, knee pads and armbands on both upper arms. Rounded teal helmet with a mint visor (#5ef2c0) across the face. A tall pale-gray medical backpack (#d5dfdb) on the back, as wide as the shoulders, with a large mint cross on its back and a smaller one on its lid; its top edge shows above the shoulders.

Constraints: one character only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

### 3. Recon

```text
Image 1 is the approved style reference. Match its rendering style, proportions, head and hand size, lighting, background, camera angle, framing and scale exactly. Do not copy its outfit, colors or gear.

Use case: clean reference image for image-to-3D generation of a single game character. Not a poster, not a scene.

Style: stylized 3D game character render for a near-future neon-noir squad-tactics game, seen in-game from a high isometric camera at about 24 pixels tall. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, chunky stylized proportions: the helmeted head is large, about one sixth of the total height, with slightly oversized hands and boots. No fine surface noise, scratches or texture grain. Light-emitting parts (visors, lamps, lenses, trim) are painted as flat bright color, not glowing.

Aspect ratio: 2:3 portrait, taller than wide.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor line, no props, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: straight-on front view at chest height, orthographic-looking, no perspective distortion, zoomed out. The whole figure is centered and fills only the middle 80% of the image height: leave empty background equal to about one tenth of the image height above the top of the head and the same below the soles of the boots, and empty space on both sides.
Pose: symmetric A-pose for 3D rigging. Both arms hang straight and angle out about 45 degrees from the torso, so arms and body form a wide upside-down V. The hands sit well outside the hips, palms facing inward, fingers together. A clear gap of background separates each arm from the torso from armpit to wrist, and each hand from the thigh by at least a hand's width. Legs straight, feet shoulder-width apart and flat, with a clear gap between the legs. Facing the camera, neutral expression. Empty hands: no weapon, shield or bag in the hands or touching the body.

Subject: squad scout, slimmer than the others. Teal-gray tactical suit (#3f5b55) with dark teal trousers. A sand-olive hood (#7a6a3a) peaked over the face, with a short stiff brim, falling into a cloak drape down the back to the knees (the drape stays behind the body and does not cover the arms). Yellow goggle visor (#ffd166) across the eyes under the hood. Sand-olive shoulder caps and knee pads.

Constraints: one character only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

### 4. Tech

```text
Image 1 is the approved style reference. Match its rendering style, proportions, head and hand size, lighting, background, camera angle, framing and scale exactly. Do not copy its outfit, colors or gear.

Use case: clean reference image for image-to-3D generation of a single game character. Not a poster, not a scene.

Style: stylized 3D game character render for a near-future neon-noir squad-tactics game, seen in-game from a high isometric camera at about 24 pixels tall. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, chunky stylized proportions: the helmeted head is large, about one sixth of the total height, with slightly oversized hands and boots. No fine surface noise, scratches or texture grain. Light-emitting parts (visors, lamps, lenses, trim) are painted as flat bright color, not glowing.

Aspect ratio: 2:3 portrait, taller than wide.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor line, no props, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: straight-on front view at chest height, orthographic-looking, no perspective distortion, zoomed out. The whole figure is centered and fills only the middle 80% of the image height: leave empty background equal to about one tenth of the image height above the top of the head and the same below the soles of the boots, and empty space on both sides.
Pose: symmetric A-pose for 3D rigging. Both arms hang straight and angle out about 45 degrees from the torso, so arms and body form a wide upside-down V. The hands sit well outside the hips, palms facing inward, fingers together. A clear gap of background separates each arm from the torso from armpit to wrist, and each hand from the thigh by at least a hand's width. Legs straight, feet shoulder-width apart and flat, with a clear gap between the legs. Facing the camera, neutral expression. Empty hands: no weapon, shield or bag in the hands or touching the body.

Subject: squad technician. Dark teal-gray tactical suit (#4f7370) with a darker teal vest and trousers. Steel-blue (#3482ad) shoulder caps, knee pads and a boxy backpack. A round disc drone docked flat on top of the backpack, wider than the shoulders, with four cyan rotor rings (#62d0ff) at its corners. A short, thick antenna mast with a cyan tip rising from the left side of the pack. A cyan wrist screen on the left forearm. Rounded teal helmet with a cyan visor (#62d0ff) across the face.

Constraints: one character only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

### 5. Guard

```text
Image 1 is the approved style reference. Match its rendering style, proportions, head and hand size, lighting, background, camera angle, framing and scale exactly. Do not copy its outfit, colors or gear.

Use case: clean reference image for image-to-3D generation of a single game character. Not a poster, not a scene.

Style: stylized 3D game character render for a near-future neon-noir squad-tactics game, seen in-game from a high isometric camera at about 24 pixels tall. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, chunky stylized proportions: the helmeted head is large, about one sixth of the total height, with slightly oversized hands and boots. No fine surface noise, scratches or texture grain. Light-emitting parts (visors, lamps, lenses, trim) are painted as flat bright color, not glowing.

Aspect ratio: 2:3 portrait, taller than wide.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor line, no props, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: straight-on front view at chest height, orthographic-looking, no perspective distortion, zoomed out. The whole figure is centered and fills only the middle 80% of the image height: leave empty background equal to about one tenth of the image height above the top of the head and the same below the soles of the boots, and empty space on both sides.
Pose: symmetric A-pose for 3D rigging. Both arms hang straight and angle out about 45 degrees from the torso, so arms and body form a wide upside-down V. The hands sit well outside the hips, palms facing inward, fingers together. A clear gap of background separates each arm from the torso from armpit to wrist, and each hand from the thigh by at least a hand's width. Legs straight, feet shoulder-width apart and flat, with a clear gap between the legs. Facing the camera, neutral expression. Empty hands: no weapon, shield or bag in the hands or touching the body.

Subject: corporate security guard, the common enemy. Maroon uniform (#6b3d39) with a darker maroon vest (#4f2f2c) carrying three chest pouches in a row. Dark brown domed helmet (#3a2826) with a short front brim, a square white headlamp (#fff3cf) on the front of the helmet, and a salmon-red visor strip (#ff8a7a) across the eyes. A red beacon light (#ff3b30) on top of the left shoulder. A short radio antenna rising behind the left shoulder. Charcoal trousers (#2a2224), black boots.

Constraints: one character only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

### 6. Heavy

```text
Image 1 is the approved style reference. Match its rendering style, proportions, head and hand size, lighting, background, camera angle, framing and scale exactly. Do not copy its outfit, colors or gear.

Use case: clean reference image for image-to-3D generation of a single game character. Not a poster, not a scene.

Style: stylized 3D game character render for a near-future neon-noir squad-tactics game, seen in-game from a high isometric camera at about 24 pixels tall. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, chunky stylized proportions: the helmeted head is large, about one sixth of the total height, with slightly oversized hands and boots. No fine surface noise, scratches or texture grain. Light-emitting parts (visors, lamps, lenses, trim) are painted as flat bright color, not glowing.

Aspect ratio: 2:3 portrait, taller than wide.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor line, no props, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: straight-on front view at chest height, orthographic-looking, no perspective distortion, zoomed out. The whole figure is centered and fills only the middle 80% of the image height: leave empty background equal to about one tenth of the image height above the top of the head and the same below the soles of the boots, and empty space on both sides.
Pose: symmetric A-pose for 3D rigging. Both arms hang straight and angle out about 45 degrees from the torso, so arms and body form a wide upside-down V. The hands sit well outside the hips, palms facing inward, fingers together. A clear gap of background separates each arm from the torso from armpit to wrist, and each hand from the thigh by at least a hand's width. Legs straight, feet shoulder-width apart and flat, with a clear gap between the legs. Facing the camera, neutral expression. Empty hands: no weapon, shield or bag in the hands or touching the body.

Subject: corporate heavy riot trooper, about 20% broader and bulkier than a standard guard. Maroon body armor (#5c3532) over a dark vest (#47302e). A full dark helmet (#3d3332) with a flat face plate and one narrow red visor slit (#ff6d5c). Bulky rounded shoulder pauldrons (#4a3a3a), thick armored forearms, thick knee guards. Dark slate trousers (#1d2729), heavy black boots.

Constraints: one character only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

### 7. Target

```text
Image 1 is the approved style reference. Match its rendering style, proportions, head and hand size, lighting, background, camera angle, framing and scale exactly. Do not copy its outfit, colors or gear.

Use case: clean reference image for image-to-3D generation of a single game character. Not a poster, not a scene.

Style: stylized 3D game character render for a near-future neon-noir squad-tactics game, seen in-game from a high isometric camera at about 24 pixels tall. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, chunky stylized proportions: the helmeted head is large, about one sixth of the total height, with slightly oversized hands and boots. No fine surface noise, scratches or texture grain. Light-emitting parts (visors, lamps, lenses, trim) are painted as flat bright color, not glowing.

Aspect ratio: 2:3 portrait, taller than wide.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor line, no props, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: straight-on front view at chest height, orthographic-looking, no perspective distortion, zoomed out. The whole figure is centered and fills only the middle 80% of the image height: leave empty background equal to about one tenth of the image height above the top of the head and the same below the soles of the boots, and empty space on both sides.
Pose: symmetric A-pose for 3D rigging. Both arms hang straight and angle out about 45 degrees from the torso, so arms and body form a wide upside-down V. The hands sit well outside the hips, palms facing inward, fingers together. A clear gap of background separates each arm from the torso from armpit to wrist, and each hand from the thigh by at least a hand's width. Legs straight, feet shoulder-width apart and flat, with a clear gap between the legs. Facing the camera, neutral expression. Empty hands: no weapon, shield or bag in the hands or touching the body.

Subject: the assassination target, a corporate executive. A long brown coat (#5b4134) flaring out like a bell to the knees, with a gold trim band at the hem (#c99a45) and a gold collar, dark brown lapels (#4a342a), and a gold seam line down the front. Slicked-back dark hair, gold-tinted sunglasses (#ffcf6b). Brown trousers, dark shoes, dark brown gloves. Unarmed, no bag.

Constraints: one character only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

### 8. VIP

```text
Image 1 is the approved style reference. Match its rendering style, proportions, head and hand size, lighting, background, camera angle, framing and scale exactly. Do not copy its outfit, colors or gear.

Use case: clean reference image for image-to-3D generation of a single game character. Not a poster, not a scene.

Style: stylized 3D game character render for a near-future neon-noir squad-tactics game, seen in-game from a high isometric camera at about 24 pixels tall. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, chunky stylized proportions: the helmeted head is large, about one sixth of the total height, with slightly oversized hands and boots. No fine surface noise, scratches or texture grain. Light-emitting parts (visors, lamps, lenses, trim) are painted as flat bright color, not glowing.

Aspect ratio: 2:3 portrait, taller than wide.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor line, no props, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: straight-on front view at chest height, orthographic-looking, no perspective distortion, zoomed out. The whole figure is centered and fills only the middle 80% of the image height: leave empty background equal to about one tenth of the image height above the top of the head and the same below the soles of the boots, and empty space on both sides.
Pose: symmetric A-pose for 3D rigging. Both arms hang straight and angle out about 45 degrees from the torso, so arms and body form a wide upside-down V. The hands sit well outside the hips, palms facing inward, fingers together. A clear gap of background separates each arm from the torso from armpit to wrist, and each hand from the thigh by at least a hand's width. Legs straight, feet shoulder-width apart and flat, with a clear gap between the legs. Facing the camera, neutral expression. Empty hands: no weapon, shield or bag in the hands or touching the body.

Subject: a VIP the squad escorts. A sharp charcoal suit (#2c363c) with dark lapels (#1f272c), a white shirt front (#e9e3d4), a gold tie (#ffe08a) and a small gold pocket square. A wide-brimmed charcoal fedora with a gold band. Charcoal trousers, polished black shoes, light skin tone (#c9bfae). Unarmed.

Constraints: one character only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

---

## Props (separate models, attached to bones in the game)

All prop prompts attach the approved assault image as Image 1 for the rendering style only.

### 9. Rifles (one image per rifle; swap the Subject line)

```text
Image 1 is the approved style reference. Match its rendering style, materials, lighting and background exactly. Do not include the character.

Use case: clean reference image for image-to-3D generation of a single game prop. Not a poster, not a scene.

Style: stylized 3D game prop render for a near-future neon-noir squad-tactics game. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, slightly chunky proportions. No fine surface noise, scratches or texture grain. Light-emitting parts are painted as flat bright color, not glowing.

Aspect ratio: 3:2 landscape, wider than tall.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: side view of the rifle pointing right, turned about 15 degrees toward the camera so the top is visible, orthographic-looking. Centered, filling about 85% of the image width, small margin on every side.

Subject: a compact assault carbine. Near-black receiver and stock (#141d20), gunmetal barrel and curved magazine (#2b3a3e), a muzzle device, and a flat rail along the top painted bright orange (#ff8a5b).

Constraints: one object only, nothing cropped, no hands, no text, no logos, no watermark, no motion blur, no depth of field.
```

Subject lines for the other rifles:

- **Support:** `Subject: a compact rifle, slightly shorter than a carbine. Near-black receiver and stock (#141d20), gunmetal barrel and curved magazine (#2b3a3e), a muzzle device, and a flat rail along the top painted mint green (#5ef2c0).`
- **Recon:** `Subject: a long scoped marksman rifle with a long stock. Near-black receiver and stock (#141d20), gunmetal barrel, curved magazine and a long telescopic scope (#2b3a3e), a muzzle device, a yellow (#ffd166) ring at the front of the scope and a yellow rail along the top.`
- **Tech:** `Subject: a short compact submachine gun. Near-black receiver and short stock (#141d20), gunmetal barrel and curved magazine (#2b3a3e), a muzzle device, and a flat rail along the top painted cyan (#62d0ff).`
- **Guard:** `Subject: a standard security rifle. Near-black receiver and stock (#141d20), gunmetal barrel and curved magazine (#2b3a3e), a muzzle device, and a flat rail along the top painted red (#ff5148).`
- **Heavy:** `Subject: a short, stocky riot rifle with a thick barrel. Near-black receiver and stock (#141d20), gunmetal barrel and curved magazine (#2b3a3e), a muzzle device, and a flat rail along the top painted red (#ff6d5c).`

### 10. Riot shield

```text
Image 1 is the approved style reference. Match its rendering style, materials, lighting and background exactly. Do not include the character.

Use case: clean reference image for image-to-3D generation of a single game prop. Not a poster, not a scene.

Style: stylized 3D game prop render for a near-future neon-noir squad-tactics game. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, slightly chunky proportions. No fine surface noise, scratches or texture grain. Light-emitting parts are painted as flat bright color, not glowing.

Aspect ratio: 1:1 square.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: front three-quarter view of the shield's outer face, orthographic-looking. Centered, filling about 85% of the image height, small margin on every side.

Subject: a tall rectangular riot shield, roughly half as wide as it is tall, standing upright. Warm gray face (#7d7470) with dark thick rims along the top and bottom edges (#3a3233). A horizontal light-pink viewport strip (#ffb3a6) near the top and a vertical red stripe (#ff6d5c) down the middle below it, forming a T. The edge thickness is visible.

Constraints: one object only, nothing cropped, no hands, no text, no logos, no watermark, no motion blur, no depth of field.
```

### 11. Briefcase (the target's)

```text
Image 1 is the approved style reference. Match its rendering style, materials, lighting and background exactly. Do not include the character.

Use case: clean reference image for image-to-3D generation of a single game prop. Not a poster, not a scene.

Style: stylized 3D game prop render for a near-future neon-noir squad-tactics game. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, slightly chunky proportions. No fine surface noise, scratches or texture grain. Light-emitting parts are painted as flat bright color, not glowing.

Aspect ratio: 1:1 square.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: front three-quarter view, slightly above, orthographic-looking. Centered, filling about 80% of the image, small margin on every side.

Subject: a slim hard-shell executive briefcase standing upright on its bottom edge. Dark brown shell (#2c2420), a short handle on top, and a gold clasp strip (#ffcf6b) along the top edge.

Constraints: one object only, nothing cropped, no hands, no text, no logos, no watermark, no motion blur, no depth of field.
```

---

## Machines (split at the joints the game animates)

### 12. Turret base (static)

```text
Image 1 is the approved style reference. Match its rendering style, materials, lighting and background exactly. Do not include the character.

Use case: clean reference image for image-to-3D generation of a single game prop. Not a poster, not a scene.

Style: stylized 3D game prop render for a near-future neon-noir squad-tactics game. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, slightly chunky proportions. No fine surface noise, scratches or texture grain. Light-emitting parts are painted as flat bright color, not glowing.

Aspect ratio: 1:1 square.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: front three-quarter view from slightly above (about 20 degrees), orthographic-looking. Centered, filling about 85% of the image width, small margin on every side.

Subject: the static base of an automated security turret, with nothing mounted on top. A low hexagonal steel base plate (#3d4447) resting on three short splayed feet (#2e3436) spaced evenly around it, a thin red light band (#ff6d5c) around the top of the plate, and a narrow gray column (#4b5356) rising from the center to a round flat bearing ring at the top. The base is about twice as wide as it is tall.

Constraints: one object only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

### 13. Turret head (rotates; barrels attached)

```text
Image 1 is the approved style reference. Match its rendering style, materials, lighting and background exactly. Do not include the character.

Use case: clean reference image for image-to-3D generation of a single game prop. Not a poster, not a scene.

Style: stylized 3D game prop render for a near-future neon-noir squad-tactics game. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, slightly chunky proportions. No fine surface noise, scratches or texture grain. Light-emitting parts are painted as flat bright color, not glowing.

Aspect ratio: 1:1 square.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: front three-quarter view from slightly above (about 20 degrees), orthographic-looking, barrels pointing toward the lower left. Centered, filling about 85% of the image width, small margin on every side.

Subject: the rotating gun head of an automated security turret, with no base or column. A squat wedge-shaped armored housing in dark red-brown (#5a3936) with a sloped front, darker red armored cheek plates on both sides (#7a3f39), a boxy ammo case on the right side (#2e3436), dark vents on the back, and a horizontal red sensor-eye strip (#ff6d5c) across the front. Twin long gun barrels (#1c2427) side by side, pointing forward, each with a thick shroud near the housing and a muzzle brake at the tip. A round bearing collar underneath.

Constraints: one object only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

If the barrels need to recoil one at a time in the new model, generate the housing without barrels as well, plus one barrel on its own, and mount two copies.

### 14. Camera head (tilts)

```text
Image 1 is the approved style reference. Match its rendering style, materials, lighting and background exactly. Do not include the character.

Use case: clean reference image for image-to-3D generation of a single game prop. Not a poster, not a scene.

Style: stylized 3D game prop render for a near-future neon-noir squad-tactics game. Clean hard-surface forms with chamfered edges, matte materials, large flat color zones, simple readable silhouette, slightly chunky proportions. No fine surface noise, scratches or texture grain. Light-emitting parts are painted as flat bright color, not glowing.

Aspect ratio: 1:1 square.
Background: plain flat light-gray studio backdrop (#d9dcdc), no floor, no cast shadow.
Lighting: soft, even, diffused front studio light. No rim light, no colored light, no bloom, no reflections.
Camera: front three-quarter view at the same height as the object, orthographic-looking, lens pointing toward the lower left. Centered, filling about 85% of the image width, small margin on every side.

Subject: the head of a security camera, with no pole. A short pan joint block (#465452) at the bottom holding a U-shaped yoke, which grips a tapered dark housing (#2a3436) that is wider at the front. A flat sun hood (#1f282a) extends over the top past the front. At the front, a round black lens (#0c1213) with a thick red ring (#ff5a4a) and a red center. A small red status light on top.

Constraints: one object only, nothing cropped, no text, no logos, no watermark, no motion blur, no depth of field.
```

The camera's pole (a footplate, a thin 2 m pole and a junction box) is mostly a thin rod, which Tripo reconstructs poorly. Keep it procedural.

---

## Back and side views (for Tripo multi-view)

Attach the approved front image as Image 1, one view per request:

```text
Image 1 is the approved front view. Show the same character from directly behind. Change only the viewing angle. Keep the aspect ratio, A-pose, framing, scale, proportions, outfit, colors, lighting and plain light-gray background identical. Do not redesign anything.
```

```text
Image 1 is the approved front view. Show the same character in exact side profile, facing left. Change only the viewing angle. Keep the aspect ratio, A-pose, framing, scale, proportions, outfit, colors, lighting and plain light-gray background identical. Do not redesign anything.
```

For props, replace "character" with "object" and "A-pose" with "position". Check that the views agree (the same pose, scale and details) before you upload them. Tripo merges conflicting details and tilts the mesh when views don't match.
