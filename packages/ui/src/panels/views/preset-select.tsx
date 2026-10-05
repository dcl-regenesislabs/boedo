import { Select } from '../../ds'

// one choice that sets several numeric fields at once; reads "Custom" when no option matches
export type PresetSpec = { label: string; doc?: string; options: Array<{ label: string; values: Record<string, number> }> }

export function PresetSelect(props: {
  spec: PresetSpec
  read: (path: string) => number
  apply: (values: Record<string, number>) => void
}): JSX.Element {
  const { spec, read, apply } = props
  const index = spec.options.findIndex((o) => Object.entries(o.values).every(([path, v]) => Math.abs(read(path) - v) < 0.005))
  const options = spec.options.map((o, i) => ({ value: String(i), label: o.label }))
  return (
    <Select
      compact
      value={index === -1 ? 'custom' : String(index)}
      options={index === -1 ? [...options, { value: 'custom', label: 'Custom' }] : options}
      onChange={(v) => {
        const option = spec.options[Number(v)]
        if (option !== undefined) apply(option.values)
      }}
    />
  )
}
