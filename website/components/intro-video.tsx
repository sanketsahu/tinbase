import { cn } from '@/lib/utils'

/**
 * Cloudflare Stream intro video, embedded via the generic iframe player.
 * Framed like a Card, no client JS — the player loads lazily in its iframe.
 *
 * The frame is sized to the video's *exact* native aspect ratio (width/height)
 * rather than a hardcoded 16:9. Even a sub-pixel mismatch leaves the player
 * pillarboxing the poster with a light letterbox bar on each side, so matching
 * the ratio precisely is what keeps those bars from ever appearing.
 */
export function IntroVideo({
  videoId,
  title = 'tinbase intro',
  width = 3554,
  height = 2000,
  className,
}: {
  videoId: string
  title?: string
  width?: number
  height?: number
  className?: string
}) {
  return (
    <div
      style={{ aspectRatio: `${width} / ${height}` }}
      className={cn(
        'relative w-full overflow-hidden rounded-xl border border-border bg-surface-2 shadow-2xl shadow-black/5 ring-1 ring-black/5 dark:shadow-black/40',
        className
      )}
    >
      <iframe
        src={`https://iframe.videodelivery.net/${videoId}?letterboxColor=transparent`}
        title={title}
        loading="lazy"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  )
}
