import React from 'react'

interface PageHeaderProps {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}

export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 px-7 pt-5 pb-4 border-b border-[var(--border-color)] shrink-0">
      <div className="min-w-0">
        <h2 className="m-0 mb-0.5 text-[16px] font-semibold text-[var(--info-bar-hover-color)] tracking-[-0.01em] truncate">
          {title}
        </h2>
        {subtitle && (
          <p className="m-0 text-[12px] text-[var(--info-bar-color)] truncate">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}
