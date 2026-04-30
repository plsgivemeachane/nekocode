import { useState, useEffect, useCallback } from 'react'
import type { ModelInfo } from '../../../shared/ipc-types'
import { createLogger } from '../logger'

const logger = createLogger('useModelSelection')

interface UseModelSelectionOutput {
  activeModel: ModelInfo | null
  modelList: ModelInfo[]
  setModel: (provider: string, modelId: string) => Promise<void>
}

export function useModelSelection(sessionId: string | null): UseModelSelectionOutput {
  const [activeModel, setActiveModel] = useState<ModelInfo | null>(null)
  const [modelList, setModelList] = useState<ModelInfo[]>([])

  // Fetch the active model for the current session
  useEffect(() => {
    if (!sessionId) {
      setActiveModel(null)
      return
    }
    let cancelled = false
    window.nekocode.session.getModel(sessionId).then((model) => {
      if (!cancelled) setActiveModel(model)
    }).catch(() => {
      if (!cancelled) setActiveModel(null)
    })
    return () => { cancelled = true }
  }, [sessionId])

  // Fetch available models list
  useEffect(() => {
    let cancelled = false
    window.nekocode.session.listModels().then((models) => {
      if (!cancelled) setModelList(models)
    }).catch(() => {
      if (!cancelled) setModelList([])
    })
    return () => { cancelled = true }
  }, [])

  const setModel = useCallback(
    async (provider: string, modelId: string): Promise<void> => {
      if (!sessionId) return
      try {
        const updated = await window.nekocode.session.setModel(sessionId, provider, modelId)
        setActiveModel(updated)
      } catch (err) {
        logger.error(`setModel failed: ${err}`)
      }
    },
    [sessionId],
  )

  return { activeModel, modelList, setModel }
}
