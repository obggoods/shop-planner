import PageHeader from "@/app/layout/PageHeader"
import SettingsManager from "@/features/settings/components/SettingsManager"

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="설정" description="기본값 설정 및 백업/복구" />

      <SettingsManager />
    </div>
  )
}
