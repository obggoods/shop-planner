import PageHeader from "@/app/layout/PageHeader"
import DashboardView from "@/features/dashboard/components/DashboardView"

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="대시보드"
        description="전체 KPI와 저재고 경고를 한눈에 확인합니다."
      />
      <DashboardView />
    </div>
  )
}