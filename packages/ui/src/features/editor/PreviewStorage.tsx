import { useMemo, useState } from 'react'
import { Segmented } from '../../ds'
import type { PreviewStorageScope } from '../worlds/storage'
import { ValueManager } from '../worlds/StorageTab'

// The open preview's own storage, as the scene's server copy reads and writes
// it: test data that lives with this preview, never the published world's.
export function PreviewStorage(props: { realm: string; player: string | null }): JSX.Element {
  const [sub, setSub] = useState<'values' | 'mine'>('values')
  const scope = useMemo<PreviewStorageScope>(() => ({ preview: props.realm }), [props.realm])
  return (
    <div className="eui-storage">
      {props.player !== null && (
        <Segmented
          value={sub}
          onChange={setSub}
          options={[
            { value: 'values', label: 'Data' },
            { value: 'mine', label: 'Your data' }
          ]}
        />
      )}
      <p className="eui-world-hint">Test data for this preview. Your published world keeps its own.</p>
      <ValueManager key={sub} scope={scope} player={sub === 'mine' && props.player !== null ? props.player : undefined} />
    </div>
  )
}
