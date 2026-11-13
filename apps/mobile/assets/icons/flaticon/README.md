# Flaticon tab icons

Uicons by [Flaticon](https://www.flaticon.com/uicons), Regular Rounded (`fi-rr`).

| App tab | Official icon | Codepoint |
| --- | --- | --- |
| 소식 | `newspaper` | `f9a5` |
| 동수 | `camping` | `f34a` |
| 내 신청 | `calendar-check` | `f324` |
| 내 계정 | `user` | `fea0` |

Source: the official [`@flaticon/flaticon-uicons`](https://www.npmjs.com/package/@flaticon/flaticon-uicons) package, pinned to **3.3.1** as a development dependency. The package is linked by Flaticon's [official installation guide](https://www.flaticon.com/uicons/get-started/). `package-lock.json` retains the npm archive's SHA-512 integrity value.

The font files and derived `regular-rounded.json` are **not committed or redistributed as source assets**. `npm ci` runs `scripts/generate-flaticon-icons.mjs` after installation. It checks the pinned package version, the WOFF font's SHA-256 and the four CSS codepoints, then uses pinned **fontkit 2.0.4** to generate only those four outlines locally. The generator preserves the original 300-unit grid and flips the font coordinate system vertically for SVG rendering. Its output records the source version, archive integrity and font SHA-256. The remaining font library is not bundled into the app.

Run `npm run generate:icons` manually after an installation with `--ignore-scripts`. The same generator also runs before `npm start`, `npm run export`, and the native-project generation command `npm run prebuild`. Icon generation itself is local and does not fetch files. Install development dependencies for app builds; they provide the source package and generator. Icons render locally with `react-native-svg`; they do not load a remote font or contact Flaticon at runtime.

These icons use the **Flaticon License**, not the application's own license. The original package license is retained in [LICENSE.txt](LICENSE.txt). Attribution is shown in the account screen for signed-in and signed-out visitors as **Uicons by Flaticon**, linked to the official Uicons page. See the [attribution instructions](https://www.flaticon.com/uicons/get-started/#how-to-attribute) and [Flaticon terms](https://www.flaticon.com/legal).
