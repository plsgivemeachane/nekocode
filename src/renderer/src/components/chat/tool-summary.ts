export function extractToolSummary(toolName: string, args: unknown): string {
  const short = toolName.replace(/^toolcall_/, '')
  try {
    const a = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
    switch (short) {
      case 'read': {
        let s = String(a.path ?? '')
        if (a.offset) s += `:${a.offset}`
        if (a.limit) s += `-${Number(a.offset || 1) + Number(a.limit)}`
        return s
      }
      case 'write':
        return String(a.path ?? '')
      case 'edit':
        return String(a.path ?? '')
      case 'bash':
        return String(a.command ?? '').split('\n')[0].slice(0, 80)
      case 'powershell':
        return String(a.command ?? '').split('\n')[0].slice(0, 80)
      case 'file_skeleton':
        return String(a.path ?? '')
      case 'repo_map':
        return String(a.keywords ?? '')
      case 'lsp':
        return `${a.action ?? ''} ${a.file ?? ''}`.trim()
      case 'tilldone':
        return String(a.text ?? a.action ?? '')
      case 'context_tag':
        return String(a.name ?? '')
      case 'context_log':
        return ''
      case 'context_checkout':
        return String(a.target ?? '')
      case 'ask_user':
        return String(a.question ?? '').slice(0, 60)
      case 'detect_package_manager':
        return ''
      case 'pi_version':
        return ''
      case 'pi_docs':
        return ''
      case 'pi_changelog':
        return String(a.version ?? 'latest')
      case 'pi_changelog_versions':
        return ''
      default: {
        const values = Object.values(a).filter((v): v is string => typeof v === 'string' && v.length > 0)
        return values[0]?.slice(0, 80) ?? ''
      }
    }
  } catch {
    return ''
  }
}
