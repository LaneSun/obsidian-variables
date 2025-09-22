# Obsidian Variables Plugin

A plugin for Obsidian that allows you to use dynamic variables in your notes by replacing `{var_name}` placeholders with values from your note's properties (frontmatter) in Live Preview mode.

## How to Use

1. **Add Properties to Your Note**
   ```yaml
   ---
   use-var: true
   character_name: "Alice"
   location: "Wonderland"
   age: 25
   ---
   ```

2. **Use Variables in Your Content**
   ```markdown
   # The Adventures of {character_name}

   {character_name} was a curious girl who lived in {location}.
   At {age} years old, she discovered a magical rabbit hole...

   Later in the story, {character_name} met the Mad Hatter.
   ```

3. **See Live Results**
   In Live Preview mode (with `use-var: true` enabled), you'll see:
   ```
   # The Adventures of Alice

   Alice was a curious girl who lived in Wonderland.
   At 25 years old, she discovered a magical rabbit hole...

   Later in the story, Alice met the Mad Hatter.
   ```

4. **Edit Variables Naturally** (Live Preview only)
   - Click on any variable to see its original `{variable_name}` form
   - Edit the variable name directly in the text
   - Click elsewhere to see the replaced value again

5. **View in Reading Mode**
   - Switch to Reading mode to see variables replaced without editing capabilities
   - Perfect for final review and sharing

## Installation

### Manual Installation

1. Download the latest release from the GitHub releases page
2. Extract the files to your vault's `.obsidian/plugins/obsidian-variables/` folder
3. Reload Obsidian
4. Enable "Variables" in Community Plugins settings

### Building from Source

1. Clone this repository
2. Run `npm install`
3. Run `npm run dev` for development or `npm run build` for production
4. Copy `main.js`, `manifest.json`, and `styles.css` to your plugins folder

## Contributing

This plugin is open source! Contributions are welcome:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request
