import { useRef } from 'react'
import { Camera, X } from 'lucide-react'
import type { AppConfig } from '@shared/models'
import { Section, TextInput } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name ? name.slice(0, 2).toUpperCase() : '?'
}

export default function SettingsTabMe({ config, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Convert to data URL for local storage
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Resize to 128x128 to keep config file small
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const size = 128
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')!
        // Crop to square from center
        const min = Math.min(img.width, img.height)
        const sx = (img.width - min) / 2
        const sy = (img.height - min) / 2
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size)
        onChange({ profileAvatarUrl: canvas.toDataURL('image/jpeg', 0.85) })
      }
      img.src = result
    }
    reader.readAsDataURL(file)
    // Reset input so the same file can be selected again
    e.target.value = ''
  }

  function handleRemoveAvatar() {
    onChange({ profileAvatarUrl: '' })
  }

  const hasAvatar = !!config.profileAvatarUrl

  return (
    <div className="space-y-6">
      <Section title="Profile">
        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="relative group">
            {hasAvatar ? (
              <img
                src={config.profileAvatarUrl}
                alt="Avatar"
                className="w-16 h-16 rounded-full object-cover ring-2 ring-neutral-700"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-neutral-700 flex items-center justify-center text-lg font-semibold text-neutral-300 ring-2 ring-neutral-600">
                {getInitials(config.profileName)}
              </div>
            )}

            {/* Upload overlay */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            >
              <Camera size={18} className="text-white" />
            </button>

            {/* Remove button */}
            {hasAvatar && (
              <button
                onClick={handleRemoveAvatar}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-neutral-800 border border-neutral-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-900/50"
              >
                <X size={10} className="text-neutral-300" />
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              className="hidden"
            />
          </div>

          {/* Name */}
          <div className="flex-1 space-y-3">
            <TextInput
              label="Display name"
              hint="Shown to teammates in presence and activity"
              value={config.profileName}
              onChange={(v) => onChange({ profileName: v })}
              placeholder="Your name"
            />
            <p className="text-[10px] text-neutral-600">
              Click the avatar to upload a photo. Images are stored locally.
            </p>
          </div>
        </div>
      </Section>
    </div>
  )
}
