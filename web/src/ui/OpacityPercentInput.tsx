import { opacityToPercent, percentToOpacity } from '../system/color'

type OpacityPercentInputProps = {
  value: number
  onChange: (opacity: number) => void
  ariaLabel: string
  testId: string
  disabled?: boolean
}

export function OpacityPercentInput({
  value,
  onChange,
  ariaLabel,
  testId,
  disabled = false,
}: OpacityPercentInputProps) {
  return (
    <input
      className="opacity-percent-input"
      type="number"
      min={0}
      max={100}
      step={1}
      value={opacityToPercent(value)}
      onChange={(event) =>
        onChange(percentToOpacity(Number(event.target.value)))
      }
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
    />
  )
}
