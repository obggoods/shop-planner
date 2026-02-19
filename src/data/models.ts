// src/data/models.ts
export type Id = string;

export type Product = {
  id: Id;
  name: string;
  category: string | null;
  active: boolean;
  createdAt: number;
  makeEnabled?: boolean;

  // DB에도 있고 앱에서도 쓰는 필드
  price?: number | null;
  sku?: string | null;
  barcode?: string | null;
};

export type Store = {
  id: Id;
  name: string;
  createdAt: number;

  // ✅ 추가
  commissionRate?: number | null;      // 수수료(%) 예: 25
  memo?: string | null;                // 메모
  targetQtyOverride?: number | null;   // 입점처별 목표 재고 override
  contactName?: string | null;         // 담당자/메모용 연락처명
  phone?: string | null;               // 전화번호
  address?: string | null;             // 주소
};

export type InventoryItem = {
  storeId: Id;
  productId: Id;
  onHandQty: number;
  updatedAt: number;
};

export type Settlement = {
  id: Id;
  storeId: Id;
  month: string; // YYYY-MM
  items: Array<{ productId: Id; soldQty: number; unitPrice?: number; currency?: string }>
  createdAt: number;
  updatedAt: number;
};

export type Plan = {
  id: Id;
  storeId: Id;
  month: string; // YYYY-MM
  items: Array<{ productId: Id; makeQty: number }>;
  createdAt: number;
  updatedAt: number;
};

export type AppData = {
  schemaVersion: 1;
  products: Product[];
  stores: Store[];
  inventory: InventoryItem[];
  storeProductStates: StoreProductState[];
  settlements: Settlement[];
  plans: Plan[];
  updatedAt: number;
};

export interface StoreProductState {
  storeId: Id;
  productId: Id;
  enabled: boolean;
}
