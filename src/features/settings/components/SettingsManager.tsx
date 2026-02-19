// src/features/settings/components/SettingsManager.tsx
import { AppButton } from "@/components/app/AppButton"
import { AppCard } from "@/components/app/AppCard"
import { AppInput } from "@/components/app/AppInput"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { ErrorState } from "@/components/shared/ErrorState"
import { useState } from "react"

import { useAppData } from "@/features/core/useAppData"

export default function SettingsManager() {
  const a = useAppData()
  const [restoreFile, setRestoreFile] = useState<File | null>(null)

  if (a.errorMsg) return <ErrorState message={a.errorMsg} onRetry={a.refresh} />

  return (
    <div className="space-y-6">
      {a.loading && <div className="text-sm text-muted-foreground">동기화 중…</div>}

      <AppCard
        density="compact"
        title="재고 기준"
        description={
          a.profileLoading
            ? "불러오는 중…"
            : a.profileSaving
              ? "저장 중…"
              : "제작 리스트 계산 기준으로 사용돼요."
        }
        contentClassName="flex flex-wrap items-center gap-4"
      >
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">기본 목표 재고 수량</div>
          <AppInput
            className="w-24"
            type="number"
            min={0}
            step={1}
            value={a.defaultTargetQtyInput}
            onChange={(e) => a.setDefaultTargetQtyInput(e.target.value)}
            onBlur={a.saveDefaultTargetQty}
            disabled={a.profileLoading || a.profileSaving}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="text-sm font-medium">최소 재고 수량(≤)</div>
          <AppInput
            className="w-20"
            type="number"
            min={0}
            step={1}
            value={a.lowStockThresholdInput}
            onChange={(e) => a.setLowStockThresholdInput(e.target.value)}
            onBlur={a.saveLowStockThreshold}
            disabled={a.profileLoading || a.profileSaving}
          />
        </div>
      </AppCard>

      <AppCard
        density="compact"
        title="백업 / 복구"
        description='* 백업은 “현재 DB 데이터 기준”으로 export 하는 용도'
      >
        <div className="flex flex-wrap items-start gap-2">
          <AppButton type="button" variant="outline" onClick={a.handleBackup}>
            백업(JSON 다운로드)
          </AppButton>

          <AppButton
            type="button"
            variant="outline"
            onClick={() => a.fileInputRef.current?.click()}
            disabled={a.loading}
          >
            복구(JSON 가져오기)
          </AppButton>

          <input
            ref={a.fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setRestoreFile(f)
            }}
          />
        </div>
      </AppCard>

      <ConfirmDialog
        open={Boolean(restoreFile)}
        onOpenChange={(open) => {
          if (!open) setRestoreFile(null)
        }}
        title="복구 파일을 적용할까요?"
        description="선택한 백업 파일 내용으로 로컬 화면 데이터가 덮어써집니다. 되돌릴 수 없습니다."
        confirmText="복구"
        cancelText="취소"
        destructive
        busy={a.loading}
        onConfirm={async () => {
          if (!restoreFile) return
          await a.handleRestore(restoreFile)
          setRestoreFile(null)
        }}
      />
    </div>
  )
}
