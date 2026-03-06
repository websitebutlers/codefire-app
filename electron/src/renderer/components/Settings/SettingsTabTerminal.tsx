import { FolderOpen, X } from 'lucide-react'
import type { AppConfig } from '@shared/models'
import { api } from '@renderer/lib/api'
import { Section, Slider, NumberInput } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabTerminal({ config, onChange }: Props) {
  const handleSelectFolder = async () => {
    const folder = await api.dialog.selectFolder()
    if (folder) onChange({ defaultTerminalPath: folder })
  }

  return (
    <div className="space-y-6">
      <Section title="Default Folder">
        <div>
          <label className="text-xs text-neutral-400 block mb-1">
            Default working directory
          </label>
          <p className="text-[11px] text-neutral-600 mb-2">
            Terminal starts here when no project is selected (All Projects view)
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-neutral-800 border border-neutral-700 rounded px-2.5 py-1.5 min-h-[32px]">
              <span className="text-sm text-neutral-300 truncate flex-1">
                {config.defaultTerminalPath || '~ (home directory)'}
              </span>
              {config.defaultTerminalPath && (
                <button
                  onClick={() => onChange({ defaultTerminalPath: '' })}
                  className="text-neutral-500 hover:text-neutral-300 shrink-0"
                  title="Reset to home directory"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={handleSelectFolder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-sm text-neutral-200 transition-colors shrink-0"
            >
              <FolderOpen size={14} />
              Browse
            </button>
          </div>
        </div>
      </Section>

      <Section title="Font">
        <Slider
          label="Font size"
          hint="Terminal font size in points"
          value={config.terminalFontSize}
          onChange={(v) => onChange({ terminalFontSize: v })}
          min={10}
          max={24}
          step={1}
          suffix="pt"
        />
        {/* Preview */}
        <div className="mt-2 p-3 bg-neutral-950 border border-neutral-800 rounded font-mono text-neutral-300"
          style={{ fontSize: `${config.terminalFontSize}px` }}
        >
          $ echo &quot;Hello, CodeFire&quot;
        </div>
      </Section>

      <Section title="Scrollback">
        <NumberInput
          label="Scrollback lines"
          hint="Number of lines kept in the scrollback buffer"
          value={config.scrollbackLines}
          onChange={(v) => onChange({ scrollbackLines: v })}
          min={1000}
          max={100000}
          step={1000}
        />
      </Section>
    </div>
  )
}
