# LazyChamp

**A browser extension for Pokémon Showdown that converts Pokémon sets and teams between regular Showdown formats and Pokémon Champions formats.**

LazyChamp compares regular Showdown EV spreads with Pokémon Champions stat points, side by side. It can import and export sets in Showdown paste format, convert entire teams, help preserve Speed benchmarks, and integrate directly into Pokémon Showdown's Team Builder.

## Features

### Individual Pokémon calculator

- Search for a Pokémon or paste a set under **Import a set**.
- Adjust an EV slider and the corresponding Champions Points update automatically, or adjust the points and see the EV value update.
- Both sides display the resulting stat.
- Once a set exists, two output blocks appear below the table: **Show Showdown set** and **Show Champions set**. Both are enabled by default and include a copy button. Either block can be switched off to save space.
- **Import set** on the Champions side converts a regular EV paste (including values above 32) into Champions Points. A line beginning with `SPs:` is always interpreted as points.

### Convert a whole team

At the bottom of the panel, choose the **Import team format**, paste a team, and use the corresponding conversion button.

- **Regular Showdown 510 EVs** → **Convert Showdown → Champions**. Each Pokémon must have no more than 252 EVs in any stat and 510 EVs total.
- **Champions 66 Points** → **Convert Champions → Showdown**. Each Pokémon must have no more than 32 points in any stat and 66 points total.

For Showdown-to-Champions conversion, the output keeps names, items, abilities, natures, and moves, adds `Level: 50`, and removes `IVs:` lines because Champions fixes IVs at 31. Any IV value other than 31 is reported.

For Champions-to-Showdown conversion, a `Level:` line is ignored because Champions points always represent level 50; the output has no Level line.

If any Pokémon is invalid, the team is not converted. Each problem is listed by Pokémon number and name.

Some results produce warnings without blocking conversion:

- A converted result that needs more than 66 Champions Points.
- Exact Champions stats that require more than 510 EVs in regular Showdown (for example, 32/32/2 points requires 516 EVs).

LazyChamp does not silently trim stat allocations. If Speed Creep Assumption is off during Showdown-to-Champions conversion, a warning explains the option and lets you choose **Continue** with it enabled or **Continue anyway** without it.

Use **Copy converted team** to copy the result.

### Convert the team you're editing in Pokémon Showdown

LazyChamp integrates with Pokémon Showdown's Team Builder and adds controls beside **Add Pokémon** in the team being edited:

- In the new client, the controls appear in the **Team** tab.
- In the classic client, they appear in the team's Teambuilder view.

**Convert to Champions** converts the current team only. It switches the team's format and rewrites each Pokémon using the calculator's conversion logic: EVs become Champions Points, the level becomes 50, IV lines are removed, and Speed Creep Assumption is applied if enabled. Nickname, gender, item, ability, nature, moves, and other set details are kept.

If the team cannot be converted—for example, because it has more than 510 EVs, contains an unknown Pokémon, is read-only, or the target format is missing from Showdown's format list—nothing is changed and the reason is displayed.

The **settings (cog) button** opens the conversion settings. You can choose the target format:

- **[Champions] Draft**
- **[Champions] NatDex Draft**

You can also enable or disable Speed Creep Assumption. This is the same setting used by the LazyChamp calculator.

After conversion, a notice below the controls describes what was converted, lists warnings, and offers **Undo**. Undo remains available until the page is reloaded.

The teams that receive these controls are determined from Pokémon Showdown's own format data (`Dex.formats`), which LazyChamp reads each time:

- Shown for generation 3 and newer formats, and for a team with no format selected.
- Hidden for generation 1 and 2 formats, including OMs running on a generation 1 or 2 mod.
- Hidden for Let's Go formats (which do not use EVs) and for teams already using a Champions format.

LazyChamp intentionally does not remove Pokémon, moves, items, or abilities that the Champions format does not allow. They are kept as they are; use Showdown's own **Validate** feature to see what needs fixing.

### Speed Creep Assumption

Level 50 stat rounding can cause a converted Pokémon to tie with something it outsped in the original format. When Speed Creep Assumption is enabled, each Speed conversion:

1. Takes the Pokémon's Speed in the source format (for example, 380 at level 100).
2. Finds the Pokémon with the highest maximum Speed that is still below that value. Maximum Speed means 252 EVs or 32 points, a +Speed nature, and 31 IVs. If a Pokémon has a maximum Speed exactly one point below yours, that is the benchmark (for example, 379 for Meowscarada).
3. Ensures the converted Speed still beats that Pokémon's maximum Speed at the destination level (for example, 192 at level 50 means the converted Pokémon needs 193), using the fewest additional points or EVs possible.

This works in both directions: Showdown to Champions and Champions to Showdown. It is applied during conversions, including when editing EVs or points, changing the nature, or importing a set. Changing the Showdown level box by itself does not trigger a conversion.

Your nature is never changed, and Speed is the only stat adjusted by this assumption. A note below the table explains what happened. The setting and selected conversion format are remembered in this browser using two `localStorage` values; no other settings or team data are stored by this feature.

## How the numbers work

Champions stats use level 50, 31 IVs, and 0–32 points per stat, with a total of 66 points.

A Showdown EV spread is displayed at the selected level (level 100 by default). Linked values show the fewest points or EVs needed to produce the same level 50 stat.

The formulas are tested against a port of Pokémon Showdown's own `getStat` function across every Pokémon, nature multiplier, and point value (728,112 combinations). Run the test with:

```sh
node tests/core.test.js
```

## Pokémon Showdown clients

LazyChamp detects both Pokémon Showdown clients:

- New client
- Classic client

The detected client is available as `window.LazyChamp.client` (`"new"` or `"classic"`) and is also written to the page's `<html>` element as `data-lazychamp-client`.

The LazyChamp tab opens automatically in a secondary position when the Teambuilder is opened, and takes focus when it is created:

- **New client:** a right-hand panel next to Hellodex.
- **Classic client:** a side tab.

It closes only when the Teambuilder and every **Team** tab are closed. Team tabs (one per team being edited) exist only in the new client.

Switching to another side tab is respected. LazyChamp takes focus again only after everything has been closed and the Teambuilder is opened again. If you close LazyChamp manually, it stays closed until then; the toolbar icon can open it at any time.

If neither client is recognised, the toolbar icon opens LazyChamp as a floating window. Press **Esc** to close it.

## Browser compatibility

LazyChamp has dedicated extension versions for:

- Mozilla Firefox
- Chromium-based browsers

Installation links will be added here when the public store listings are available.

## Known limits and testing

- The extension has been tested in headless Chromium against mock Pokémon Showdown pages for the new and classic clients. The new-client mock uses the real Preact library. It has not yet been run against the live site, in Firefox, or alongside Showdex.
- Team tabs are recognised by their room IDs (`team-...`) in the client source. If Showdown changes those IDs, that rule may need updating.
- Base stats come from Showdown's `pokedex.json`. Changes to Champions base stats in a separate data file are not picked up.
- Battle-only formes are hidden from search because Showdown rejects them in teams.
- Speed-creep benchmarks are drawn from every Pokémon in the Pokédex data (including Mega Evolutions), not from a format's legal Pokémon list.
- The Team Builder controls have been tested against mock editors that reproduce the clients' structure, using simplified stand-ins for Showdown's own `Teams` import/export code. Check a converted team with Showdown's **Validate** feature.

## Data and privacy

LazyChamp uses Pokémon Showdown's own `/data/pokedex.json` data, with a bundled copy available as a backup. It requests that data from the same Pokémon Showdown site where the extension is running.

LazyChamp remembers the selected conversion format and Speed Creep Assumption setting in this browser using two `localStorage` values. It does not send team contents to an external service. When you choose **Convert to Champions**, the extension updates the team you are actively editing through Pokémon Showdown's team-management mechanisms; this is an intentional feature, not a background change. The Team Builder also provides an **Undo** option after conversion (available until the page is reloaded).

## License

AGPL-3.0, the same license used by Pokémon Showdown and Showdex. See [LICENSE](LICENSE). The formula test includes a short port of Pokémon Showdown's `getStat` function.
