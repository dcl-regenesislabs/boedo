import { useStore } from '@ui/core/store'
import { hostedRoute } from '@ui/engine/hosted'
import { SceneLoader } from '@ui/features/editor/SceneLoader'

// The docked editor. Its scene list is the HUD's Create page (mountHome), so with
// no scene open there is nothing here.
export function Root(): JSX.Element | null {
  const project = useStore(() => hostedRoute.project)
  const opens = useStore(() => hostedRoute.opens)
  // a re-open (Try again, a changed parcel layout) starts the project over, as desktop's page load does
  return project === null ? null : <SceneLoader key={`${project}#${opens}`} project={project} />
}
