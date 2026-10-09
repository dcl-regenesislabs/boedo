import { state } from '@scene/state'
import { entityName, nameKey } from '@scene/custom-components'
import { useStore } from '../../core/store'
import { Select, type SelectOption } from '../../ds'
import { scriptsOn } from '../../script/references'

export function NamedEntityPicker(props: { name: string; value: string; multiple: boolean; zones: boolean; onChange(value: string): void }) {
  const snapshot = useStore(() => state.snapshot)
  const all = Object.keys(snapshot).map((id) => ({ id, name: entityName(snapshot, id) ?? '' })).filter(({ id, name }) => id !== '0' && name.trim() !== '' && !name.includes(','))
  const unique = all.filter((row) => all.filter((other) => nameKey(row.name) === nameKey(other.name)).length === 1)
  const candidates = unique.filter(({ id }) => !props.zones || scriptsOn(snapshot, id).some((script) => /\/trigger-zone\.ts$/.test(script.path)))
  const options: SelectOption[] = candidates.sort((a, b) => a.name.localeCompare(b.name)).map(({ id, name }) => ({ value: name, label: name, hint: `#${id}` }))
  const values = props.multiple ? props.value.split(',').map((v) => v.trim()).filter(Boolean) : [props.value]
  const write = (next: string[]) => props.onChange(props.multiple ? next.join(', ') : next[0] ?? '')
  const select = (value: string, index: number) => {
    const choices = options.filter((o) => !props.multiple || o.value === value || !values.includes(o.value))
    if (value !== '' && !choices.some((o) => o.value === value)) choices.unshift({ value, label: value, hint: 'Missing or ambiguous — choose an entity' })
    return <Select compact aria-label={`${props.name}${props.multiple ? ` ${index + 1}` : ''}`} value={value}
      options={[{ value: '', label: props.zones ? 'Choose a Trigger Area' : 'Choose an entity' }, ...choices]}
      onChange={(next) => write(values.map((v, i) => i === index ? next : v).filter(Boolean))} />
  }
  if (!props.multiple) return select(props.value, 0)
  return <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
    {values.map((value, index) => <div key={`${index}:${value}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span className="eui-script-dim">{index + 1}</span>
      {select(value, index)}
      <button className="eui-btn" aria-label={`Move ${value} up`} disabled={index === 0} onClick={() => {
        const next = [...values]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; write(next)
      }}>↑</button>
      <button className="eui-btn" aria-label={`Remove ${value}`} onClick={() => write(values.filter((_, i) => i !== index))}>×</button>
    </div>)}
    <Select compact aria-label={`Add ${props.name}`} value="" options={[{ value: '', label: '+ Add' }, ...options.filter((o) => !values.includes(o.value))]}
      onChange={(value) => { if (value !== '') write([...values, value]) }} />
    {candidates.length === 0 && <span className="eui-script-dim">{props.zones ? 'Add a Trigger Area from the library first.' : 'Give the target entities unique names first.'}</span>}
  </div>
}
