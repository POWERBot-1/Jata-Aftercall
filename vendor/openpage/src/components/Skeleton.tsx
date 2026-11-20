interface SkeletonProps {
  className?: string
  width?: string | number
  height?: string | number
}

export function Skeleton({ className = '', width, height }: SkeletonProps) {
  return (
    <div
      className={`bg-bg-3 rounded animate-shimmer ${className}`}
      style={{
        width,
        height,
        backgroundImage: 'linear-gradient(90deg, transparent 0%, var(--color-bg-4) 50%, transparent 100%)',
        backgroundSize: '200% 100%',
      }}
      aria-hidden="true"
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="bg-bg-1 border border-border-default rounded-xl overflow-hidden">
      <Skeleton className="!rounded-none" height={120} />
      <div className="px-4 py-3 space-y-2">
        <Skeleton height={14} width="60%" />
        <Skeleton height={10} width="40%" />
      </div>
    </div>
  )
}
