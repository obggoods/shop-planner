// src/pages/Master.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Product, Store, StoreProductState } from "../data/models";
import { downloadJson, generateId, readJsonFile } from "../data/store";
import {
  loadDataFromDB,
  ensureStoreProductStatesSeedDB,
  setStoreProductEnabledDB,
  setStoreProductsEnabledBulkDB,
  createProductDB,
  createStoreDB,
  deleteProductDB,
  deleteStoreDB,
  loadCategoriesDB,
  upsertCategoryDB,
  deleteCategoryDB,
} from "../data/store.supabase";
import {
  supabase,
  getOrCreateMyProfile,
  updateMyDefaultTargetQty,
  updateMyLowStockThreshold,
} from "../lib/supabaseClient";

function sortByCreatedAtDesc<T extends { createdAt: number }>(arr: T[]) {
  return [...arr].sort((a, b) => b.createdAt - a.createdAt);
}

const EMPTY: AppData = {
  schemaVersion: 1,
  products: [],
  stores: [],
  inventory: [],
  storeProductStates: [],
  settlements: [],
  plans: [],
  updatedAt: Date.now(),
};

export default function Master() {
  const [data, setData] = useState<AppData>(EMPTY);
  const CATS_SEEDED_KEY = "ShopPlanner::categories_seeded_v1";
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // ✅ refresh 중복 호출 방지(동시에 여러 refresh가 돌지 않게)
const refreshInFlightRef = useRef<Promise<void> | null>(null);
const refreshQueuedRef = useRef(false);

  // ✅ 유저별 설정
  const [defaultTargetQtyInput, setDefaultTargetQtyInput] = useState<string>("5");
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [lowStockThresholdInput, setLowStockThresholdInput] = useState<string>("2");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setProfileLoading(true);
        const profile = await getOrCreateMyProfile();
        if (!alive) return;

        setDefaultTargetQtyInput(String(profile.default_target_qty));
        setLowStockThresholdInput(String(profile.low_stock_threshold ?? 2));
      } catch (e) {
        console.error("[profiles] failed to load profile", e);
      } finally {
        if (alive) setProfileLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const [newProductName, setNewProductName] = useState("");
  const [newStoreName, setNewStoreName] = useState("");

  // ✅ 카테고리 콤보박스
  const [newCategory, setNewCategory] = useState<string>("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categoryWrapRef = useRef<HTMLDivElement | null>(null);

  // ✅ categories 테이블 기반 카테고리 목록(제품이 없어도 유지)
  const [categories, setCategories] = useState<string[]>([]);

  // ✅ 카테고리 옵션: categories 테이블 기반 (제품 없어도 유지)
  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of categories) {
      const v = String(c).trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [categories]);

  // ✅ 카테고리 힌트용 상태 (기존 여부 판단)
  const normalizedCategory = useMemo(() => newCategory.trim(), [newCategory]);

  const isExistingCategory = useMemo(
    () => normalizedCategory !== "" && categoryOptions.includes(normalizedCategory),
    [normalizedCategory, categoryOptions]
  );

  // ✅ 카테고리 Enter로 단독 저장
  const saveCategoryOnly = useCallback(async () => {
    const c = newCategory.trim();
    if (!c) return;

    // 이미 있으면 저장 안 해도 됨
    if (categoryOptions.includes(c)) {
      setCategoryOpen(false);
      return;
    }

    // ✅ 1) UI 즉시 반영
    setCategories((prev) => [c, ...prev]);
    setCategoryOpen(false);
    setNewCategory("");

    try {
      // ✅ 2) DB 저장
      await upsertCategoryDB(c);
    } catch (e: any) {
      console.error(e);

      // ✅ 실패 시 롤백
      setCategories((prev) => prev.filter((x) => x !== c));
      alert(`카테고리 저장 실패: ${e?.message ?? e}`);
    }
  }, [newCategory, categoryOptions]);

  const [manageStoreId, setManageStoreId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    // 이미 refresh가 돌고 있으면 "한 번 더"만 예약하고 끝
    if (refreshInFlightRef.current) {
      refreshQueuedRef.current = true;
      return refreshInFlightRef.current;
    }
  
    const run = (async () => {
      do {
        refreshQueuedRef.current = false;
  
        // 1) 한 번만 로드
        const dbData = await loadDataFromDB();
  
        const storeIds = dbData.stores.map((s) => s.id);
        const productIds = dbData.products.map((p) => p.id);
  
        // 2) store×product 조합 누락 여부 검사 (누락이 있을 때만 seed)
        let needSeed = false;
        if (storeIds.length > 0 && productIds.length > 0) {
          const exist = new Set<string>();
          for (const x of dbData.storeProductStates ?? []) {
            exist.add(`${x.storeId}::${x.productId}`);
          }
  
          outer: for (const sId of storeIds) {
            for (const pId of productIds) {
              if (!exist.has(`${sId}::${pId}`)) {
                needSeed = true;
                break outer;
              }
            }
          }
        }
  
        // 3) seed가 필요하면 그때만 seed + 2차 로드
        const finalData = needSeed
          ? (await (async () => {
              await ensureStoreProductStatesSeedDB({ storeIds, productIds });
              return await loadDataFromDB();
            })())
          : dbData;
  
        // 4) categories는 별도로 1회 로드 (실패해도 앱 계속)
        const cats = await loadCategoriesDB().catch((e) => {
          console.error("[categories] load failed", e);
          return [];
        });
  
        setData(finalData);
        setCategories(cats);
  
        // refresh 도중 누군가 또 refresh 요청했으면 1번 더 돌기
      } while (refreshQueuedRef.current);
    })();
  
    refreshInFlightRef.current = run;
  
    try {
      await run;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, []);  

  // ✅ categories 테이블 로드 + (필요 시) products 기반으로 1회 seed
  const refreshCategories = useCallback(async () => {
    try {
      // 1) 먼저 DB(categories)에서 로드
      const cats = await loadCategoriesDB();

      // 이미 categories가 있으면 그대로 사용
      if (cats.length > 0) {
        setCategories(cats);
        return;
      }

      // 2) categories가 비어있으면: seed를 이미 했는지 체크(1회만)
      const alreadySeeded = localStorage.getItem(CATS_SEEDED_KEY) === "1";
      if (alreadySeeded) {
        setCategories([]); // 비어있는 상태 유지
        return;
      }

      // 3) products에서 카테고리 후보 뽑기(값이 있는 경우에만)
      const fromProducts = Array.from(
        new Set(
          (data.products ?? [])
            .map((p) => (p.category ?? "").trim())
            .filter((v) => v.length > 0)
        )
      ).sort((a, b) => a.localeCompare(b, "ko"));

      // products에도 없으면 seed할 필요 없음
      if (fromProducts.length === 0) {
        setCategories([]);
        return;
      }

      // 4) ✅ seed (카테고리 upsert)
      await Promise.all(fromProducts.map((c) => upsertCategoryDB(c)));

      // 5) ✅ 1회만 실행되도록 플래그 저장
      localStorage.setItem(CATS_SEEDED_KEY, "1");

      // 6) seed 후 다시 로드해서 state 반영
      const cats2 = await loadCategoriesDB();
      setCategories(cats2);
    } catch (e) {
      console.error("[categories] refreshCategories failed", e);
    }
  }, [data.products]);

  useEffect(() => {
    refreshCategories();
  }, [refreshCategories]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErrorMsg(null);
        await refresh();
      } catch (e: any) {
        if (!alive) return;
        console.error("[MASTER] load error", e);
        setErrorMsg(e?.message ?? String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  const products = useMemo(() => sortByCreatedAtDesc(data.products), [data.products]);
  const stores = useMemo(() => sortByCreatedAtDesc(data.stores), [data.stores]);

  const isEnabledInStore = useCallback(
    (storeId: string, productId: string) => {
      const hit = data.storeProductStates.find((x) => x.storeId === storeId && x.productId === productId);
      return hit ? hit.enabled : true;
    },
    [data.storeProductStates]
  );

  // =========================================================
  // ✅✅✅ 카테고리 병합(미분류 -> 선택한 카테고리) 기능 추가
  // =========================================================
  const uncategorizedCount = useMemo(() => {
    return (data.products ?? []).filter((p) => (p.category ?? null) === null).length;
  }, [data.products]);

  const [mergeTargetCategory, setMergeTargetCategory] = useState<string>("");
  const [isMergingCategory, setIsMergingCategory] = useState(false);

  const mergeUncategorizedToCategory = useCallback(async () => {
    const target = mergeTargetCategory.trim();
    if (!target) return;
    if (uncategorizedCount === 0) return;

    const ok = confirm(
      `미분류 제품 ${uncategorizedCount}개를 "${target}" 카테고리로 이동할까요?\n(즉시 반영 후 DB 저장합니다.)`
    );
    if (!ok) return;

    const prevProducts = data.products;

    // ✅ 1) UI 즉시 반영: category=null 인 제품들 -> target
    setIsMergingCategory(true);
    setData((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.category === null ? { ...p, category: target } : p)),
      updatedAt: Date.now(),
    }));

    // ✅ 2) 혹시 target이 categories에 없다면(드물지만) 드롭다운에도 즉시 반영
    setCategories((prev) => {
      const set = new Set(prev.map((x) => x.trim()));
      set.add(target);
      return Array.from(set);
    });

    try {
      // ✅ 3) DB 반영: products.category IS NULL 인 행들을 한 번에 update
      const { error } = await supabase.from("products").update({ category: target }).is("category", null);
      if (error) throw error;

      setMergeTargetCategory("");
    } catch (e: any) {
      console.error(e);
      // ❌ 실패 시 롤백
      setData((prev) => ({ ...prev, products: prevProducts, updatedAt: Date.now() }));
      alert(`카테고리 병합 실패: ${e?.message ?? e}`);
      await refresh();
    } finally {
      setIsMergingCategory(false);
    }
  }, [mergeTargetCategory, uncategorizedCount, data.products, refresh]);
  // =========================================================

  // ✅ 카테고리 삭제 (Optimistic) : products null 처리 + categories 테이블에서도 제거
  const deleteCategory = useCallback(
    async (category: string) => {
      const target = category.trim();
      if (!target) return;

      const ok = confirm(`카테고리 "${target}"를 삭제할까요?\n(이 카테고리를 쓰는 제품들은 "미분류"로 변경됩니다.)`);
      if (!ok) return;

      // 롤백용 백업
      const prevProducts = data.products;
      const prevCategories = categories;

      // ✅ 1) UI 즉시 반영: products의 해당 카테고리 -> null
      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => ((p.category ?? "").trim() === target ? { ...p, category: null } : p)),
        updatedAt: Date.now(),
      }));

      // ✅ 2) UI 즉시 반영: 드롭다운(categories)에서도 제거
      setCategories((prev) => prev.filter((c) => c.trim() !== target));

      // 입력칸 정리도 즉시
      setNewCategory((prev) => (prev.trim() === target ? "" : prev));

      try {
        // ✅ 3) DB 반영: products null + categories row 삭제를 1번 함수로 처리
        await deleteCategoryDB(target);
        // refresh()는 굳이 안 함 (느림 방지)
      } catch (e: any) {
        console.error(e);

        // 실패 시 롤백
        setData((prev) => ({ ...prev, products: prevProducts, updatedAt: Date.now() }));
        setCategories(prevCategories);

        alert(`카테고리 삭제 실패: ${e?.message ?? e}`);
        await refresh();
      }
    },
    [data.products, categories, refresh]
  );

  // ✅ 제품 삭제 (Optimistic)
  const deleteProduct = useCallback(
    async (productId: string) => {
      const target = data.products.find((p) => p.id === productId);
      if (!target) return;

      if (!confirm(`제품 "${target.name}"을(를) 삭제할까요?`)) return;

      const prev = data;

      setData((cur) => ({
        ...cur,
        products: cur.products.filter((p) => p.id !== productId),
        inventory: (cur.inventory ?? []).filter((i) => i.productId !== productId),
        storeProductStates: (cur.storeProductStates ?? []).filter((x) => x.productId !== productId),
        updatedAt: Date.now(),
      }));

      try {
        await deleteProductDB(productId);
      } catch (e: any) {
        console.error(e);
        setData(prev);
        alert(`제품 삭제 실패: ${e?.message ?? e}`);
        await refresh();
      }
    },
    [data, refresh]
  );

  // ✅ 단일 ON/OFF
  const toggleOne = useCallback(
    async (storeId: string, productId: string, nextEnabled: boolean) => {
      setData((prev) => ({
        ...prev,
        storeProductStates: [
          ...prev.storeProductStates.filter((x) => !(x.storeId === storeId && x.productId === productId)),
          { storeId, productId, enabled: nextEnabled },
        ],
        updatedAt: Date.now(),
      }));

      try {
        await setStoreProductEnabledDB({ storeId, productId, enabled: nextEnabled });
      } catch (e) {
        console.error(e);
        alert("저장 실패 (로그인 / 권한 / RLS 확인)");
        await refresh();
      }
    },
    [refresh]
  );

  // ✅ 전체 ON/OFF
  const toggleAll = useCallback(
    async (storeId: string, nextEnabled: boolean) => {
      const activeProductIds = data.products.filter((p) => p.active).map((p) => p.id);

      setData((prev) => {
        const list = prev.storeProductStates ?? [];
        const map = new Map<string, StoreProductState>();
        for (const x of list) map.set(`${x.storeId}|||${x.productId}`, x);

        for (const productId of activeProductIds) {
          const key = `${storeId}|||${productId}`;
          map.set(key, { storeId, productId, enabled: nextEnabled });
        }

        return { ...prev, storeProductStates: Array.from(map.values()), updatedAt: Date.now() };
      });

      try {
        await setStoreProductsEnabledBulkDB({
          storeId,
          productIds: activeProductIds,
          enabled: nextEnabled,
        });
      } catch (e: any) {
        console.error("toggleAll error:", e);
        alert(`전체 ON/OFF 저장 실패: ${e?.message ?? e}`);
      }
    },
    [data.products]
  );

  // ✅ 제품 추가 (Optimistic + category upsert)
  const addProduct = useCallback(async () => {
    const name = newProductName.trim();
    const categoryToSave = newCategory.trim() === "" ? null : newCategory.trim();
    if (!name) return;

    const p: Product = {
      id: generateId("p"),
      name,
      category: categoryToSave,
      active: true,
      makeEnabled: true,
      createdAt: Date.now(),
    };

    const prevProducts = data.products;
    const prevCategories = categories;

    // ✅ 1) UI 즉시 반영 (제품 추가)
    setData((prev) => ({
      ...prev,
      products: [p, ...prev.products],
      updatedAt: Date.now(),
    }));

    // ✅ 2) UI 즉시 반영 (새 카테고리는 드롭다운에 즉시 추가)
    if (categoryToSave) {
      setCategories((prev) => {
        const set = new Set(prev.map((x) => x.trim()));
        set.add(categoryToSave.trim());
        return Array.from(set);
      });
    }

    setNewProductName("");
    setNewCategory("");

    try {
      // ✅ 3) DB 반영: 카테고리 먼저 upsert -> 제품 upsert
      if (categoryToSave) {
        await upsertCategoryDB(categoryToSave);
      }
      await createProductDB(p);
    } catch (e: any) {
      console.error(e);
      setData((prev) => ({ ...prev, products: prevProducts, updatedAt: Date.now() }));
      setCategories(prevCategories);
      alert(`제품 추가 실패: ${e?.message ?? e}`);
      await refresh();
    }
  }, [newProductName, newCategory, data.products, categories, refresh]);

  // ✅ 제품 활성/비활성
  const toggleProductActive = useCallback(
    async (productId: string) => {
      const hit = data.products.find((p) => p.id === productId);
      if (!hit) return;

      const next = { ...hit, active: !hit.active };

      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === productId ? next : p)),
      }));

      try {
        await createProductDB(next);
      } catch (e) {
        console.error(e);
        setData((prev) => ({
          ...prev,
          products: prev.products.map((p) => (p.id === productId ? hit : p)),
        }));
        alert("제품 활성/비활성 변경 실패 (로그인 / 권한 / RLS 확인)");
      }
    },
    [data.products]
  );

  // ✅ 제품 제작대상 ON/OFF
  const toggleProductMakeEnabled = useCallback(
    async (productId: string) => {
      const hit = data.products.find((p) => p.id === productId);
      if (!hit) return;

      const next = { ...hit, makeEnabled: !(hit.makeEnabled ?? true) };

      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === productId ? next : p)),
      }));

      try {
        await createProductDB(next);
      } catch (e) {
        console.error(e);
        setData((prev) => ({
          ...prev,
          products: prev.products.map((p) => (p.id === productId ? hit : p)),
        }));
        alert("제품 제작 대상 변경 실패 (로그인 / 권한 / RLS 확인)");
      }
    },
    [data.products]
  );

  // ✅ 입점처 추가 (Optimistic)
  const addStore = useCallback(async () => {
    const name = newStoreName.trim();
    if (!name) return;

    const s: Store = {
      id: generateId("s"),
      name,
      createdAt: Date.now(),
    };

    const prevStores = data.stores;

    setData((prev) => ({
      ...prev,
      stores: [s, ...prev.stores],
      updatedAt: Date.now(),
    }));

    setNewStoreName("");

    try {
      await createStoreDB(s);
    } catch (e: any) {
      console.error(e);
      setData((prev) => ({ ...prev, stores: prevStores, updatedAt: Date.now() }));
      alert(`입점처 추가 실패: ${e?.message ?? e}`);
      await refresh();
    }
  }, [newStoreName, data.stores, refresh]);

  // ✅ 입점처 삭제 (Optimistic)
  const deleteStore = useCallback(
    async (storeId: string) => {
      const target = data.stores.find((s) => s.id === storeId);
      if (!target) return;

      if (!confirm(`입점처 "${target.name}"을(를) 삭제할까요? (관련 재고/설정도 함께 제거됩니다)`)) return;

      const prev = data;
      const prevManage = manageStoreId;

      setData((cur) => ({
        ...cur,
        stores: cur.stores.filter((s) => s.id !== storeId),
        inventory: (cur.inventory ?? []).filter((i) => i.storeId !== storeId),
        storeProductStates: (cur.storeProductStates ?? []).filter((x) => x.storeId !== storeId),
        updatedAt: Date.now(),
      }));

      if (manageStoreId === storeId) setManageStoreId("");

      try {
        await deleteStoreDB(storeId);
      } catch (e: any) {
        console.error(e);
        setData(prev);
        setManageStoreId(prevManage);
        alert(`입점처 삭제 실패: ${e?.message ?? e}`);
        await refresh();
      }
    },
    [data, manageStoreId, refresh]
  );

  // ✅ 백업
  const handleBackup = useCallback(async () => {
    try {
      await refresh();
      const filename = `shop-planner-backup_${new Date().toISOString().slice(0, 10)}.json`;
      downloadJson(filename, data);
    } catch (e) {
      console.error(e);
      alert("백업 실패");
    }
  }, [data, refresh]);

  // ✅ 복구(로컬 반영)
  async function handleRestore(file: File) {
    try {
      const parsed = (await readJsonFile(file)) as Partial<AppData>;
      if (!parsed || parsed.schemaVersion !== 1) {
        alert("백업 파일 형식이 올바르지 않습니다 (schemaVersion 불일치).");
        return;
      }
      const next: AppData = {
        schemaVersion: 1,
        products: parsed.products ?? [],
        stores: parsed.stores ?? [],
        inventory: parsed.inventory ?? [],
        storeProductStates: parsed.storeProductStates ?? [],
        settlements: parsed.settlements ?? [],
        plans: parsed.plans ?? [],
        updatedAt: Date.now(),
      };
      setData(next);
      alert("복구(로컬 반영) 완료! DB로 업로드까지 원하면 기능 추가해줄게.");
    } catch {
      alert("복구 실패: JSON 파일을 읽을 수 없습니다.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (errorMsg) return <div style={{ padding: 16, color: "crimson" }}>에러: {errorMsg}</div>;

  return (
    <div className="pageWrap">
      <div className="pageContainer">
        <h2 style={{ marginTop: 0 }}>마스터 관리</h2>

        {loading && (
  <div style={{ fontSize: 12, color: "#666", margin: "6px 0 10px" }}>
    동기화 중…
  </div>
)}

        {/* ✅ 유저별 설정 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: 12,
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 12,
            marginBottom: 16,
            background: "#fff",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>기본 목표 재고 수량</div>
            <input
              type="number"
              min={0}
              step={1}
              value={defaultTargetQtyInput}
              onChange={(e) => setDefaultTargetQtyInput(e.target.value)}
              onBlur={async () => {
                const val =
                  defaultTargetQtyInput.trim() === ""
                    ? 0
                    : Math.max(0, parseInt(defaultTargetQtyInput, 10) || 0);

                setDefaultTargetQtyInput(String(val));

                try {
                  setProfileSaving(true);
                  await updateMyDefaultTargetQty(val);
                } catch (e) {
                  console.error("[profiles] failed to save default_target_qty", e);
                } finally {
                  setProfileSaving(false);
                }
              }}
              disabled={profileLoading || profileSaving}
              style={{
                width: 90,
                padding: "6px 10px",
                border: "1px solid rgba(0,0,0,0.18)",
                borderRadius: 10,
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>최소 재고 수량(≤)</div>
            <input
              type="number"
              min={0}
              step={1}
              value={lowStockThresholdInput}
              onChange={(e) => setLowStockThresholdInput(e.target.value)}
              onBlur={async () => {
                const val =
                  lowStockThresholdInput.trim() === ""
                    ? 0
                    : Math.max(0, parseInt(lowStockThresholdInput, 10) || 0);

                setLowStockThresholdInput(String(val));

                try {
                  setProfileSaving(true);
                  await updateMyLowStockThreshold(val);
                } catch (e) {
                  console.error("[profiles] failed to save low_stock_threshold", e);
                } finally {
                  setProfileSaving(false);
                }
              }}
              disabled={profileLoading || profileSaving}
              style={{
                width: 70,
                padding: "6px 10px",
                border: "1px solid rgba(0,0,0,0.18)",
                borderRadius: 10,
              }}
            />
          </div>

          <div style={{ fontSize: 12, color: "#666" }}>
            {profileLoading ? "불러오는 중…" : profileSaving ? "저장 중…" : "제작 리스트 계산 기준으로 사용돼요."}
          </div>
        </div>

        <section className="masterTopGrid">
          <div className="masterCard masterProducts">
            <h3 style={{ marginTop: 0 }}>제품 추가</h3>

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "flex-start",
                minWidth: 0,
              }}
            >
              {/* ✅ 카테고리 콤보박스 */}
              <div
                ref={categoryWrapRef}
                style={{
                  position: "relative",
                  flex: "1 1 180px",
                  minWidth: 160,
                  maxWidth: 220,
                }}
              >
                <input
                  value={newCategory}
                  onChange={(e) => {
                    setNewCategory(e.target.value);
                    setCategoryOpen(true);
                  }}
                  onFocus={() => setCategoryOpen(true)}
                  onBlur={() => {
                    setTimeout(() => setCategoryOpen(false), 120);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveCategoryOnly();
                    }
                  }}
                  placeholder="카테고리 입력/선택"
                  style={{
                    padding: 8,
                    width: "100%",
                    height: 36,
                    boxSizing: "border-box",
                  }}
                />

                {isExistingCategory && (
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 12,
                      color: "#9ca3af",
                      userSelect: "none",
                    }}
                  >
                    이미 존재하는 카테고리입니다
                  </div>
                )}

                {categoryOpen && categoryOptions.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "100%",
                      left: 0,
                      right: 0,
                      marginTop: 6,
                      border: "1px solid rgba(0,0,0,0.12)",
                      borderRadius: 10,
                      background: "white",
                      boxShadow: "0 10px 20px rgba(0,0,0,0.08)",
                      maxHeight: 240,
                      overflow: "auto",
                      zIndex: 50,
                    }}
                  >
                    {categoryOptions
                      .filter((c) => {
                        const q = newCategory.trim();
                        if (!q) return true;
                        return c.includes(q);
                      })
                      .map((c) => (
                        <div
                          key={c}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 8,
                            padding: "6px 10px",
                            borderBottom: "1px solid rgba(0,0,0,0.06)",
                            cursor: "pointer",
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setNewCategory(c);
                            setCategoryOpen(false);
                          }}
                        >
                          <div style={{ fontSize: 13 }}>{c}</div>

                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteCategory(c);
                            }}
                            title="카테고리 삭제"
                            style={{
                              border: "none",
                              background: "transparent",
                              color: "rgb(220,38,38)",
                              fontSize: 13,
                              lineHeight: "13px",
                              padding: "2px 6px",
                              cursor: "pointer",
                              opacity: 0.7,
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* ✅ 제품명 */}
              <input
                value={newProductName}
                onChange={(e) => setNewProductName(e.target.value)}
                placeholder="예: 미드나잇블루"
                style={{
                  flex: "2 1 220px",
                  padding: 8,
                  minWidth: 0,
                  height: 36,
                  boxSizing: "border-box",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addProduct();
                }}
              />

              {/* ✅ 추가 버튼 */}
              <button
                onClick={addProduct}
                style={{
                  padding: "8px 12px",
                  height: 36,
                  boxSizing: "border-box",
                  flex: "0 0 auto",
                  whiteSpace: "nowrap",
                }}
                disabled={loading}>
                추가
              </button>
            </div>

            {/* ✅✅✅ 미분류 병합 UI */}
            <div
              style={{
                marginTop: 12,
                padding: 10,
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 12,
                background: "rgba(17, 24, 39, 0.02)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>미분류 제품 병합</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                    미분류(null) 제품 {uncategorizedCount}개를 선택한 카테고리로 한 번에 이동
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={mergeTargetCategory}
                  onChange={(e) => setMergeTargetCategory(e.target.value)}
                  disabled={isMergingCategory || uncategorizedCount === 0}
                  style={{ padding: 8, minWidth: 220 }}
                >
                  <option value="">(이동할 카테고리 선택)</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={mergeUncategorizedToCategory}
                  disabled={!mergeTargetCategory.trim() || isMergingCategory || uncategorizedCount === 0}
                  style={{ padding: "8px 12px", opacity: !mergeTargetCategory.trim() || uncategorizedCount === 0 ? 0.5 : 1 }}
                >
                  {isMergingCategory ? "적용중..." : "적용"}
                </button>

                {uncategorizedCount === 0 && (
                  <span style={{ fontSize: 12, color: "#6b7280" }}>미분류 제품이 없습니다</span>
                )}
              </div>
            </div>

            <p style={{ margin: "8px 0 0", color: "#666", fontSize: 13 }}>
              * 제품은 DB에 저장돼. (옵션/색상은 2차에서 확장)
            </p>
          </div>

          <div className="masterCard masterStores">
            <h3 style={{ marginTop: 0 }}>입점처 추가</h3>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newStoreName}
                onChange={(e) => setNewStoreName(e.target.value)}
                placeholder="예: 홍대 A소품샵"
                style={{ flex: 1, padding: 8 }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addStore();
                }}
              />

              <button onClick={addStore} disabled={loading} 
              style={{ padding: "8px 12px" }}>
                추가
              </button>
            </div>
          </div>
        </section>

        <section style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minWidth: 280, flex: 1 }}>
            <h3 style={{ marginTop: 0 }}>백업 / 복구</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
              <button onClick={handleBackup} style={{ padding: "8px 12px" }}>
                백업(JSON 다운로드)
              </button>

              <button onClick={() => fileInputRef.current?.click()} style={{ padding: "8px 12px" }}>
                복구(JSON 가져오기)
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleRestore(f);
                }}
              />
            </div>

            <p style={{ margin: "8px 0 0", color: "#666", fontSize: 13 }}>* 백업은 “현재 DB 데이터 기준”으로 export 하는 용도.</p>
          </div>
        </section>

        <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>입점처별 취급 제품 설정</h3>
          <p style={{ marginTop: 0, color: "#666", fontSize: 13 }}>
            입점처마다 입고하는 제품이 다르면 여기서 ON/OFF로 관리해. (OFF면 대시보드에서 숨김 + 제작 계산 제외)
          </p>

          {stores.length === 0 ? (
            <p style={{ color: "#666" }}>입점처가 없어. 먼저 입점처를 추가해줘.</p>
          ) : products.length === 0 ? (
            <p style={{ color: "#666" }}>제품이 없어. 먼저 제품을 추가해줘.</p>
          ) : (
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={manageStoreId}
                onChange={(e) => setManageStoreId(e.target.value)}
                style={{ padding: 8, minWidth: 220 }}
              >
                <option value="">(입점처 선택)</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              {!manageStoreId ? (
                <span style={{ color: "#666", fontSize: 13 }}>입점처를 선택하면 제품 ON/OFF 목록이 보여.</span>
              ) : (
                <span style={{ color: "#111827", fontSize: 13, fontWeight: 700 }}>
                  선택됨: {stores.find((s) => s.id === manageStoreId)?.name}
                </span>
              )}
            </div>
          )}

          {!!manageStoreId && (
            <div style={{ marginTop: 12, borderTop: "1px solid #eee", paddingTop: 12 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={() => toggleAll(manageStoreId, true)} style={{ padding: "6px 10px" }}>
                  전체 ON
                </button>

                <button type="button" onClick={() => toggleAll(manageStoreId, false)} style={{ padding: "6px 10px" }}>
                  전체 OFF
                </button>
              </div>

              <div style={{ marginTop: 10 }}>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {products
                    .filter((p) => p.active)
                    .map((p) => {
                      const enabled = isEnabledInStore(manageStoreId, p.id);
                      return (
                        <li
                          key={p.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "8px 0",
                            borderBottom: "1px solid #f2f2f2",
                            opacity: enabled ? 1 : 0.45,
                          }}
                        >
                          <div>
                            <strong>
                              [{p.category ?? "미분류"}] {p.name}
                            </strong>
                            <div style={{ fontSize: 12, color: "#666" }}>{enabled ? "ON (취급)" : "OFF (미취급)"}</div>
                          </div>

                          <button
                            type="button"
                            onClick={() => toggleOne(manageStoreId, p.id, !enabled)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 8,
                              border: "1px solid #ddd",
                              background: enabled ? "#111827" : "white",
                              color: enabled ? "white" : "#111827",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {enabled ? "OFF" : "ON"}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </div>
            </div>
          )}
        </section>

        <section
          className="masterTwoCol"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
            gap: 16,
          }}
        >
          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>제품 목록</h3>
            {products.length === 0 ? (
              <p style={{ color: "#666" }}>아직 제품이 없어. 위에서 추가해봐.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {products.map((p) => (
                  <li
                    key={p.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "8px 0",
                      borderBottom: "1px solid #eee",
                      opacity: p.active ? (p.makeEnabled === false ? 0.6 : 1) : 0.4,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <strong>
                        [{p.category ?? "미분류"}] {p.name}
                      </strong>
                      <span style={{ fontSize: 12, color: "#666" }}>
                        {p.active ? "활성" : "비활성"}
                        {p.makeEnabled === false ? " · 제작중지" : ""}
                      </span>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                        <input type="checkbox" checked={p.makeEnabled !== false} onChange={() => toggleProductMakeEnabled(p.id)} />
                        제작대상
                      </label>

                      <button onClick={() => toggleProductActive(p.id)} style={{ padding: "6px 10px" }}>
                        {p.active ? "비활성" : "활성"}
                      </button>

                      <button 
                        onClick={() => deleteProduct(p.id)} 
                        disabled={loading} 
                        style={{ padding: "6px 10px" }}
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>입점처 목록</h3>
            {stores.length === 0 ? (
              <p style={{ color: "#666" }}>아직 입점처가 없어. 위에서 추가해봐.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {stores.map((s) => (
                  <li
                    key={s.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "8px 0",
                      borderBottom: "1px solid #eee",
                    }}
                  >
                    <strong>{s.name}</strong>
                    <button onClick={() => deleteStore(s.id)} style={{ padding: "6px 10px" }}>
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
