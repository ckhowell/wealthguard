import type { ReactNode, ComponentType } from 'react';

interface SectionHeaderProps {
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  right?: ReactNode;
}

/**
 * Shared eyebrow-style section header used across the Dashboard and any card
 * that wants to match the Survival Pulse / Position Movers rhythm.
 *
 *   <SectionHeader icon={Activity} label="Position movers" right={<Chip/>} />
 */
export const SectionHeader = ({ icon: Icon, label, right }: SectionHeaderProps) => (
  <div className="flex items-center gap-2 mb-3">
    {Icon && <Icon className="w-4 h-4 text-stone-500 dark:text-stone-400" strokeWidth={1.75} />}
    <h3 className="text-xs font-mono uppercase text-stone-500 dark:text-stone-400">
      {label}
    </h3>
    {right && <div className="ml-auto">{right}</div>}
  </div>
);

export default SectionHeader;
