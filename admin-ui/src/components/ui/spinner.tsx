/** Centered loading spinner. */
export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground/80">
      <div className="size-5 animate-spin rounded-full border-2 border-input border-t-brand" />
    </div>
  )
}
