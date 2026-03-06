import { useState } from 'react'
import { Eye, EyeOff, Plus, X } from 'lucide-react'

/* ─── Section Header ───────────────────────────────────────────────────────── */

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">{title}</h3>
      {children}
    </section>
  )
}

/* ─── Toggle ───────────────────────────────────────────────────────────────── */

export function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1 group cursor-pointer">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-neutral-300">{label}</span>
        {hint && <p className="text-[10px] text-neutral-600 mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          value ? 'bg-codefire-orange' : 'bg-neutral-700'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            value ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </label>
  )
}

/* ─── Text Input ───────────────────────────────────────────────────────────── */

export function TextInput({
  label,
  hint,
  placeholder,
  value,
  onChange,
  secret,
}: {
  label: string
  hint?: string
  placeholder?: string
  value: string
  onChange: (v: string) => void
  secret?: boolean
}) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="space-y-1">
      <label className="text-xs text-neutral-500 block">{label}</label>
      {hint && <p className="text-[10px] text-neutral-600">{hint}</p>}
      <div className="relative">
        <input
          type={secret && !visible ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                     text-xs text-neutral-200 placeholder:text-neutral-600
                     focus:outline-none focus:border-codefire-orange/50"
        />
        {secret && (
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-600 hover:text-neutral-400"
          >
            {visible ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
      </div>
    </div>
  )
}

/* ─── Number Input ─────────────────────────────────────────────────────────── */

export function NumberInput({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-neutral-500 block">{label}</label>
      {hint && <p className="text-[10px] text-neutral-600">{hint}</p>}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className="w-32 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                   text-xs text-neutral-200
                   focus:outline-none focus:border-codefire-orange/50"
      />
    </div>
  )
}

/* ─── Select ───────────────────────────────────────────────────────────────── */

export function Select({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-neutral-500 block">{label}</label>
      {hint && <p className="text-[10px] text-neutral-600">{hint}</p>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                   text-xs text-neutral-200
                   focus:outline-none focus:border-codefire-orange/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/* ─── Slider ───────────────────────────────────────────────────────────────── */

export function Slider({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  suffix?: string
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-neutral-500">{label}</label>
        <span className="text-xs text-neutral-300 font-mono">
          {value}{suffix ?? ''}
        </span>
      </div>
      {hint && <p className="text-[10px] text-neutral-600">{hint}</p>}
      <input
        type="range"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step ?? 1}
        className="w-full h-1.5 bg-neutral-700 rounded-full appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5
                   [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-codefire-orange [&::-webkit-slider-thumb]:cursor-pointer
                   [&::-webkit-slider-thumb]:hover:bg-codefire-orange-hover"
      />
      <div className="flex justify-between text-[9px] text-neutral-600">
        <span>{min}{suffix ?? ''}</span>
        <span>{max}{suffix ?? ''}</span>
      </div>
    </div>
  )
}

/* ─── String List ──────────────────────────────────────────────────────────── */

export function StringList({
  label,
  hint,
  values,
  onChange,
  placeholder,
}: {
  label: string
  hint?: string
  values: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  function add() {
    const trimmed = draft.trim()
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed])
      setDraft('')
    }
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-1">
      <label className="text-xs text-neutral-500 block">{label}</label>
      {hint && <p className="text-[10px] text-neutral-600">{hint}</p>}
      <div className="flex gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                     text-xs text-neutral-200 placeholder:text-neutral-600
                     focus:outline-none focus:border-codefire-orange/50"
        />
        <button
          type="button"
          onClick={add}
          className="px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700
                     text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
        >
          <Plus size={12} />
        </button>
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {values.map((v, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-800
                         border border-neutral-700 text-[10px] text-neutral-400"
            >
              <span className="truncate max-w-[200px]">{v}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-neutral-600 hover:text-neutral-300"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
