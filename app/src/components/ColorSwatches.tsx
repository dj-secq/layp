import { STICKERS, stickerName } from "../lib/stickers";

export function ColorSwatches({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  return (
    <div className="grid gap-1">
      <span className="meta">Color</span>
      <div className="flex flex-wrap gap-2">
        {STICKERS.map((sticker) => (
          <button
            key={sticker.hex}
            type="button"
            className="swatch press-sm"
            style={{ background: sticker.hex }}
            aria-label={stickerName(sticker.hex)}
            aria-pressed={color === sticker.hex}
            onClick={() => onChange(sticker.hex)}
          />
        ))}
      </div>
    </div>
  );
}
