/**
 * The fixed per-vault palette. Stored in `_vault/vault.json` and written at
 * vault initialisation; editable in Settings. These are *document* colours —
 * they keep their value regardless of the app's light/dark theme.
 */

export interface Swatch {
  hex: string
  name: string
}

export const TEXT_PALETTE: Swatch[] = [
  { hex: '#1a1a1a', name: 'Ink' },
  { hex: '#6b6b6b', name: 'Grey' },
  { hex: '#2a6df4', name: 'Blue' },
  { hex: '#0f8a6a', name: 'Green' },
  { hex: '#c2410c', name: 'Orange' },
  { hex: '#b4245b', name: 'Magenta' },
  { hex: '#6b47d6', name: 'Violet' },
]

export const BACKGROUND_PALETTE: Swatch[] = [
  { hex: '#ffffff', name: 'None' },
  { hex: '#f0f0ef', name: 'Grey' },
  { hex: '#dce7fd', name: 'Blue' },
  { hex: '#d9efe6', name: 'Green' },
  { hex: '#fbe4d5', name: 'Orange' },
  { hex: '#fbdde8', name: 'Pink' },
  { hex: '#e6ddfa', name: 'Violet' },
]

export interface VaultSettings {
  version: number
  palette: { text: string[]; background: string[] }
}

export const DEFAULT_SETTINGS: VaultSettings = {
  version: 1,
  palette: {
    text: TEXT_PALETTE.map((swatch) => swatch.hex),
    background: BACKGROUND_PALETTE.map((swatch) => swatch.hex),
  },
}

/** Merge stored colours onto the default names, so a swatch always has a label. */
export function swatches(colors: string[] | undefined, fallback: Swatch[]): Swatch[] {
  if (!colors?.length) return fallback
  return colors.map((hex, index) => ({ hex, name: fallback[index]?.name ?? `Colour ${index + 1}` }))
}
