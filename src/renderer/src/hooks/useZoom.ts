import { useState, useEffect, useCallback } from 'react'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.0
const ZOOM_STEP = 0.1
const DEFAULT_ZOOM = 1.0
const STORAGE_KEY = 'nekocode-zoom'

export function useZoom() {
  const [zoom, setZoomState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = parseFloat(stored)
      if (!isNaN(parsed) && parsed >= MIN_ZOOM && parsed <= MAX_ZOOM) {
        return parsed
      }
    }
    return DEFAULT_ZOOM
  })

  // Apply zoom on mount and when it changes
  useEffect(() => {
    window.nekocode.zoom.set(zoom)
    localStorage.setItem(STORAGE_KEY, zoom.toString())
  }, [zoom])

  // Sync with actual zoom on mount
  useEffect(() => {
    window.nekocode.zoom.get().then((info) => {
      if (info.factor !== zoom) {
        setZoomState(info.factor)
      }
    })
  }, [])

  const setZoom = useCallback((newZoom: number) => {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom))
    setZoomState(clamped)
  }, [])

  const zoomIn = useCallback(() => {
    setZoom(zoom + ZOOM_STEP)
  }, [zoom, setZoom])

  const zoomOut = useCallback(() => {
    setZoom(zoom - ZOOM_STEP)
  }, [zoom, setZoom])

  const resetZoom = useCallback(() => {
    setZoom(DEFAULT_ZOOM)
  }, [setZoom])

  return {
    zoom,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  }
}
