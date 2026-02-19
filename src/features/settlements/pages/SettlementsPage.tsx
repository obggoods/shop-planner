import { useEffect, useMemo, useState } from "react"
import { Trash2 } from "lucide-react"
import PageHeader from "@/app/layout/PageHeader"
import SettlementUploader from "@/features/settlements/components/SettlementUploader"

import { AppCard } from "@/components/app/AppCard"
import { AppButton } from "@/components/app/AppButton"

import { Skeleton } from "@/components/shared/Skeleton"
import { ErrorState } from "@/components/shared/ErrorState"

import { useAppData } from "@/features/core/useAppData"
import {
  listSettlementsDB,
  getSettlementDetailDB,
  deleteSettlementV2DB,
  listSettlementLinesV2DB,
  upsertInventoryItemDB,
} from "@/data/store.supabase"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { toast } from "@/lib/toast"



import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function monthOptions(n = 24) {
  return Array.from({ length: n }).map((_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    return { value: `${y}-${m}`, label: `${y}.${m}` }
  })
}

export default function SettlementsPage() {
  const a = useAppData()

  // 조회 필터
  const [month, setMonth] = useState<string>(() => monthOptions(1)[0].value)
  const [storeId, setStoreId] = useState<string>("") // "" = 전체

  // 목록/상세
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>("")
  const [items, setItems] = useState<any[]>([])
  const [selectedId, setSelectedId] = useState<string>("")
  const [detail, setDetail] = useState<{ settlement: any; lines: any[] } | null>(null)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string
    storeId: string
    month: string
    applyToInventory: boolean
  } | null>(null)  
  const [restoreOnDelete, setRestoreOnDelete] = useState(true)

  const stores = a.data.stores as any[]

  const storeNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of stores) m.set(s.id, s.name)
    return m
  }, [stores])

  const load = async () => {
    try {
      setLoading(true)
      setError("")
      setDetail(null)
      setSelectedId("")

      const list = await listSettlementsDB({
        marketplaceId: storeId || undefined,
        periodMonth: month || undefined,
      })
      setItems(list)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [month, storeId])

  const openDetail = async (settlementId: string) => {
    try {
      setSelectedId(settlementId)
      const d = await getSettlementDetailDB({ settlementId })
      setDetail(d)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }

  const doDelete = () => {
    if (!deleteTarget) return
  
    // ✅ 스냅샷(이 값만 이후에 사용)
    const target = deleteTarget
    const restore = restoreOnDelete
    const deletingId = target.id
  
    // ✅ 1) 모달 즉시 닫기
    setDeleteOpen(false)
    setDeleteBusy(false)
    setDeleteTarget(null)
  
    // ✅ 2) UI 즉시 반영(Optimistic)
    setItems((prev) => prev.filter((x) => x.id !== deletingId))
    if (selectedId === deletingId) {
      setSelectedId("")
      setDetail(null)
    }
  
    // ✅ 3) 실제 작업은 비동기 수행
    ;(async () => {
      try {
        const loadingId = (toast as any).loading?.("삭제 중...")
  
        // ✅ (선택) 재고 복원: target 기준으로만 실행
        if (target.applyToInventory && restore) {
          const lines = await listSettlementLinesV2DB({ settlementId: deletingId })
  
          const restoreMap = new Map<string, number>()
          for (const l of lines ?? []) {
            const pid = String((l as any).product_id ?? (l as any).productId ?? "")
            if (!pid) continue
            const q = Number((l as any).qty_sold ?? (l as any).qtySold ?? 0)
            restoreMap.set(pid, (restoreMap.get(pid) ?? 0) + q)
          }
  
          for (const [pid, restoreQty] of restoreMap.entries()) {
            const inv = (a.data.inventory ?? []).find(
              (x: any) => x.storeId === target.storeId && x.productId === pid
            )
            const current = Number(inv?.onHandQty ?? 0)
            const nextQty = current + restoreQty
  
            await upsertInventoryItemDB({
              storeId: target.storeId,
              productId: pid,
              onHandQty: nextQty,
            })
          }
        }
  
        // ✅ 정산 삭제 (DB에서 실제로 삭제됐는지 검증하는 버전이어야 함)
        await deleteSettlementV2DB({ settlementId: deletingId })
  
        if (loadingId) (toast as any).dismiss?.(loadingId)
        toast.success(target.applyToInventory && restore ? "삭제 완료 (재고 복원됨)" : "정산 데이터가 삭제되었습니다.")
  
        await a.refresh()
        await load()
      } catch (e: any) {
        toast.error(`삭제 실패: ${e?.message ?? String(e)}`)
        await load()
      }
    })()
  }  

  if (a.errorMsg) return <ErrorState message={a.errorMsg} onRetry={a.refresh} />

  return (
    <div className="space-y-6">
      <PageHeader
        title="정산"
        description="입점처 정산 CSV를 업로드하면 판매 수량이 반영되고, (선택 시) 재고가 자동으로 차감됩니다."
      />

      {/* 업로드 */}
      <SettlementUploader />

      {/* 저장된 정산(v2) 조회 */}
      <AppCard
        density="compact"
        title="저장된 정산(v2)"
        description="월/입점처별로 저장된 정산을 확인할 수 있어요."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            >
              {monthOptions(24).map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
            >
              <option value="">전체 입점처</option>
              {stores.map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <AppButton type="button" variant="outline" onClick={load} disabled={loading}>
              새로고침
            </AppButton>
          </div>
        }
        contentClassName="px-4 pb-4"
      >
        {loading ? <Skeleton className="h-24" /> : null}
        {error ? <ErrorState message={error} onRetry={load} /> : null}

        <div className="mt-3 rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">입점처</TableHead>
                <TableHead className="w-[90px]">월</TableHead>
                <TableHead className="w-[120px] text-right">총매출</TableHead>
                <TableHead className="w-[120px] text-right">수수료</TableHead>
                <TableHead className="w-[120px] text-right">정산금</TableHead>
                <TableHead className="w-[160px] text-right pr-6">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s: any) => (
                <TableRow
                key={s.id}
                className={selectedId === s.id ? "bg-muted/30" : undefined}
                onClick={() => openDetail(s.id)}
              >
                  <TableCell className="truncate">
                    {storeNameById.get(s.marketplace_id) ?? "-"}
                  </TableCell>
                  <TableCell>{s.period_month}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(s.gross_amount ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(s.commission_amount ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(s.net_amount ?? 0).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right pr-6">
  <div className="inline-flex items-center justify-end gap-2">
    <span
      className={
        s.apply_to_inventory
          ? "inline-flex items-center rounded-md border px-2 py-1 text-[11px] text-foreground"
          : "inline-flex items-center rounded-md border px-2 py-1 text-[11px] text-muted-foreground"
      }
    >
      {s.apply_to_inventory ? "재고반영" : "미반영"}
    </span>

    <AppButton
      type="button"
      variant="ghost"
      size="icon"
      className="text-muted-foreground hover:text-destructive hover:bg-transparent"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDeleteTarget({
          id: s.id,
          storeId: s.marketplace_id,
          month: s.period_month,
          applyToInventory: Boolean(s.apply_to_inventory),
        })
        setRestoreOnDelete(Boolean(s.apply_to_inventory))
        setDeleteOpen(true)
      }}
    >
      <Trash2 className="h-4 w-4 transition-colors duration-200" />
    </AppButton>
  </div>
</TableCell>
                </TableRow>
              ))}

              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-muted-foreground">
                    저장된 정산이 없습니다.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        {detail ? (
          <div className="mt-4 space-y-2">
            <div className="text-sm font-medium">정산 상세</div>

            <div className="rounded-xl border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>상품</TableHead>
                    <TableHead className="w-[90px] text-right">판매</TableHead>
                    <TableHead className="w-[110px] text-right">단가</TableHead>
                    <TableHead className="w-[120px] text-right">매출</TableHead>
                    <TableHead className="w-[90px]">매칭</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.lines.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="truncate">
                        {l.product_name_matched ?? l.product_name_raw}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(l.qty_sold ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(l.unit_price ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(l.gross_amount ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell>{l.match_status}</TableCell>
                    </TableRow>
                  ))}

                  {detail.lines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-sm text-muted-foreground">
                        라인이 없습니다.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
        <ConfirmDialog
  open={deleteOpen}
  onOpenChange={(o) => {
    setDeleteOpen(o)
    if (!o) setDeleteTarget(null)
  }}
  title="정산 데이터를 삭제할까요?"
  description={
    <div className="space-y-3">
      <div>
        {deleteTarget
          ? `${storeNameById.get(deleteTarget.storeId) ?? "입점처"} · ${deleteTarget.month} 정산을 삭제합니다.`
          : "정산 데이터를 삭제합니다."}
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={restoreOnDelete}
          disabled={!deleteTarget?.applyToInventory}
          onChange={(e) => setRestoreOnDelete(e.target.checked)}
        />
        <span className={deleteTarget?.applyToInventory ? "" : "text-muted-foreground"}>
          삭제 시 재고도 복원하기
          {!deleteTarget?.applyToInventory ? " (이 정산은 재고차감 미적용)" : ""}
        </span>
      </label>
    </div>
  }
  confirmText="삭제"
  cancelText="취소"
  destructive
  busy={deleteBusy}
  onConfirm={doDelete}
/>
      </AppCard>
    </div>
  )
}
