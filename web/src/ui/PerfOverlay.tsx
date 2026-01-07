import { useEffect, useState } from 'react'

type LongTaskSample = {
  count: number
  lastDuration: number
  maxDuration: number
}

export function PerfOverlay() {
  const [stats, setStats] = useState<LongTaskSample>({
    count: 0,
    lastDuration: 0,
    maxDuration: 0,
  })

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = entry.duration
        setStats((prev) => ({
          count: prev.count + 1,
          lastDuration: duration,
          maxDuration: Math.max(prev.maxDuration, duration),
        }))
      }
    })

    observer.observe({ entryTypes: ['longtask'] })
    return () => observer.disconnect()
  }, [])

  return (
    <div className="perf-overlay" data-testid="perf-overlay">
      <div>Long tasks: {stats.count}</div>
      <div>Last: {stats.lastDuration.toFixed(1)}ms</div>
      <div>Max: {stats.maxDuration.toFixed(1)}ms</div>
    </div>
  )
}
