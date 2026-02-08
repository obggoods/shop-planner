// src/data/store.supabase.ts
import { supabase } from "../lib/supabaseClient";
import type { AppData, Product, Store } from "./models";
import { createEmptyData } from "./store";

/* =========================
   DB Row Types
========================= */

type DBProduct = {
  id: string;
  name: string;
  category: string | null;
  active: boolean | null;
  make_enabled: boolean | null;
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

/* =========================
   Auth Helper
========================= */

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Not authenticated");
  return data.user.id;
}

/* =========================
   Store × Product Seed
========================= */

export async function ensureStoreProductStatesSeedDB(input: {
  storeIds: string[];
  productIds: string[];
}): Promise<void> {
  const userId = await requireUserId();
  if (input.storeIds.length === 0 || input.productIds.length === 0) return;

  const { data: existing, error } = await supabase
    .from("store_product_states")
    .select("store_id,product_id")
    .eq("user_id", userId);

  if (error) throw error;

  const exists = new Set(
    (existing ?? []).map((r: any) => `${r.store_id}__${r.product_id}`)
  );

  const now = new Date().toISOString();
  const rows: any[] = [];

  for (const storeId of input.storeIds) {
    for (const productId of input.productIds) {
      const key = `${storeId}__${productId}`;
      if (exists.has(key)) continue;

      rows.push({
        user_id: userId,
        store_id: storeId,
        product_id: productId,
        enabled: true,
        updated_at: now,
      });
    }
  }

  if (rows.length === 0) return;

  const { error: insErr } = await supabase
    .from("store_product_states")
    .insert(rows);

  if (insErr) throw insErr;
}

/* =========================
   DB → AppData Load
========================= */

export async function loadDataFromDB(): Promise<AppData> {
  const userId = await requireUserId();

  const [productsRes, storesRes, invRes, spsRes] = await Promise.all([
    supabase
      .from("products")
      .select("id,name,category,active,make_enabled,created_at")
      .eq("user_id", userId)
      .order("created_at"),
    supabase
      .from("stores")
      .select("id,name,created_at")
      .eq("user_id", userId)
      .order("created_at"),
    supabase
      .from("inventory")
      .select("store_id,product_id,on_hand_qty,updated_at")
      .eq("user_id", userId),
    supabase
      .from("store_product_states")
      .select("store_id,product_id,enabled")
      .eq("user_id", userId),
  ]);

  const err =
    productsRes.error ||
    storesRes.error ||
    invRes.error ||
    spsRes.error;
  if (err) throw err;

  const products = (productsRes.data ?? []) as DBProduct[];
  const stores = (storesRes.data ?? []) as DBStore[];
  const inventory = (invRes.data ?? []) as DBInventory[];

  // seed 보장
  await ensureStoreProductStatesSeedDB({
    storeIds: stores.map((s) => s.id),
    productIds: products.map((p) => p.id),
  });

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
      category: p.category,
      active: p.active ?? true,
      makeEnabled: p.make_enabled ?? true,
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

/* =========================
   Category (분리 관리)
========================= */

// 목록 로드
export async function loadCategoriesDB(): Promise<string[]> {
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from("categories")
    .select("name")
    .eq("user_id", userId)
    .order("created_at");

  if (error) throw error;
  return (data ?? []).map((r: any) => String(r.name));
}

// 추가 (제품 추가 시 함께 호출)
export async function upsertCategoryDB(name: string): Promise<void> {
  const userId = await requireUserId();
  const c = name.trim();
  if (!c) return;

  const { error } = await supabase
    .from("categories")
    .upsert({ user_id: userId, name: c }, { onConflict: "user_id,name" });

  if (error) throw error;
}

// 삭제 (카테고리 자체 삭제 + 제품들은 null 처리)
export async function deleteCategoryDB(name: string): Promise<void> {
  const userId = await requireUserId();
  const c = name.trim();
  if (!c) return;

  const { error: updErr } = await supabase
    .from("products")
    .update({ category: null })
    .eq("user_id", userId)
    .eq("category", c);
  if (updErr) throw updErr;

  const { error: delErr } = await supabase
    .from("categories")
    .delete()
    .eq("user_id", userId)
    .eq("name", c);
  if (delErr) throw delErr;
}

/* =========================
   Inventory / States
========================= */

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

export async function setStoreProductsEnabledBulkDB(input: {
  storeId: string;
  productIds: string[];
  enabled: boolean;
}): Promise<void> {
  const userId = await requireUserId();
  if (input.productIds.length === 0) return;

  const now = new Date().toISOString();

  const rows = input.productIds.map((productId) => ({
    user_id: userId,
    store_id: input.storeId,
    product_id: productId,
    enabled: input.enabled,
    updated_at: now,
  }));

  const { error } = await supabase
    .from("store_product_states")
    .upsert(rows, { onConflict: "user_id,store_id,product_id" });

  if (error) throw error;
}

/* =========================
   Product / Store CRUD
========================= */

export async function createProductDB(p: Product): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase.from("products").upsert(
    {
      user_id: userId,
      id: p.id,
      name: p.name,
      category: p.category,
      active: p.active ?? true,
      make_enabled: p.makeEnabled ?? true,
      created_at: new Date(p.createdAt).toISOString(),
    },
    { onConflict: "user_id,id" }
  );
  if (error) throw error;

  const { data: stores } = await supabase
    .from("stores")
    .select("id")
    .eq("user_id", userId);

  await ensureStoreProductStatesSeedDB({
    storeIds: (stores ?? []).map((s: any) => s.id),
    productIds: [p.id],
  });
}

export async function createStoreDB(s: Store): Promise<void> {
  const userId = await requireUserId();

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

  const { data: products } = await supabase
    .from("products")
    .select("id")
    .eq("user_id", userId);

  await ensureStoreProductStatesSeedDB({
    storeIds: [s.id],
    productIds: (products ?? []).map((p: any) => p.id),
  });
}

export async function deleteProductDB(productId: string): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("user_id", userId)
    .eq("id", productId);

  if (error) throw error;
}

export async function deleteStoreDB(storeId: string): Promise<void> {
  const userId = await requireUserId();

  const { error } = await supabase
    .from("stores")
    .delete()
    .eq("user_id", userId)
    .eq("id", storeId);

  if (error) throw error;
}