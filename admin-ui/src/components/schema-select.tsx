import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { isManagedSchema, setDbSchema, useDbSchema } from '../lib/schema'
import { Select } from './ui'

/** `schema <name>` dropdown fed by the live schema list. */
export function SchemaSelect({ className = 'w-44 shrink-0', size }: { className?: string; size?: 'sm' | 'xs' }) {
  const [schema, setSchema] = useDbSchema()
  const [schemas, setSchemas] = useState<string[]>([schema])

  useEffect(() => {
    api.schemas().then(
      (list) => {
        setSchemas(list)
        // selected schema vanished (dropped) — fall back to public
        if (!list.includes(schema)) setDbSchema(list.includes('public') ? 'public' : (list[0] ?? 'public'))
      },
      () => {}
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Select
      className={className}
      size={size}
      mono
      value={schema}
      onValueChange={setSchema}
      options={schemas.map((s) => ({
        value: s,
        label: (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-sans text-muted-foreground/70">schema </span>
            {s}
            {isManagedSchema(s) && <Lock size={10} className="text-muted-foreground/60" />}
          </span>
        ),
      }))}
    />
  )
}
