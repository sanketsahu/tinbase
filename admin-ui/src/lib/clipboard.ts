import { toast } from '../components/ui/toast'

/**
 * Copies a value to the clipboard and shows toast feedback.
 *
 * @param value - The text to write to the clipboard.
 * @param label - Label used in the success toast (defaults to `'Value'`).
 * @returns A promise that resolves to `true` on success, `false` on failure.
 */
export function copyText(value: string, label = 'Value'): Promise<boolean> {
  return navigator.clipboard.writeText(value).then(
    () => {
      toast.success(`${label} copied`)
      return true
    },
    () => {
      toast.error('Clipboard write failed')
      return false
    }
  )
}
