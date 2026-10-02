import { useState } from 'react'
import openai from '../../assets/providers/openai.svg'
import openrouter from '../../assets/providers/openrouter.svg'
import anthropic from '../../assets/providers/anthropic.svg'
import google from '../../assets/providers/google.svg'
import github from '../../assets/providers/github.svg'
import qwen from '../../assets/providers/qwen.svg'
import deepseek from '../../assets/providers/deepseek.svg'
import mistral from '../../assets/providers/mistral.svg'
import groq from '../../assets/providers/groq.svg'
import xai from '../../assets/providers/xai.svg'
import ollama from '../../assets/providers/ollama.svg'
import amazon from '../../assets/providers/amazon.svg'
import azure from '../../assets/providers/azure.svg'
import together from '../../assets/providers/together.svg'
import cerebras from '../../assets/providers/cerebras.svg'
import huggingface from '../../assets/providers/huggingface.svg'

const providers: Record<string, { name: string; icon: string }> = {
  openai: { name: 'OpenAI', icon: openai },
  'openai-codex': { name: 'OpenAI Codex', icon: openai },
  openrouter: { name: 'OpenRouter', icon: openrouter },
  anthropic: { name: 'Anthropic', icon: anthropic },
  google: { name: 'Google', icon: google },
  'google-gemini-cli': { name: 'Google Gemini CLI', icon: google },
  'google-antigravity': { name: 'Google Antigravity', icon: google },
  'google-vertex': { name: 'Google Vertex AI', icon: google },
  'github-copilot': { name: 'GitHub Copilot', icon: github },
  qwen: { name: 'Qwen', icon: qwen },
  'qwen-portal': { name: 'Qwen Portal', icon: qwen },
  deepseek: { name: 'DeepSeek', icon: deepseek },
  mistral: { name: 'Mistral', icon: mistral },
  groq: { name: 'Groq', icon: groq },
  xai: { name: 'xAI', icon: xai },
  ollama: { name: 'Ollama', icon: ollama },
  'amazon-bedrock': { name: 'Amazon Bedrock', icon: amazon },
  'azure-openai-responses': { name: 'Azure OpenAI', icon: azure },
  azure: { name: 'Azure', icon: azure },
  together: { name: 'Together AI', icon: together },
  cerebras: { name: 'Cerebras', icon: cerebras },
  huggingface: { name: 'Hugging Face', icon: huggingface },
}

export function getProviderName(provider: string): string {
  return providers[provider.toLowerCase()]?.name ?? provider
}

export function ProviderIcon({ provider }: { provider: string }) {
  const icon = providers[provider.toLowerCase()]?.icon
  const [failedIcon, setFailedIcon] = useState<string | undefined>()
  return (
    <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-850 text-xs font-semibold text-text-secondary">
      {icon && failedIcon !== icon ? (
        <img src={icon} alt="" className="size-4 brightness-0 invert-[.75] sepia-[.1]" onError={() => setFailedIcon(icon)} />
      ) : (
        getProviderName(provider).slice(0, 2).toUpperCase() || 'AI'
      )}
    </span>
  )
}
