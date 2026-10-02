import { useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { ModelInfo } from '../../../../shared/ipc-types'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../ui/command'
import { ProviderIcon, getProviderName } from './ProviderIcon'

interface ModelSelectorProps {
  activeModel: ModelInfo | null
  modelList: ModelInfo[]
  setModel: (provider: string, id: string) => void
  disabled?: boolean
}

export function ModelSelector({ activeModel, modelList, setModel, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedProvider, setSelectedProvider] = useState(activeModel?.provider ?? '')
  const searchRef = useRef<HTMLInputElement>(null)
  const groups = useMemo(() => {
    const providers = new Map<string, ModelInfo[]>()
    for (const model of modelList) {
      const models = providers.get(model.provider) ?? []
      models.push(model)
      providers.set(model.provider, models)
    }
    return [...providers.entries()]
      .sort(([a], [b]) => getProviderName(a).localeCompare(getProviderName(b)))
      .map(([provider, models]) => ({
        provider,
        models: models.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
      }))
  }, [modelList])
  const group = groups.find(({ provider }) => provider === selectedProvider) ?? groups[0]
  const provider = group?.provider ?? ''
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  const visibleModels = (group?.models ?? []).filter(model =>
    terms.every(term => `${model.name} ${model.id}`.toLowerCase().includes(term)),
  )

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      setQuery('')
      if (nextOpen) setSelectedProvider(activeModel?.provider ?? '')
    }}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="min-w-0 max-w-full shrink gap-2 text-text-secondary hover:bg-surface-800 hover:text-text-primary"
          aria-label={`Choose model${activeModel ? `, current model: ${activeModel.name}` : ''}`}
        >
          <ProviderIcon provider={activeModel?.provider ?? ''} />
          <span className="min-w-0 truncate">{activeModel?.name ?? 'Choose model'}</span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[min(85vh,44rem)] flex-col gap-0 overflow-hidden border-surface-700 bg-surface-900 p-0 text-text-primary sm:max-w-3xl"
        onMouseDown={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus() }}
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 pr-12">
          <DialogTitle>Choose a model</DialogTitle>
          <DialogDescription>Choose a provider, then pick a model for your next task.</DialogDescription>
        </DialogHeader>
        <div className="flex h-[min(55vh,30rem)] min-h-0 border-t border-surface-700">
          <nav aria-label="Model providers" className="flex w-36 shrink-0 flex-col gap-1 overflow-y-auto border-r border-surface-700 bg-surface-950/40 p-2 sm:w-52 sm:p-3">
            <span className="px-2 py-2 text-xs font-medium text-muted-foreground">Providers</span>
            {groups.map(item => (
              <Button
                key={item.provider}
                type="button"
                variant={provider === item.provider ? 'secondary' : 'ghost'}
                className="group h-auto justify-start gap-2 px-2 py-2.5 text-text-secondary hover:bg-surface-800 hover:text-text-primary aria-pressed:bg-surface-800 aria-pressed:text-text-primary"
                aria-pressed={provider === item.provider}
                aria-label={getProviderName(item.provider)}
                title={getProviderName(item.provider)}
                onClick={() => { setSelectedProvider(item.provider); setQuery('') }}
              >
                <ProviderIcon provider={item.provider} />
                <span className="truncate">{getProviderName(item.provider)}</span>
                <span className="ml-auto text-xs tabular-nums text-text-secondary group-hover:text-text-primary group-focus-visible:text-text-primary group-aria-pressed:text-text-primary">{item.models.length}</span>
              </Button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            {group && (
              <div className="flex shrink-0 items-center gap-3 px-4 py-4">
                <ProviderIcon provider={provider} />
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">{getProviderName(provider)}</h3>
                  <p className="text-xs text-muted-foreground">{group.models.length} available models</p>
                </div>
              </div>
            )}
            <Command shouldFilter={false} loop className="min-h-0 flex-1 rounded-none bg-surface-900 text-text-primary [&_[data-slot=command-input-wrapper]]:border-surface-700">
              <CommandInput
                ref={searchRef}
                placeholder={`Search ${getProviderName(provider) || 'available'} models…`}
                aria-label="Search models"
                value={query}
                onValueChange={setQuery}
                className="h-12"
              />
              <CommandList className="min-h-0 max-h-none flex-1 p-2 sm:p-3" aria-label="Available models">
                <CommandEmpty>
                  {modelList.length === 0 ? 'No models configured' : 'No models match your search'}
                </CommandEmpty>
                <CommandGroup key={provider}>
                  {visibleModels.map(model => {
                    const current = activeModel?.provider === provider && activeModel.id === model.id
                    return (
                      <CommandItem
                        key={model.id}
                        value={JSON.stringify([provider, model.id])}
                        onSelect={() => { setModel(provider, model.id); setOpen(false) }}
                        className="gap-3 rounded-lg px-3 py-3 data-[selected=true]:bg-surface-800 data-[selected=true]:text-text-primary"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{model.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{model.id}</div>
                        </div>
                        {current && <span className="flex shrink-0 items-center gap-1.5 text-xs"><Check aria-hidden="true" />Current</span>}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-surface-700 px-6 py-3 text-xs text-muted-foreground">
          <span>{visibleModels.length} models · {groups.length} providers</span>
          <span>↑ ↓ navigate · Enter select</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
