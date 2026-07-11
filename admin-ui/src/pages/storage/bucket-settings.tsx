import { Trash2 } from 'lucide-react'
import { Badge, Button, Time } from '../../components/ui'
import type { Bucket } from './index'

const fmtLimit = (bytes?: number | null) => {
  if (bytes == null) return 'Unlimited'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

/** Read-only bucket configuration + the danger zone. */
export function BucketSettings({ bucket, onDelete }: { bucket: Bucket; onDelete: () => void }) {
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="max-w-2xl divide-y divide-border/70">
        <Row label="Visibility" description="Public buckets serve objects without authentication.">
          {bucket.public ? <Badge variant="brand">public</Badge> : <Badge variant="neutral">private</Badge>}
        </Row>
        <Row label="File size limit" description="Uploads above the limit are rejected.">
          <span className="font-mono text-[13px] text-foreground/90">{fmtLimit(bucket.file_size_limit)}</span>
        </Row>
        <Row label="Allowed MIME types" description="Empty means every type is accepted.">
          {bucket.allowed_mime_types?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {bucket.allowed_mime_types.map((m) => (
                <Badge key={m} variant="outline" className="font-mono">
                  {m}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-[13px] text-muted-foreground">Any</span>
          )}
        </Row>
        <Row label="Created" description="">
          <span className="font-mono text-[13px] text-foreground/90">
            <Time value={bucket.created_at} />
          </span>
        </Row>
        <Row label="Delete bucket" description="The bucket must be empty. This cannot be undone.">
          <Button variant="danger" size="xs" onClick={onDelete}>
            <Trash2 size={12} /> Delete bucket
          </Button>
        </Row>
      </div>
      <p className="mt-4 max-w-2xl text-[11px] text-muted-foreground/60">
        Limits and visibility are set when the bucket is created (or via <code>supabase-js</code>'s{' '}
        <code className="text-muted-foreground">updateBucket</code>).
      </p>
    </div>
  )
}

function Row({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-start sm:gap-10">
      <div className="w-56 shrink-0">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground/80">{description}</p>}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
    </div>
  )
}
