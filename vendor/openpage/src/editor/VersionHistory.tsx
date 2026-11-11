import { useEffect, useRef, useState } from 'react'
import { X, Clock, RotateCcw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useEditorStore } from '@openpage/store/editorStore'
import { useConfigStore } from '@openpage/store/configStore'
import { useOpenPagePersistence } from '@/components/studio/openpage/OpenPagePersistenceContext'
import type { SiteConfig } from '@openpage/blocks/types'

type Revision = {
  draftVersion: number
  source: string
  createdById: string
  createdAt: string
  config: SiteConfig
}

function timeAgo(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 10) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(value).toLocaleString()
}

export function VersionHistory() {
  const { historyOpen, toggleHistory, activeProjectId } = useEditorStore()
  const { websiteId, draftVersion, ready } = useOpenPagePersistence()
  const setConfig = useConfigStore((s) => s.setConfig)
  const panelRef = useRef<HTMLDivElement>(null)
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [loading, setLoading] = useState(false)
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null)

  useEffect(() => {
    if (!historyOpen || !ready) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/studio/openpage/document?websiteId=${encodeURIComponent(websiteId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Could not load saved history.')
        return data.document?.revisions ?? []
      })
      .then((items: Revision[]) => {
        if (!cancelled) setRevisions(items)
      })
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'Could not load saved history.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [historyOpen, ready, websiteId, draftVersion])

  async function restore(revision: Revision) {
    if (revision.draftVersion === draftVersion || restoringVersion !== null) return
    setRestoringVersion(revision.draftVersion)
    try {
      // The normal JATA autosave path creates a new immutable revision from this restored snapshot.
      setConfig(revision.config)
      toast.success(`Restored saved version ${revision.draftVersion}. Saving to JATA…`)
      toggleHistory()
    } catch {
      toast.error('Could not restore this saved version.')
    } finally {
      setRestoringVersion(null)
    }
  }

  // Close on Escape
  useEffect(() => {
    if (!historyOpen) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); toggleHistory() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [historyOpen, toggleHistory])

  // Close on click outside
  useEffect(() => {
    if (!historyOpen) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) toggleHistory()
    }
    const id = setTimeout(() => window.addEventListener('mousedown', handleClick), 0)
    return () => { clearTimeout(id); window.removeEventListener('mousedown', handleClick) }
  }, [historyOpen, toggleHistory])

  return (
    <div
      ref={panelRef}
      className={`absolute top-0 right-0 bottom-0 w-80 bg-bg-1 border-l border-border-default z-50 flex flex-col transition-transform duration-250 ease-in-out ${historyOpen ? 'translate-x-0' : 'translate-x-full'}`}
      aria-label="Saved version history"
    >
      <div className="px-4 py-3.5 border-b border-border-default flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-text-2" />
          <h3 className="text-sm font-semibold">Version History</h3>
          <span className="text-[10px] text-text-3">({revisions.length})</span>
        </div>
        <button onClick={toggleHistory} className="w-7 h-7 rounded flex items-center justify-center text-text-3 hover:text-text-0 hover:bg-bg-3 transition-colors" aria-label="Close version history">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="p-3 rounded-lg bg-green-glow mb-1">
          <div className="flex items-center gap-1.5 text-[11px] text-text-2 mb-1">
            <span>Current draft</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold bg-green-glow text-green">v{draftVersion}</span>
          </div>
          <div className="text-[12.5px] text-text-1">Latest saved state</div>
        </div>

        {loading && <div className="p-4 flex items-center justify-center gap-2 text-[11px] text-text-3"><Loader2 size={13} className="animate-spin" /> Loading saved versions…</div>}

        {!loading && revisions.map((revision) => (
          <button
            key={revision.draftVersion}
            type="button"
            onClick={() => void restore(revision)}
            disabled={revision.draftVersion === draftVersion || restoringVersion !== null || !activeProjectId}
            className="w-full text-left p-3 rounded-lg transition-colors mb-0.5 hover:bg-bg-3 group disabled:opacity-50 disabled:cursor-default"
            title={revision.draftVersion === draftVersion ? 'Current saved version' : 'Restore this version as a new draft'}
          >
            <div className="flex items-center gap-1.5 text-[11px] text-text-2 mb-1">
              <span>v{revision.draftVersion}</span>
              <span>·</span>
              <span>{timeAgo(revision.createdAt)}</span>
              <span className="ml-auto text-[9px] uppercase tracking-wide text-text-3">{revision.source}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[12.5px] text-text-1">{revision.config?.name || 'Website draft'}</div>
              {restoringVersion === revision.draftVersion ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} className="text-text-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
            </div>
          </button>
        ))}

        {!loading && revisions.length === 0 && (
          <div className="p-4 text-center text-[11px] text-text-3">No saved versions yet. Changes appear here after the first successful save.</div>
        )}
      </div>
    </div>
  )
}
