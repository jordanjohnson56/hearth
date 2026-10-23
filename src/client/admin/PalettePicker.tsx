import { PERSON_COLORS } from '../../core/personColor.js';
import type { PersonColor } from '../../core/personColor.js';

/**
 * The person palette as a row of swatches (radio buttons, 44 px targets),
 * for any admin form that picks a color: a person, a calendar source. Each
 * swatch is drawn from the theme's `--person-<token>`, so it matches what
 * the wall shows in the current theme. `name` groups the radios and must be
 * unique on the page.
 */
export function PalettePicker({
  name,
  value,
  onChange,
  legend = 'Color',
}: {
  name: string;
  value: PersonColor;
  onChange: (color: PersonColor) => void;
  legend?: string;
}) {
  return (
    <fieldset className="palette-picker">
      <legend>{legend}</legend>
      <div className="palette-swatches">
        {PERSON_COLORS.map((color) => (
          <label key={color} className="palette-swatch" title={color}>
            <input
              type="radio"
              name={name}
              value={color}
              checked={value === color}
              onChange={() => {
                onChange(color);
              }}
            />
            <span className="palette-swatch-color" style={{ background: `var(--person-${color})` }} />
            <span className="visually-hidden">{color}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
