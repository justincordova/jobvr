import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/cn'
import type { Job } from '@/lib/types'
import { STAGES, stageInfo } from './stages'

const TONE: Record<(typeof STAGES)[number]['tone'], string> = {
  neutral: 'bg-raised text-dim ring-line hover:text-paper',
  info: 'bg-info/10 text-info ring-info/30',
  go: 'bg-go/10 text-go ring-go/30',
  stop: 'bg-stop/10 text-stop ring-stop/30',
}

/** An applied job's stage, as a badge that opens the choices. */
export function StageMenu({
  stage,
  disabled,
  onChange,
}: {
  stage: Job['stage']
  disabled?: boolean
  onChange: (stage: Job['stage']) => void
}) {
  const current = stageInfo(stage)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Application status: ${current.label}`}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[0.68rem] leading-none font-medium tracking-wide uppercase ring-1 transition-colors pointer-coarse:py-1.5',
            TONE[current.tone],
          )}
        >
          {current.label}
          <ChevronDown className="size-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuLabel>How it went</DropdownMenuLabel>
        {STAGES.map((s) => (
          <DropdownMenuCheckboxItem
            key={s.label}
            checked={s.value === (stage ?? null)}
            onCheckedChange={() => s.value !== (stage ?? null) && onChange(s.value)}
          >
            {s.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
