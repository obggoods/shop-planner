import { useMemo } from "react"

import { AppBadge } from "@/components/app/AppBadge"
import { AppCard } from "@/components/app/AppCard"

import { EmptyState } from "@/components/shared/EmptyState"
import { Skeleton } from "@/components/shared/Skeleton"
import { UpgradeBlock } from "@/components/shared/UpgradeBlock"

export type MarketplacePerformanceSettlement = {
  id: string
  marketplace_id: string
  // 프로젝트 DB에서는 period_month / net_amount를 쓰고 있어 둘 다 허용
  month?: string // "YYYY-MM"
  period_month?: string // "YYYY-MM"
  gross_amount: number
  net_settlement_amount?: number
  net_amount?: number
  created_at: string
}

export type MarketplacePerformanceMarketplace = {
  id: string
  name: string
}

export type MarketplacePerformanceProps = {
  settlements?: MarketplacePerformanceSettlement[] | null
  marketplaces?: MarketplacePerformanceMarketplace[] | null
  userPlan: "free" | "basic" | "pro" | "enterprise" | string
  isLoading?: boolean
  onUpgradeClick?: () => void
}

function ym(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function addMonths(d: Date, delta: number) {
  const x = new Date(d)
  x.setMonth(x.getMonth() + delta)
  return x
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const v = Number(payload?.[0]?.value ?? 0)

  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums">
        {new Intl.NumberFormat("ko-KR").format(Math.round(v))}원
      </div>
    </div>
  )
}

function n(v: unknown) {
  const x = typeof v === "number" ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

function fmtKRW(v: number) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(v))
}

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

export default function MarketplacePerformance(props: MarketplacePerformanceProps) {
  const { settlements, marketplaces, userPlan, isLoading = false, onUpgradeClick } = props

  // ✅ 플랜 제한
  if (String(userPlan).toLowerCase() === "free") {
    return <UpgradeBlock onUpgradeClick={onUpgradeClick} />
  }

  // ✅ 로딩
  if (isLoading || settlements == null || marketplaces == null) {
    return (
      <AppCard title="입점처 성과 분석" description="최근 30일 매출/순위/전월 대비">
        <div className="grid gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      </AppCard>
    )
  }

  const marketplaceNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const x of marketplaces) m.set(String(x.id), String(x.name ?? ""))
    return m
  }, [marketplaces])

  const now = new Date()
  const thisMonth = ym(now)
  const prevMonth = ym(addMonths(now, -1))
  const since30d = new Date(now)
  since30d.setDate(since30d.getDate() - 30)

  const {
    rows30d,
    total30d,
    top1,
    ranked,
    thisMonthTotal,
    prevMonthTotal,
    deltaLabel,
    deltaVariant,
  } = useMemo(() => {
    const sumByMarketplace = new Map<string, number>()
    let total30 = 0

    let thisM = 0
    let prevM = 0

    for (const s of settlements) {
      const createdAt = new Date(s.created_at)
      const gross = n(s.gross_amount)

      // 전월 대비는 month/period_month 기준으로 계산
      const period = String((s as any).period_month ?? (s as any).month ?? "")
      if (period === thisMonth) thisM += gross
      if (period === prevMonth) prevM += gross

      // 최근 30일 집계는 created_at 기준
      if (Number.isFinite(createdAt.getTime()) && createdAt >= since30d) {
        total30 += gross
        const mid = String(s.marketplace_id)
        sumByMarketplace.set(mid, (sumByMarketplace.get(mid) ?? 0) + gross)
      }
    }

    const rows = Array.from(sumByMarketplace.entries()).map(([marketplaceId, totalSales]) => {
      const name = marketplaceNameById.get(marketplaceId) || marketplaceId
      return {
        marketplace_id: marketplaceId,
        marketplace_name: name,
        total_sales: totalSales,
      }
    })

    rows.sort((a, b) => b.total_sales - a.total_sales)

    // 전월 대비(%) 계산: prevM가 0이면 비교 불가
    const deltaPct = prevM === 0 ? null : ((thisM - prevM) / prevM) * 100
    const deltaValue = deltaPct ?? 0

    const deltaLabel =
      prevM === 0 ? "신규 매출 발생" : `${deltaValue >= 0 ? "+" : ""}${deltaValue.toFixed(1)}%`

    const deltaVariant =
      prevM === 0 ? "muted" : deltaValue >= 0 ? "default" : "destructive"

    return {
      rows30d: rows,
      total30d: total30,
      top1: rows[0] ?? null,
      ranked: rows,
      thisMonthTotal: thisM,
      prevMonthTotal: prevM,
      deltaLabel,
      deltaVariant,
    }
  }, [settlements, marketplaceNameById, thisMonth, prevMonth, since30d])

  if (ranked.length === 0) {
    return (
      <AppCard title="입점처 성과 분석" description="최근 30일 매출/순위/전월 대비">
        <EmptyState
          title="정산 데이터 없음"
          description="최근 30일 내 생성된 정산(settlements) 데이터가 없습니다."
        />
      </AppCard>
    )
  }

  return (
    <AppCard title="입점처 성과 분석" description="최근 30일 매출/순위/전월 대비">
      <div className="grid gap-4">
        <div className="grid gap-3 rounded-xl border bg-background p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">이번 달 최고 매출 입점처</div>
            <AppBadge variant="muted">최근 30일 기준</AppBadge>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-base">
              <span className="font-semibold">{top1?.marketplace_name ?? "-"}</span>
              <span className="text-muted-foreground"> · {fmtKRW(top1?.total_sales ?? 0)}원</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-sm text-muted-foreground">전월 대비</div>
              <AppBadge variant={deltaVariant as any}>{deltaLabel}</AppBadge>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">최근 30일 총매출</span>
              <span className="ml-2 font-medium">{fmtKRW(total30d)}원</span>
            </div>
            <div>
              <span className="text-muted-foreground">이번 달({thisMonth})</span>
              <span className="ml-2 font-medium">{fmtKRW(thisMonthTotal)}원</span>
            </div>
            <div>
              <span className="text-muted-foreground">지난 달({prevMonth})</span>
              <span className="ml-2 font-medium">{fmtKRW(prevMonthTotal)}원</span>
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="text-sm font-medium">입점처별 매출 순위 (최근 30일)</div>
          <div className="overflow-hidden rounded-xl border">
            <div className="divide-y">
              {ranked.slice(0, 10).map((r, idx) => (
                <div key={r.marketplace_id} className="flex items-center justify-between gap-3 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <AppBadge variant={idx === 0 ? "default" : "muted"}>#{idx + 1}</AppBadge>
                    <div className="truncate text-sm">{r.marketplace_name}</div>
                  </div>
                  <div className="shrink-0 text-sm font-medium tabular-nums">
                    {fmtKRW(r.total_sales)}원
                  </div>
                </div>
              ))}
            </div>
          </div>
          {ranked.length > 10 ? (
            <div className="text-xs text-muted-foreground">상위 10개만 표시합니다.</div>
          ) : null}
        </div>

        <div className="grid gap-3">
  <div className="text-sm font-medium">입점처별 매출 비교</div>

  <div className="rounded-xl border bg-background p-4">
    {(() => {
      const max = Math.max(...rows30d.map((r) => Number(r.total_sales ?? 0)), 0)

      return (
        <div className="grid gap-3">
          {rows30d.map((r, idx) => {
            const v = Number(r.total_sales ?? 0)
            const ratio = max > 0 ? clamp01(v / max) : 0
            const isTop = idx === 0

            return (
              <div key={r.marketplace_id} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {r.marketplace_name}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular-nums">
                    {fmtKRW(v)}원
                  </div>
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={isTop ? "h-full rounded-full bg-primary" : "h-full rounded-full bg-primary/60"}
                    style={{ width: `${Math.round(ratio * 100)}%` }}
                    aria-label={`${r.marketplace_name} 매출 비율`}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )
    })()}
  </div>
</div>
      </div>
    </AppCard>
  )
}