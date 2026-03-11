import type { AppConfig } from '@shared/models'
import { Section, NumberInput, StringList } from './SettingsField'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

export default function SettingsTabBriefing({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <Section title="Briefing">
        <NumberInput
          label="Auto-refresh threshold (hours)"
          hint="Regenerate the briefing when it's older than this"
          value={config.briefingStalenessHours}
          onChange={(v) => onChange({ briefingStalenessHours: v })}
          min={1}
          max={24}
          step={1}
        />
        <p className="text-[11px] text-neutral-500 mt-2 leading-relaxed">
          The Daily Briefing analyzes your tasks, sessions, emails, and projects across all workspaces
          to generate personalized priorities, surface items needing attention, and recommend quick wins.
        </p>
      </Section>

      <Section title="Tech Pulse Sources">
        <p className="text-[11px] text-neutral-500 mb-3">
          Optional — adds a collapsible tech news section to your briefing. Remove all feeds to disable.
        </p>
        <StringList
          label="RSS feeds"
          hint="Feed URLs to include in the Tech Pulse section"
          values={config.briefingRSSFeeds}
          onChange={(v) => onChange({ briefingRSSFeeds: v })}
          placeholder="https://example.com/feed.xml"
        />
        <StringList
          label="Subreddits"
          hint="Reddit subreddit names (without r/)"
          values={config.briefingSubreddits}
          onChange={(v) => onChange({ briefingSubreddits: v })}
          placeholder="MachineLearning"
        />
      </Section>
    </div>
  )
}
