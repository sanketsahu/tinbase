import { useState } from 'react'
import { api, clearKey, setKey } from '../../api'
import { Button, Input } from '../ui'
import { Logo } from './logo'

/**
 * Sign-in screen that authenticates the studio with a service_role key. On a
 * successful ping the key is kept and `onOk` fires; otherwise it is cleared and
 * an error message is shown.
 *
 * @param props.onOk - Invoked once the entered key validates successfully.
 */
export function Login({ onOk }: { onOk: () => void }) {
  const [key, setKeyInput] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setErr('')
    setKey(key.trim())
    try {
      await api.ping()
      onOk()
    } catch (e) {
      clearKey()
      setErr('Invalid service_role key: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-[400px] text-center">
        <div className="mb-4 flex justify-center">
          <Logo size={48} />
        </div>
        <h1 className="text-lg font-semibold">tinbase studio</h1>
        <p className="mt-1 text-[13px] text-muted-foreground/80">
          Sign in with the <span className="text-foreground/80">service_role</span> key printed when tinbase started.
        </p>
        <div className="mt-5 space-y-3 text-left">
          <Input
            type="password"
            placeholder="service_role key (eyJ…)"
            value={key}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <Button className="w-full" onClick={submit} disabled={busy || !key.trim()}>
            {busy ? 'Checking…' : 'Continue'}
          </Button>
          {err && <p className="text-xs text-destructive">{err}</p>}
        </div>
      </div>
    </div>
  )
}
