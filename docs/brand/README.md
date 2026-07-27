# Brand assets

Avatars for the Telegram bot and release channel, generated from the app's own
mark (`app/icon.svg`) so they read as the same product.

`generate-avatars.mjs` is the only source here — the PNG/SVG it emits are
gitignored build output. Regenerate them whenever you need a copy, and
**re-render and re-upload them if the app's mark or brand violet ever changes**,
or these will quietly stay the old logo.

```bash
node docs/brand/generate-avatars.mjs docs/brand
```

| Output        | Use               | Design                                                     |
| ------------- | ----------------- | ---------------------------------------------------------- |
| `channel.png` | Release channel   | The gift mark on the brand violet gradient                 |
| `bot.png`     | Bot profile photo | A rocket on violet→pink, echoing the "🚀 released" message |

Both are 512×512 PNG — Telegram's recommended minimum. It masks profile photos
to a **circle**, so the designs are full-bleed (the corners are discarded) with
the subject inside the inscribed circle. They're tuned to stay legible at 40px,
the size Telegram uses in chat lists, which is why the rocket's fins are solid
pale violet rather than translucent white.

## Setting them

- **Bot** — message [@BotFather](https://t.me/BotFather), `/setuserpic`, pick the
  bot, send `bot.png`.
- **Channel** — channel → Edit → tap the photo → upload `channel.png`. Telegram
  offers a crop; keep it centred and full-frame.

## Changing them

Colours and shapes live in `generate-avatars.mjs`: the two gradients at the top,
then the `GIFT` and `ROCKET` groups. It renders with `sharp`, already a
dependency. The script also writes a circle-masked `*-circle.png` for each, so
you can check a design survives Telegram's crop before uploading it.
