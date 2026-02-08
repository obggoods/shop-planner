// src/data/models.ts
export type Id = string;

export type Product = {
    id: Id;
    name: string;
    category: string | null;   // ✅ 추가
    active: boolean;
    createdAt: number;
    makeEnabled?: boolean; // 제작 대상 여부 (기본 true)
  };

export type Store = {
  id: Id;
  name: string;
  createdAt: number;
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
  items: Array<{ productId: Id; soldQty: number }>;
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

export type TargetStock = {
    storeId: Id;
    category: string | null;
    targetQty: number; // 목표 재고
    updatedAt: number;
  };
  
  export interface StoreProductState {
    storeId: Id;
    productId: Id;
    enabled: boolean; // 이 입점처에서 이 제품을 취급하면 true
  }
  