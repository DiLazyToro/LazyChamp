# LazyChamp

**A Pokémon Showdown extension for converting teams between traditional Pokémon formats and Pokémon Champions formats.**

LazyChamp makes adapting your existing competitive teams to Pokémon Champions easier by automatically converting EVs into Champions Points, helping preserve important Speed benchmarks, and integrating directly into Pokémon Showdown's Team Builder.

## What is LazyChamp?

Pokémon Champions uses a different stat distribution system from traditional Pokémon formats. Instead of EVs, it uses Champions Points.

Simply changing a team's format in Pokémon Showdown can result in incorrect stat allocations and validation errors.

LazyChamp solves this problem by automatically converting your Pokémon's EVs into Champions Points, while providing additional tools to preserve important stat benchmarks and simplify team conversion.

## Features

### 1. Individual Pokémon Conversion

Import an existing Pokémon set or create one from scratch.

LazyChamp supports two import formats:

- **Showdown Format:** Standard EVs, Level 100.
- **Champions Format:** Champions Points, Level 50.

Once imported, LazyChamp automatically converts the Pokémon's EV distribution into the corresponding Champions Points allocation.

### 2. Speed Creep Assistance

One of LazyChamp's most useful features is its **Speed Creep Assumption**.

When converting a Pokémon to Level 50, certain Speed benchmarks may be lost due to stat rounding. This can cause your Pokémon to tie with, or become slower than, Pokémon you originally intended to outspeed.

LazyChamp analyzes your Pokémon's original Speed stat, identifies relevant Speed benchmarks, and can automatically allocate an additional Champions Point to preserve your Speed advantage whenever possible.

It also provides an analysis explaining which Pokémon your set can outspeed and whether your intended benchmark can still be achieved.

### 3. Full Team Conversion

Convert an entire team at once instead of processing Pokémon individually.

Simply paste your team into the conversion box and choose one of the available conversion options:

- **Regular Showdown 510 EVs:** Converts a traditional team into the corresponding Pokémon Champions format.
- **Champions 66 Points:** Converts a Champions team back into a format using the 66-point distribution.

LazyChamp processes the entire team, adjusts the stat allocations, and provides a Speed Creep analysis for the relevant Pokémon.

You can then copy the converted team directly into Pokémon Showdown.

### 4. Pokémon Showdown Integration

LazyChamp also integrates directly into Pokémon Showdown's Team Builder.

It adds two conversion buttons that allow you to convert your current team without manually copying and pasting it into the extension.

Before converting, you can enable or disable Speed Creep Assumption depending on whether you want to preserve your Speed benchmarks.

Once converted, your team will automatically switch to the appropriate Champions format, with its EVs replaced by the corresponding Champions Points.

And if you change your mind, you can simply use the undo function to restore your previous team.

## Getting Started

After installing LazyChamp, simply open Pokémon Showdown's Team Builder.

The extension automatically appears and remains available while you're using the Team Builder, even when switching between tabs.

You can use it to:

- Convert individual Pokémon.
- Process entire teams.
- Directly convert your existing Showdown teams with just a couple of clicks.

## Browser Compatibility

LazyChamp has dedicated versions for:

- Mozilla Firefox
- Chromium-based browsers

Installation links and additional instructions will be added here once the public releases are available.

---

**LazyChamp makes adapting your existing competitive teams to Pokémon Champions simpler, faster, and less prone to stat-distribution mistakes.**
