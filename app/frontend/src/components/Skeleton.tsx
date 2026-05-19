import React from 'react'
import './Skeleton.css'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  radius?: string | number
  style?: React.CSSProperties
  className?: string
}

export function Skeleton({ width = '100%', height = 14, radius = 'var(--r-sm)', style, className }: SkeletonProps) {
  return (
    <div
      className={`skeleton${className ? ' ' + className : ''}`}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  )
}
