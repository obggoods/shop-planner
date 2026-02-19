import PageHeader from "@/app/layout/PageHeader"
import ProductsManager from "@/features/products/components/ProductsManager"

export default function ProductsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="제품"
        description="제품 생성/수정/삭제, 카테고리, 제작대상, CSV 업로드"
      />
      <ProductsManager />
    </div>
  )
}
