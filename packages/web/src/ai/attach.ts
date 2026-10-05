import { entityName } from '@scene/custom-components'
import { isUiEntity, state } from '@scene/state'
import { attachScript, refreshScriptLayout } from '@ui/script/attach'
import { attachablePath } from '@ui/script/template'

export interface AttachedTo {
  id: string
  name: string
}

// One per turn, made when it starts: a script the assistant creates goes on the entity selected then,
// and later writes in the turn keep its params in step with the source.
export function scriptAttacher() {
  const target = state.activeEntity
  const attached = new Set<string>()
  return async (path: string, content: string, created: boolean): Promise<AttachedTo | null> => {
    if (target === null || attachablePath(path) !== path) return null
    if (Number(target) < 512 || state.snapshot[target] === undefined || isUiEntity(state.snapshot, target)) return null
    try {
      if (!created) {
        if (attached.has(path)) await refreshScriptLayout(target, path, content)
        return null
      }
      if (!(await attachScript(target, path, content))) return null
      attached.add(path)
      return { id: target, name: entityName(state.snapshot, target) ?? `#${target}` }
    } catch (error) {
      console.error('could not attach the new script:', path, error)
      return null
    }
  }
}
