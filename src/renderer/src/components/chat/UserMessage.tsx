interface UserMessageProps {
  content: string
}

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="flex justify-end animate-fade-in">
      <div className="max-w-[80%] bg-transparent border-2 border-accent-500/30 text-text-primary rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-wrap break-words">
        {content}
      </div>
    </div>
  )
}
