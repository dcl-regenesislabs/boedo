import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'
import type { IBaseComponent } from '@well-known-components/interfaces'
import type { BaseComponents } from '../types.ts'

export function createPurgeJobComponent(
  { projectStorage, logs }: Pick<BaseComponents, 'projectStorage' | 'logs'>,
  intervalMs = 60 * 60 * 1000
): IBaseComponent {
  const logger = logs.getLogger('project-purge')
  let timer: ReturnType<typeof setInterval> | undefined
  let pending: Promise<void> | undefined
  let stopping = false
  // each purge run is bounded; one sweep runs them until every wallet was visited
  async function runs() {
    for (let run = 0; run < 1000 && !stopping; run++) {
      if ((await projectStorage.purge()).done) return
    }
  }
  function sweep() {
    pending ??= runs()
      .catch(() => { logger.error('Project purge failed') })
      .finally(() => { pending = undefined })
    return pending
  }
  return {
    async [START_COMPONENT]() {
      await sweep()
      timer = setInterval(() => { void sweep() }, intervalMs)
      timer.unref()
    },
    async [STOP_COMPONENT]() {
      clearInterval(timer)
      stopping = true
      await pending
    }
  }
}
