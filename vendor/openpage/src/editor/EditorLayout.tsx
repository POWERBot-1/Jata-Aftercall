import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { FolderOpen, Layers, Briefcase, UtensilsCrossed, Building2, BookOpen } from 'lucide-react'
import { CanvasToolbar } from './CanvasToolbar'
import { LeftSidebar } from './LeftSidebar'
import { Canvas } from './Canvas'
import { RightSidebar } from './RightSidebar'
import { JsonDrawer } from './JsonDrawer'
import { VersionHistory } from './VersionHistory'
import { GenerationOverlay } from './GenerationOverlay'
import { useConfigStore } from '@openpage/store/configStore'
import { useEditorStore } from '@openpage/store/editorStore'
import { useProjectsStore } from '@openpage/store/projectsStore'
import { generateSiteConfig } from '@openpage/lib/generate-site'
import { templateMeta, buildTemplate } from '@openpage/lib/templates'
import { hexToRgb } from '@openpage/lib/theme-presets'
import { useOpenPagePersistence } from '@/components/studio/openpage/OpenPagePersistenceContext'

const templateIcons: Record<string, typeof Briefcase> = {
  Briefcase, UtensilsCrossed, Building2, BookOpen,
}

function useAutoSaveToProject() {
  const config = useConfigStore((s) => s.config)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const updateProjectConfig = useProjectsStore((s) => s.updateProjectConfig)
  const { websiteId, draftVersion, setDraftVersion, ready } = useOpenPagePersistence()
  const loadedConfigRef = useRef<string | null>(null)

  useEffect(() => {
    loadedConfigRef.current = JSON.stringify(config)
  }, [activeProjectId, websiteId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || !activeProjectId || activeProjectId !== websiteId) return
    const serialized = JSON.stringify(config)
    if (serialized === loadedConfigRef.current) return

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/studio/openpage/document', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ websiteId, expectedDraftVersion: draftVersion, config }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) {
          setIsSaving(false);
          if (response.status === 409) {
            toast.error('This website changed in another session. Reload before continuing.')
          } else {
            toast.error(typeof data.error === 'string' ? data.error : 'OpenPage could not save this draft.')
          }
          return
        }
        loadedConfigRef.current = serialized
        setDraftVersion(data.draftVersion)
        updateProjectConfig(activeProjectId, config)
        toast.success('Draft saved to JATA')
      } catch {
        setIsSaving(false);
        toast.error('Network error. Your latest changes are not yet saved.')
      }
    }, 700)

    return () => window.clearTimeout(timeout)
  }, [config, activeProjectId, websiteId, ready, draftVersion, setDraftVersion, setIsDirty, setIsSaving, updateProjectConfig])
}

function useGenerationOrchestration() {
  const isGenerating = useEditorStore((s) => s.isGenerating)
  const generationPrompt = useEditorStore((s) => s.generationPrompt)
  const clearGeneration = useEditorStore((s) => s.clearGeneration)
  const setGenerationError = useEditorStore((s) => s.setGenerationError)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)
  const setConfig = useConfigStore((s) => s.setConfig)
  const updateProjectConfig = useProjectsStore((s) => s.updateProjectConfig)
  const renameProject = useProjectsStore((s) => s.renameProject)
  const { websiteId } = useOpenPagePersistence()
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!isGenerating || !generationPrompt) return

    const controller = new AbortController()
    abortRef.current = controller

    // Timeout after 30s to prevent infinite loading
    const timeout = setTimeout(() => {
      controller.abort()
      setGenerationError('Generation timed out')
      toast.error('Generation timed out. Try again or add a Gemini API key in Settings.')
      clearGeneration()
    }, 30000)

    generateSiteConfig(generationPrompt, websiteId, controller.signal)
      .then(({ config, source }) => {
        clearTimeout(timeout)
        if (controller.signal.aborted) return
        setConfig(config)
        if (activeProjectId) {
          updateProjectConfig(activeProjectId, config)
          if (config.name) renameProject(activeProjectId, config.name)
        }
        clearGeneration()
        if (source === 'template') {
          toast('Generated with JATA’s built-in design engine. Review the draft before publishing.')
        }
      })
      .catch((err) => {
        clearTimeout(timeout)
        if (err instanceof Error && err.name === 'AbortError') return
        setGenerationError(err instanceof Error ? err.message : 'Generation failed')
        toast.error(err instanceof Error ? err.message : 'Generation failed')
        clearGeneration()
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
      abortRef.current = null
    }
  }, [isGenerating, generationPrompt, websiteId]) // eslint-disable-line react-hooks/exhaustive-deps
}

function EditorEmptyState() {
  const addProject = useProjectsStore((s) => s.addProject)
  const setConfig = useConfigStore((s) => s.setConfig)
  const setActiveProject = useEditorStore((s) => s.setActiveProject)

  function startFromTemplate(tplId: string, tplName: string) {
    const id = addProject(tplName)
    setActiveProject(id)
    setConfig(buildTemplate(tplId, tplName))
  }

  return (
    <div className="h-full flex items-center justify-center">
      <div className="flex flex-col items-center text-center px-6 max-w-md">
        <div className="w-12 h-12 rounded-xl bg-bg-3 border border-border-default flex items-center justify-center mb-4">
          <FolderOpen size={20} className="text-text-3" />
        </div>
        <h2 className="text-[16px] font-display font-semibold text-text-1 mb-1">No project selected</h2>
        <p className="text-text-2 text-[13px] mb-6">Open a project from the Dashboard, or start from a template.</p>

        <button
          onClick={() => window.location.assign('/dashboard')}
          className="px-5 py-2 rounded-xl bg-green text-black text-[13px] font-semibold hover:bg-green-dim active:scale-[0.97] transition-all mb-6"
        >
          Go to Dashboard
        </button>

        <div className="grid grid-cols-2 gap-2 w-full">
          {templateMeta.map((tpl) => {
            const rgb = hexToRgb(tpl.accent)
            const Icon = templateIcons[tpl.icon] || Layers
            return (
              <button
                key={tpl.id}
                onClick={() => startFromTemplate(tpl.id, tpl.name)}
                className="group relative bg-bg-1 border border-border-default rounded-lg p-3 text-left transition-all hover:border-border-hover card-lift hover:card-lift-hover active:scale-[0.97]"
              >
                <div
                  className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
                  style={{ background: `rgba(${rgb}, 0.06)` }}
                />
                <div className="relative">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="w-6 h-6 rounded flex items-center justify-center shrink-0 transition-all opacity-70 group-hover:opacity-100 group-hover:scale-110"
                      style={{ background: `rgba(${rgb}, 0.12)`, color: tpl.accent }}
                    >
                      <Icon size={12} />
                    </div>
                    <div className="text-[11.5px] font-semibold text-text-0">{tpl.name}</div>
                  </div>
                  <div className="text-[10px] text-text-2 leading-snug mb-1.5">{tpl.description}</div>
                  <div className="text-[10px] text-text-3 flex items-center gap-1">
                    <Layers size={9} />
                    {tpl.blockCount} blocks
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function EditorLayout() {
  useAutoSaveToProject()
  useGenerationOrchestration()
  const previewMode = useEditorStore((s) => s.previewMode)
  const activeProjectId = useEditorStore((s) => s.activeProjectId)

  if (!activeProjectId) {
    return <EditorEmptyState />
  }

  return (
    <div className="h-full flex flex-col relative">
      <div className="flex-1 flex overflow-hidden">
        {!previewMode && <LeftSidebar />}
        <div className="flex-1 flex flex-col min-w-0 relative">
          <CanvasToolbar />
          <div className="flex-1 flex flex-col overflow-hidden relative">
            <Canvas />
            <JsonDrawer />
            <GenerationOverlay />
          </div>
        </div>
        {!previewMode && <RightSidebar />}
      </div>
      <VersionHistory />
    </div>
  )
}
