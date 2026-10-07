import { friendlyError } from './chat-helpers'

export function ErrorDetails(props: { message: string; hosted: boolean }): JSX.Element {
  const hint = friendlyError(props.message, props.hosted)
  return <>
    <div className="eui-ai-modal-hint">{hint}</div>
    {hint !== props.message && <pre className="eui-ai-errpre">{props.message}</pre>}
  </>
}
