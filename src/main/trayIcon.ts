// Menubar tray icon, embedded rather than loaded from disk.
//
// Deliberately NOT read via appIconPath()/build/icon.png: `build/` is not in
// electron-builder.yml's `files` list, so a disk-loaded icon works in dev and
// silently resolves to an empty NativeImage in the packaged app — an invisible
// menubar icon. Embedding removes the packaging dependency entirely.
//
// These are macOS *template* images: pure black with the shape carried in the
// alpha channel, so the system inverts them for light/dark menubars. Same
// diamond-and-dot glyph as IconMark in renderer/components/icons.tsx.
// Regenerate with the script in the scratchpad if the glyph ever changes.

export const TRAY_ICON_16 = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAUUlEQVR42mNgoDHoh2KyNX+G4n5yNdtAMUmGIGuGAaINwaaZaEPQNYPo81BsQ8gQbDaDNP6H4vOEXEKxARR7gSqBSJVopEpCokpSpkpmIgoAAGzCNoEKxl3ZAAAAAElFTkSuQmCC`;

export const TRAY_ICON_32 = `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAoUlEQVR42u2XMQ6AIAxFOYKjN+7I0Rg5jjKUxBgCVUr7Y2zyF5f3IlBKCH/NVeS4wQ9O9ISbS1zhmWMmcYfvHBOJFrzWcokefLmEBL5M4glcXeINXE1iBN9KqCRxiL+pSEjgudGIsoaE5LdTA15DM8shXfPUEUgze8JdwH0JIDYhxDGEaEQQrRjiMoK4jiEGEoiRDGIohRjLIR4mEE+zb9QJ8D7aBUqm3IkAAAAASUVORK5CYII=`;
