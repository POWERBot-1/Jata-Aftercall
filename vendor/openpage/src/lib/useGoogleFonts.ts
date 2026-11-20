import { useEffect, useRef } from 'react'

const DEFAULT_FONTS = new Set(['DM Sans', 'JetBrains Mono', 'Space Grotesk'])
const loadedFonts = new Set<string>()

function fontToGoogleUrl(fontName: string): string {
  const family = fontName.replace(/ /g, '+')
  return `https://fonts.googleapis.com/css2?family=${family}:wght@300;400;500;600;700&display=swap`
}

export function useGoogleFonts(fonts: string[]) {
  const prevRef = useRef<string[]>([])

  useEffect(() => {
    const unique = [...new Set(fonts)].filter(
      (f) => f && !DEFAULT_FONTS.has(f) && !loadedFonts.has(f)
    )

    if (unique.length === 0) return

    const links: HTMLLinkElement[] = []

    for (const font of unique) {
      if (document.querySelector(`link[data-openpage-font="${font}"]`)) {
        loadedFonts.add(font)
        continue
      }

      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = fontToGoogleUrl(font)
      link.setAttribute('data-openpage-font', font)
      document.head.appendChild(link)
      links.push(link)
      loadedFonts.add(font)

      // Preload the font to prevent FOUT
      document.fonts.load(`16px "${font}"`).catch(() => {
        // Font load failed, no-op (CSS fallback will handle it)
      })
    }

    prevRef.current = fonts

    return () => {
      // Don't remove font links on unmount, they're cached and shared
    }
  }, [fonts.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps
}
