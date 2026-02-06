// src/data/store.supabase.ts
import { supabase } from "../lib/supabaseClient";
import type { AppData, Product, Store } from "./models";
import { createEmptyData, loadData as loadLocalData } from "./store";

type DBProduct = {
  id: string;
  name: string;
  category: string | null;
  active: boolean | null;
  created_at: string;
};

type DBStore = {
  id: string;
  name: string;
  created_at: string;
};

type DBInventory = {
  store_id: string;
  product_id: string;
  on_hand_qty: number | null;
  updated_at: string;
};

type DBSPS = {
  store_id: string;
  product_id: string;
  enabled: boolean | null;
};

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Not authenticated");
  return data.user.id;
}

/**
 * store_product_states에 (storeId x productId) 조합이 없으면 enabled=true로 채워 넣음
 * - 신제품 추가 / 신규 입점처 추가 때 호출하면 “비활성화 동기화” 문제가 거의 사라짐
 */
export async function ensureStoreProductStatesSeedDB(input: {
  storeIds: string[];
  productIds: string[];
}): Promise<void> {
  const userId = await requireUserId();

  if (input.storeIds.length === 0 || input.productIds.length === 0) return;

  // 1) 현재 존재하는 조합 조회
  const { data: existing, error: selErr } = await supabase
    .from("store_product_states")
    .select("store_id,product_id")
    .eq("user_id", userId);

  if (selErr) throw selErr;

  const exists = new Set<string>((existing ?? []).map((r: any) => `${r.store_id}__${r.product_id}`));

  // 2) 없는 조합만 만들기
  const toInsert: Array<{
    user_id: string;
    store_id: string;
    product_id: string;
    enabled: boolean;
    updated_at: string;
  }> = [];

  const now = new Date().toISOString();

  for (const storeId of input.storeIds) {
    for (const productId of input.productIds) {
      const key = `${storeId}__${productId}`;
      if (exists.has(key)) continue;

      toInsert.push({
        user_id: userId,
        store_id: storeId,
        product_id: productId,
        enabled: true,
        updated_at: now,
      });
    }
  }

  if (toInsert.length === 0) return;

  const { error: insErr } = await supabase.from("store_product_states").insert(toInsert);
  if (insErr) throw insErr;
}

// -----------------------------
// DB -> AppData 로드
// -----------------------------
export async function loadDataFromDB(): Promise<AppData> {
  const userId = await requireUserId();

  const [productsRes, storesRes, invRes, spsRes] = await Promise.all([
    supabase.from("products").select("id,name,category,active,created_at").eq("user_id", userId).order("created_at"),
    supabase.from("stores").select("id,name,created_at").eq("user_id", userId).order("created_at"),
    supabase.from("inventory").select("store_id,product_id,on_hand_qty,updated_at").eq("user_id", userId),
    supabase.from("store_product_states").select("store_id,product_id,enabled").eq("user_id", userId),
  ]);

  const err = productsRes.error || storesRes.error || invRes.error || spsRes.error;
  if (err) throw err;

  const products = (productsRes.data ?? []) as DBProduct[];
  const stores = (storesRes.data ?? []) as DBStore[];
  const inventory = (invRes.data ?? []) as DBInventory[];
  const sps = (spsRes.data ?? []) as DBSPS[];

  // ✅ 추가: 혹시 DB에 store_product_states가 비어 있거나 조합이 누락된 경우 자동 seed
  await ensureStoreProductStatesSeedDB({
    storeIds: stores.map((s) => s.id),
    productIds: products.map((p) => p.id),
  });

  // seed 후 다시 sps 로드 (반영된 값까지 맞추기 위해)
  const { data: sps2, error: spsErr2 } = await supabase
    .from("store_product_states")
    .select("store_id,product_id,enabled")
    .eq("user_id", userId);

  if (spsErr2) throw spsErr2;

  return {
    ...createEmptyData(),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category ?? "",
      active: p.active ?? true,
      createdAt: new Date(p.created_at).getTime(),
    })),
    stores: stores.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: new Date(s.created_at).getTime(),
    })),
    inventory: inventory.map((i) => ({
      storeId: i.store_id,
      productId: i.product_id,
      onHandQty: i.on_hand_qty ?? 0,
      updatedAt: new Date(i.updated_at).getTime(),
    })),
    storeProductStates: (sps2 ?? []).map((x: any) => ({
      storeId: x.store_id,
      productId: x.product_id,
      enabled: x.enabled ?? true,
    })),
    updatedAt: Date.now(),
  };
}

// -----------------------------
// DB가 비어있는지 체크 (초기 마이그레이션 판단용)
// -----------------------------
export async function isDBEmpty(): Promise<boolean> {
  const userId = await requireUserId();

  const { count, error } = await supabase.from("products").select("*", { count: "exact", head: true }).eq("user_id", userId);

  if (error) throw error;
  return (count ?? 0) === 0;
}

// -----------------------------
// LocalStorage(AppData) -> DB에 1회 업로드 (마이그레이션)
// -----------------------------
export async function migrateLocalToDBOnce(): Promise<void> {
  const userId = await requireUserId();
  const local = loadLocalData();

  // products
  if (local.products.length > 0) {
    const { error } = await supabase.from("products").upsert(
      local.products.map((p) => ({
        user_id: userId,
        id: p.id,
        name: p.name,
        category: p.category ?? "",
        active: p.active ?? true,
        created_at: new Date(p.createdAt).toISOString(),
      })),
      { onConflict: "user_id,id" }
    );
    if (error) throw error;
  }

  // stores
  if (local.stores.length > 0) {
    const { error } = await supabase.from("stores").upsert(
      local.stores.map((s) => ({
        user_id: userId,
        id: s.id,
        name: s.name,
        created_at: new Date(s.createdAt).toISOString(),
      })),
      { onConflict: "user_id,id" }
    );
    if (error) throw error;
  }

  // inventory
  if (local.inventory.length > 0) {
    const { error } = await supabase.from("inventory").upsert(
      local.inventory.map((i) => ({
        user_id: userId,
        store_id: i.storeId,
        product_id: i.productId,
        on_hand_qty: i.onHandQty,
        updated_at: new Date(i.updatedAt).toISOString(),
      })),
      { onConflict: "user_id,store_id,product_id" }
    );
    if (error) throw error;
  }

  // store_product_states
  if ((local.storeProductStates ?? []).length > 0) {
    const { error } = await supabase.from("store_product_states").upsert(
      (local.storeProductStates ?? []).map((x) => ({
        user_id: userId,
        store_id: x.storeId,
        product_id: x.productId,
        enabled: x.enabled,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "user_id,store_id,product_id" }
    );
    if (error) throw error;
  }

  // ✅ 누락 조합 seed까지 보장
  await ensureStoreProductStatesSeedDB({
    storeIds: local.stores.map((s) => s.id),
    productIds: local.products.map((p) => p.id),
  });
}

// -----------------------------
// 재고 수량 upsert (핵심 쓰기)
// -----------------------------
export async function upsertInventoryItemDB(input: {
  storeId: string;
  productId: string;
  onHandQty: number;
}): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase.from("inventory").upsert(
    {
      user_id: userId,
      store_id: input.storeId,
      product_id: input.productId,
      on_hand_qty: input.onHandQty,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,store_id,product_id" }
  );

  if (error) throw error;
}

// -----------------------------
// 입점처별 enabled upsert
// -----------------------------
export async function setStoreProductEnabledDB(input: {
  storeId: string;
  productId: string;
  enabled: boolean;
}): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase.from("store_product_states").upsert(
    {
      user_id: userId,
      store_id: input.storeId,
      product_id: input.productId,
      enabled: input.enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,store_id,product_id" }
  );

  if (error) throw error;
}

// -----------------------------
// ✅ 제품 추가/수정 (DB) + seed
// -----------------------------
export async function createProductDB(p: Product): Promise<void> {
    const userId = await requireUserId();
  
    // 1) upsert
    const { error } = await supabase.from("products").upsert(
      {
        user_id: userId,
        id: p.id,
        name: p.name,
        category: p.category ?? "",
        active: p.active ?? true,
        created_at: new Date(p.createdAt).toISOString(),
      },
      { onConflict: "user_id,id" }
    );
    if (error) throw error;
  
    // 2) seed: 모든 입점처에 대해 (storeId x 이 productId) 조합 보장
    const { data: stores, error: stErr } = await supabase
      .from("stores")
      .select("id")
      .eq("user_id", userId);
    if (stErr) throw stErr;
  
    await ensureStoreProductStatesSeedDB({
      storeIds: (stores ?? []).map((s: any) => s.id),
      productIds: [p.id],
    });
  }
  
  // -----------------------------
  // ✅ 입점처 추가/수정 (DB) + seed
  // -----------------------------
  export async function createStoreDB(s: Store): Promise<void> {
    const userId = await requireUserId();
  
    // 1) upsert
    const { error } = await supabase.from("stores").upsert(
      {
        user_id: userId,
        id: s.id,
        name: s.name,
        created_at: new Date(s.createdAt).toISOString(),
      },
      { onConflict: "user_id,id" }
    );
    if (error) throw error;
  
    // 2) seed: 모든 제품에 대해 (이 storeId x productId) 조합 보장
    const { data: products, error: pErr } = await supabase
      .from("products")
      .select("id")
      .eq("user_id", userId);
    if (pErr) throw pErr;
  
    await ensureStoreProductStatesSeedDB({
      storeIds: [s.id],
      productIds: (products ?? []).map((p: any) => p.id),
    });
  }
  
  // ✅ product delete
  export async function deleteProductDB(productId: string): Promise<void> {
    const userId = await requireUserId();
  
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("user_id", userId)
      .eq("id", productId);
  
    if (error) throw error;
  }
  
  // ✅ store delete
  export async function deleteStoreDB(storeId: string): Promise<void> {
    const userId = await requireUserId();
  
    const { error } = await supabase
      .from("stores")
      .delete()
      .eq("user_id", userId)
      .eq("id", storeId);
  
    if (error) throw error;
  }
