// src/features/stores/components/StoresManager.tsx
import { useCallback, useMemo, useState } from "react"
import type { Product, Store } from "@/data/models"

import { useAppData } from "@/features/core/useAppData"
import { toast } from "@/lib/toast"

import { AppBadge } from "@/components/app/AppBadge"
import { AppButton } from "@/components/app/AppButton"
import { AppCard } from "@/components/app/AppCard"
import { AppInput } from "@/components/app/AppInput"
import { AppSelect } from "@/components/app/AppSelect"
import { AppSwitch } from "@/components/app/AppSwitch"

import { EmptyState } from "@/components/shared/EmptyState"
import { Skeleton } from "@/components/shared/Skeleton"
import { ErrorState } from "@/components/shared/ErrorState"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react"

function toNumOrNull(v: string) {
  const t = (v ?? "").trim()
  if (!t) return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n))
}

export default function StoresManager() {
  const a = useAppData()

  const stores = useMemo(() => {
    return [...a.data.stores].sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0))
  }, [a.data.stores])

  const products = useMemo(() => {
    return [...a.data.products].sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0))
  }, [a.data.products])

  const [manageStoreId, setManageStoreId] = useState<string>("")
  const [openStoreCats, setOpenStoreCats] = useState<Record<string, boolean>>({})

  const [deleteStoreId, setDeleteStoreId] = useState<string>("")
  const [deleteStoreName, setDeleteStoreName] = useState<string>("")

  const [bulkToggle, setBulkToggle] = useState<{ storeId: string; next: boolean } | null>(null)

  // ✅ 모달(입점처 추가)
  const [addOpen, setAddOpen] = useState(false)

  // ✅ 목록 편집 상태(행 인라인 편집 유지)
  const [editingStoreId, setEditingStoreId] = useState<string>("")
  const [editName, setEditName] = useState("")
  const [editCommission, setEditCommission] = useState("")
  const [editTargetQty, setEditTargetQty] = useState("")
  const [editContactName, setEditContactName] = useState("")
  const [editPhone, setEditPhone] = useState("")
  const [editAddress, setEditAddress] = useState("")
  const [editMemo, setEditMemo] = useState("")

  const isEnabledInStore = useCallback(
    (storeId: string, productId: string) => {
      const hit = a.data.storeProductStates.find((x) => x.storeId === storeId && x.productId === productId)
      return hit ? hit.enabled : true
    },
    [a.data.storeProductStates]
  )

  const startEditStore = useCallback((s: Store) => {
    setEditingStoreId(s.id)
    setEditName(s.name ?? "")
    setEditCommission(s.commissionRate == null ? "" : String(s.commissionRate))
    setEditTargetQty(s.targetQtyOverride == null ? "" : String(s.targetQtyOverride))
    setEditContactName(s.contactName ?? "")
    setEditPhone(s.phone ?? "")
    setEditAddress(s.address ?? "")
    setEditMemo(s.memo ?? "")
  }, [])

  const cancelEditStore = useCallback(() => {
    setEditingStoreId("")
    setEditName("")
    setEditCommission("")
    setEditTargetQty("")
    setEditContactName("")
    setEditPhone("")
    setEditAddress("")
    setEditMemo("")
  }, [])

  const saveEditStore = useCallback(async () => {
    const id = editingStoreId
    if (!id) return

    const commissionRate = toNumOrNull(editCommission)
    const targetQtyOverride = toNumOrNull(editTargetQty)

    await a.saveStoreFields(id, {
      name: editName,
      commissionRate,
      targetQtyOverride,
      contactName: editContactName.trim() || null,
      phone: editPhone.trim() || null,
      address: editAddress.trim() || null,
      memo: editMemo.trim() || null,
    })

    cancelEditStore()
  }, [
    a,
    editingStoreId,
    editName,
    editCommission,
    editTargetQty,
    editContactName,
    editPhone,
    editAddress,
    editMemo,
    cancelEditStore,
  ])

  const onConfirmAddStore = useCallback(async () => {
    // addStore는 내부에서 name 없으면 return 하므로 여기선 최소 UX만 보강
    if (!a.newStoreName.trim()) {
      toast.error("입점처명을 입력해 주세요.")
      return
    }
    await a.addStore()
    setAddOpen(false)
  }, [a])

  if (a.errorMsg) return <ErrorState message={a.errorMsg} onRetry={a.refresh} />

  return (
    <div className="space-y-6">
      {/* ✅ 상단: 입점처 추가 버튼(모달 오픈) */}
      <div className="flex items-center justify-end">
        <AppButton onClick={() => setAddOpen(true)}>입점처 추가</AppButton>
      </div>

      {/* ✅ 입점처 추가 모달 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen} modal={false}>
        <DialogContent className="max-w-[720px]">
          <DialogHeader>
            <DialogTitle>입점처 추가</DialogTitle>
            <DialogDescription>수수료/목표재고/연락처 정보를 함께 저장할 수 있습니다.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-2">
              <AppInput
                value={a.newStoreName}
                onChange={(e) => a.setNewStoreName(e.target.value)}
                placeholder="입점처명 예: 홍대 A소품샵"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <AppInput
                value={a.newStoreCommissionInput}
                onChange={(e) => a.setNewStoreCommissionInput(e.target.value)}
                placeholder="수수료(%) 예: 25"
                inputMode="decimal"
              />
              <AppInput
                value={a.newStoreTargetQtyInput}
                onChange={(e) => a.setNewStoreTargetQtyInput(e.target.value)}
                placeholder="목표재고 예: 10"
                inputMode="numeric"
              />
              <AppInput
                value={a.newStoreMemo}
                onChange={(e) => a.setNewStoreMemo(e.target.value)}
                placeholder="메모 (선택) 예: 월말 정산"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <AppInput
                value={a.newStoreContactName}
                onChange={(e) => a.setNewStoreContactName(e.target.value)}
                placeholder="담당자/연락처명 (선택)"
              />
              <AppInput
                value={a.newStorePhone}
                onChange={(e) => a.setNewStorePhone(e.target.value)}
                placeholder="전화번호 (선택)"
                inputMode="tel"
              />
              <AppInput
                value={a.newStoreAddress}
                onChange={(e) => a.setNewStoreAddress(e.target.value)}
                placeholder="주소 (선택)"
              />
            </div>
          </div>

          <DialogFooter>
            <AppButton variant="secondary" onClick={() => setAddOpen(false)}>
              취소
            </AppButton>
            <AppButton onClick={onConfirmAddStore} disabled={a.loading}>
              추가
            </AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 기존: 입점처별 취급 제품 ON/OFF */}
      <AppCard
        title="입점처별 취급 제품 설정"
        description="입점처마다 입고하는 제품이 다르면 여기서 ON/OFF로 관리해요. (OFF면 대시보드에서 숨김 + 제작 계산 제외)"
        className="mb-4"
        contentClassName="space-y-3"
      >
        {stores.length === 0 ? (
          <p className="text-sm text-muted-foreground">입점처가 없어요. 먼저 입점처를 추가해주세요.</p>
        ) : products.length === 0 ? (
          <p className="text-sm text-muted-foreground">제품이 없어요. 먼저 제품을 추가해주세요.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <AppSelect
              value={manageStoreId}
              onValueChange={(v) => setManageStoreId(v)}
              placeholder="(입점처 선택)"
              options={stores.map((s) => ({ value: s.id, label: s.name }))}
              className="min-w-[220px]"
            />

            {!manageStoreId ? (
              <span className="text-sm text-muted-foreground">입점처를 선택하면 제품 ON/OFF 목록이 보여요.</span>
            ) : (
              <span className="text-sm font-semibold">선택됨: {stores.find((s) => s.id === manageStoreId)?.name}</span>
            )}
          </div>
        )}

        {!!manageStoreId && (
          <div className="mt-2 border-t border-border pt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <AppButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBulkToggle({ storeId: manageStoreId, next: true })}
                disabled={a.loading}
              >
                전체 ON
              </AppButton>
              <AppButton
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setBulkToggle({ storeId: manageStoreId, next: false })}
                disabled={a.loading}
              >
                전체 OFF
              </AppButton>
            </div>

            {(() => {
              const activeProducts = products.filter((p) => p.active)
              const groups = new Map<string, Product[]>()
              for (const p of activeProducts) {
                const cat = (p.category ?? "미분류").trim() || "미분류"
                const arr = groups.get(cat) ?? []
                arr.push(p)
                groups.set(cat, arr)
              }
              const cats = Array.from(groups.keys()).sort((x, y) => x.localeCompare(y, "ko"))

              return (
                <div className="space-y-3">
                  {cats.map((cat) => {
                    const list = groups.get(cat) ?? []
                    const sorted = [...list].sort((x, y) => x.name.localeCompare(y.name, "ko"))
                    const isOpen = openStoreCats[cat] ?? true
                    const onCount = sorted.reduce(
                      (acc, p) => (isEnabledInStore(manageStoreId, p.id) ? acc + 1 : acc),
                      0
                    )

                    return (
                      <div key={cat} className="rounded-xl border border-border bg-background overflow-hidden">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenStoreCats((prev) => ({
                              ...prev,
                              [cat]: !(prev[cat] ?? true),
                            }))
                          }
                          className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left bg-muted/30 hover:bg-muted/50"
                        >
                          <span className="text-sm font-semibold">
                            {cat}{" "}
                            <span className="text-xs text-muted-foreground font-medium">
                              ({onCount}/{sorted.length} ON)
                            </span>
                          </span>
                          <span className="text-muted-foreground font-semibold">{isOpen ? "▾" : "▸"}</span>
                        </button>

                        {isOpen && (
                          <ul className="list-none m-0 p-0">
                            {sorted.map((p) => {
                              const enabled = isEnabledInStore(manageStoreId, p.id)
                              return (
                                <li
                                  key={p.id}
                                  className={`flex items-center justify-between gap-3 px-3 py-2 border-t border-border ${
                                    enabled ? "" : "opacity-50"
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold truncate">{p.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {enabled ? "ON (취급)" : "OFF (미취급)"}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <AppSwitch
                                      checked={enabled}
                                      onCheckedChange={(v) => a.toggleOne(manageStoreId, p.id, Boolean(v))}
                                      disabled={a.loading}
                                    />
                                    <span className="text-xs text-muted-foreground">{enabled ? "취급" : "미취급"}</span>
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}
      </AppCard>

      {/* ✅ 입점처 목록: 작업을 ... 메뉴로 */}
      <AppCard density="compact" title="입점처 목록" className="min-w-0" contentClassName="space-y-3">
        {a.loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : stores.length === 0 ? (
          <EmptyState title="입점처가 없습니다" description="먼저 입점처를 추가하세요." />
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">입점처</TableHead>
                  <TableHead className="w-[110px] text-right">수수료</TableHead>
                  <TableHead className="w-[130px] text-right">목표재고</TableHead>
                  <TableHead className="min-w-[200px]">담당자</TableHead>
                  <TableHead className="min-w-[180px]">전화</TableHead>
                  <TableHead className="min-w-[260px]">주소</TableHead>
                  <TableHead className="min-w-[260px]">메모</TableHead>
                  <TableHead className="w-[72px] text-right">작업</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {stores.map((s) => {
                  const isEditing = editingStoreId === s.id
                  const enabledCount =
                    a.data.storeProductStates.filter((sp) => sp.storeId === s.id && sp.enabled).length

                  if (!isEditing) {
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="text-sm font-medium truncate">{s.name}</div>
                            <AppBadge variant="muted" className="shrink-0">
                              {enabledCount}/{a.data.products.length}
                            </AppBadge>
                          </div>
                        </TableCell>

                        <TableCell className="text-right tabular-nums">
                          {s.commissionRate == null ? "-" : `${s.commissionRate}%`}
                        </TableCell>

                        <TableCell className="text-right tabular-nums">
                          {s.targetQtyOverride == null ? "-" : s.targetQtyOverride}
                        </TableCell>

                        <TableCell className="text-muted-foreground">{s.contactName ?? "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{s.phone ?? "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{s.address ?? "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{s.memo ?? "-"}</TableCell>

                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background hover:bg-accent/30"
                                aria-label="actions"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => startEditStore(s)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                수정
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setDeleteStoreId(s.id)
                                  setDeleteStoreName(s.name)
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                삭제
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  }

                  // 편집 모드: 저장/취소는 버튼 유지(메뉴보다 명확)
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <AppInput value={editName} onChange={(e) => setEditName(e.target.value)} />
                      </TableCell>

                      <TableCell>
                        <AppInput
                          value={editCommission}
                          onChange={(e) => setEditCommission(e.target.value)}
                          placeholder="%"
                          inputMode="decimal"
                        />
                      </TableCell>

                      <TableCell>
                        <AppInput
                          value={editTargetQty}
                          onChange={(e) => setEditTargetQty(e.target.value)}
                          placeholder="예: 10"
                          inputMode="numeric"
                        />
                      </TableCell>

                      <TableCell>
                        <AppInput
                          value={editContactName}
                          onChange={(e) => setEditContactName(e.target.value)}
                          placeholder="담당자"
                        />
                      </TableCell>

                      <TableCell>
                        <AppInput value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="전화" inputMode="tel" />
                      </TableCell>

                      <TableCell>
                        <AppInput value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="주소" />
                      </TableCell>

                      <TableCell>
                        <AppInput value={editMemo} onChange={(e) => setEditMemo(e.target.value)} placeholder="메모" />
                      </TableCell>

                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <AppButton type="button" size="sm" onClick={saveEditStore} disabled={a.loading}>
                            저장
                          </AppButton>
                          <AppButton type="button" size="sm" variant="secondary" onClick={cancelEditStore}>
                            취소
                          </AppButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </AppCard>

      {/* 삭제 confirm */}
      <ConfirmDialog
        open={Boolean(deleteStoreId)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteStoreId("")
            setDeleteStoreName("")
          }
        }}
        title="입점처를 삭제할까요?"
        description={
          deleteStoreName
            ? `“${deleteStoreName}” 입점처가 삭제됩니다. 되돌릴 수 없습니다.`
            : "입점처가 삭제됩니다. 되돌릴 수 없습니다."
        }
        confirmText="삭제"
        cancelText="취소"
        destructive
        busy={a.loading}
        onConfirm={async () => {
          const id = deleteStoreId
          if (!id) return
          try {
            await a.deleteStore(id)
          } catch {
            toast.error("삭제에 실패했어요.")
          } finally {
            setDeleteStoreId("")
            setDeleteStoreName("")
          }
        }}
      />

      {/* 일괄 ON/OFF confirm */}
      <ConfirmDialog
        open={Boolean(bulkToggle)}
        onOpenChange={(open) => {
          if (!open) setBulkToggle(null)
        }}
        title={bulkToggle?.next ? "전체 ON을 적용할까요?" : "전체 OFF를 적용할까요?"}
        description={
          bulkToggle?.next
            ? "선택한 입점처의 모든 제품을 ON(취급)으로 설정합니다."
            : "선택한 입점처의 모든 제품을 OFF(미취급)으로 설정합니다."
        }
        confirmText={bulkToggle?.next ? "전체 ON" : "전체 OFF"}
        cancelText="취소"
        destructive={!bulkToggle?.next}
        busy={a.loading}
        onConfirm={async () => {
          if (!bulkToggle) return
          try {
            await a.toggleAll(bulkToggle.storeId, bulkToggle.next)
            toast.success(bulkToggle.next ? "전체 ON을 적용했어요." : "전체 OFF를 적용했어요.")
          } catch {
            toast.error("일괄 변경에 실패했어요.")
          } finally {
            setBulkToggle(null)
          }
        }}
      />
    </div>
  )
}
