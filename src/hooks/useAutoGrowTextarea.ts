import { useEffect, type RefObject } from 'react'

/** Grows a textarea to fit its content whenever `value` changes. */
export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  minHeight = 56,
) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`
  }, [ref, value, minHeight])
}
