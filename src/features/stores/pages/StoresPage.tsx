import PageHeader from "@/app/layout/PageHeader"
import StoresManager from "@/features/stores/components/StoresManager"
export default function StoresPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="입점처" description="입점처 생성/삭제 및 입점처별 취급 제품 ON/OFF" />
      <StoresManager />
    </div>
  )
}
