// src/pages/Master.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
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

/** ✅ CSV row 타입(반드시 고정) */
type ProductCsvRow = { category: string; name: string; active: boolean };

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

// ===== CSV helpers (no external libs) =====
function normalizeCategoryKey(raw: string | null | undefined) {
  const c = (raw ?? "").trim();
  return c; // empty string = uncategorized
}

function normalizeNameKey(raw: string | null | undefined) {
  return (raw ?? "").trim();
}

function parseBooleanLike(v: string): boolean {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "") return true; // 비어있으면 기본 활성
  if (["true", "t", "1", "y", "yes", "on", "활성"].includes(t)) return true;
  if (["false", "f", "0", "n", "no", "off", "비활성"].includes(t)) return false;
  return true;
}

// 매우 단순한 CSV 파서 (따옴표/쉼표 포함 복잡 케이스는 미지원)
// - 우리 템플릿 기준: category,name,active
function parseSimpleCSV(text: string): ProductCsvRow[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const header = lines[0].split(",").map((x) => x.trim().toLowerCase());
  const idxCategory = header.indexOf("category");
  const idxName = header.indexOf("name");
  const idxActive = header.indexOf("active");

  if (idxName === -1 || idxActive === -1) {
    throw new Error('CSV 헤더에 "name,active"가 필요합니다. (권장: category,name,active)');
  }

  // ✅ 여기 타입을 명시해야 never로 안 꼬임
  const rows: ProductCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((x) => x.trim());
    const category = idxCategory >= 0 ? cols[idxCategory] ?? "" : "";
    const name = cols[idxName] ?? "";
    const activeRaw = cols[idxActive] ?? "";

    const active = parseBooleanLike(activeRaw);

    rows.push({ category, name, active });
  }

  return rows;
}

function downloadCsv(filename: string, csvBody: string) {
  const blob = new Blob(["\uFEFF" + csvBody], { type: "text/csv;charset=utf-8;" }); // ✅ BOM 포함
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

export default function Master() {
  const [data, setData] = useState<AppData>(EMPTY);
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

  // ✅ CSV 업로드(엑셀 제품 일괄 추가)
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  const [newProductName, setNewProductName] = useState("");
  const [newStoreName, setNewStoreName] = useState("");
  // ✅ 제품명 수정 UI 상태
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingProductName, setEditingProductName] = useState<string>("");
  const editingOriginalRef = useRef<string>("");

  const [editingProductCategory, setEditingProductCategory] = useState<string>("");
  const editingOriginalCategoryRef = useRef<string>("");

  // ✅ 카테고리 콤보박스
  const [newCategory, setNewCategory] = useState<string>("");
  // ✅ 카테고리 경고는 '직접 타이핑' 중복일 때만 띄우기 위한 플래그
  const [categoryTyped, setCategoryTyped] = useState(false);
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
    setCategoryTyped(false);

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

  // ✅ 입점처별 ON/OFF 목록: 카테고리 접기/펼치기 상태
  const [openStoreCats, setOpenStoreCats] = useState<Record<string, boolean>>({});

  // =========================
  // ✅ 제품 목록: 카테고리 필터 + 페이지네이션
  // =========================
  const ITEMS_PER_PAGE = 20;

  // "all" | "uncategorized" | (카테고리명)
  const [productListCategory, setProductListCategory] = useState<string>("all");
  const [productListPage, setProductListPage] = useState<number>(1);

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
          ? await (async () => {
              await ensureStoreProductStatesSeedDB({ storeIds, productIds });
              return await loadDataFromDB();
            })()
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

  // ✅ 카테고리/필터가 바뀌면 페이지는 1로 리셋
  useEffect(() => {
    setProductListPage(1);
  }, [productListCategory]);

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

  const products = useMemo(() => {
    // 0) 기본(안전장치): 최신(createdAt desc)
    const base = sortByCreatedAtDesc(data.products);

    // 1) 상단 그룹: 활성 && 제작대상
    const isTop = (p: Product) => p.active && p.makeEnabled !== false;

    // 2) 문자열 정렬용(카테고리/이름)
    const catKey = (p: Product) => (p.category ?? "미분류").trim();
    const nameKey = (p: Product) => p.name.trim();

    return [...base].sort((a, b) => {
      const aTop = isTop(a);
      const bTop = isTop(b);

      // ✅ Top 그룹 먼저
      if (aTop !== bTop) return aTop ? -1 : 1;

      // ✅ Top 그룹 내부는 카테고리/이름 가나다순
      if (aTop && bTop) {
        const c = catKey(a).localeCompare(catKey(b), "ko");
        if (c !== 0) return c;

        const n = nameKey(a).localeCompare(nameKey(b), "ko");
        if (n !== 0) return n;

        // 완전 동일할 때만 최신순
        return b.createdAt - a.createdAt;
      }

      // ✅ 둘 다 Top이 아니면 최신순 유지
      return b.createdAt - a.createdAt;
    });
  }, [data.products]);

  // ✅ 제품 목록 필터(카테고리)
  const filteredProducts = useMemo(() => {
    if (productListCategory === "all") return products;

    if (productListCategory === "uncategorized") {
      return products.filter((p) => (p.category ?? null) === null);
    }

    // 특정 카테고리
    return products.filter((p) => (p.category ?? "").trim() === productListCategory);
  }, [products, productListCategory]);

  // ✅ 페이지네이션 계산
  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filteredProducts.length / ITEMS_PER_PAGE));
  }, [filteredProducts.length]);

  // ✅ 현재 페이지 아이템
  const pagedProducts = useMemo(() => {
    const safePage = Math.min(Math.max(1, productListPage), totalPages);
    const start = (safePage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredProducts, productListPage, totalPages]);

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
        // ✅ 3) DB 반영
        await deleteCategoryDB(target);
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
    setCategoryTyped(false);

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
      alert(`제품 추가 실패: ${e?.message ?? e?.error?.message ?? JSON.stringify(e)}`);
      await refresh();
    }
  }, [newProductName, newCategory, data.products, categories, refresh]);

  const downloadProductCsvTemplate = useCallback(() => {
    const csv = ["category,name,active", "버튼 키링,낮의금붕어,1", "버튼 키링,밤의금붕어,1", ",미분류샘플,0"].join("\n");
    downloadCsv("products_template.csv", csv);
  }, []);

  /** ✅ 핵심: handleProductCsvUpload는 File만 받는 함수 */
  const handleProductCsvUpload = useCallback(
    async (file: File) => {
      const text = await file.text();
      const rows = parseSimpleCSV(text);

      // 유효 row만
      const cleaned: ProductCsvRow[] = rows
        .map((r) => ({
          category: (r.category ?? "").trim(),
          name: (r.name ?? "").trim(),
          active: parseBooleanLike(String((r as any).active ?? "")),
        }))
        .filter((r) => r.name.length > 0);

      if (cleaned.length === 0) {
        alert("업로드할 제품이 없습니다. (name이 비어있으면 무시됩니다)");
        return;
      }

      // 중복 row(동일 category+name)는 마지막 값으로 덮어쓰기
      const byKey = new Map<string, ProductCsvRow>();
      for (const r of cleaned) {
        const key = `${normalizeCategoryKey(r.category)}||${normalizeNameKey(r.name)}`;
        byKey.set(key, r);
      }
      const uniqueRows: ProductCsvRow[] = Array.from(byKey.values());

      setCsvBusy(true);

      // UI 롤백용 백업
      const prevData = data;
      const prevCategories = categories;

      try {
        // 1) 기존 products를 Map으로
        const existing = new Map<string, Product>();
        for (const p of data.products) {
          const key = `${normalizeCategoryKey(p.category)}||${normalizeNameKey(p.name)}`;
          existing.set(key, p);
        }

        const nextProducts: Product[] = [...data.products];
        const changed: Product[] = [];
        const newCats: string[] = [];

        for (const r of uniqueRows) {
          const catTrim = r.category.trim();
          const categoryOrNull = catTrim === "" ? null : catTrim;
          const key = `${normalizeCategoryKey(categoryOrNull ?? "")}||${normalizeNameKey(r.name)}`;

          const hit = existing.get(key);

          if (hit) {
            // ✅ 업서트(업데이트): active만 반영
            const next: Product = { ...hit, active: r.active };
            const idx = nextProducts.findIndex((x) => x.id === hit.id);
            if (idx >= 0) nextProducts[idx] = next;
            changed.push(next);
          } else {
            // ✅ 신규 생성
            const p: Product = {
              id: generateId("p"),
              name: r.name,
              category: categoryOrNull,
              active: r.active,
              makeEnabled: true,
              createdAt: Date.now(),
            };
            nextProducts.unshift(p);
            existing.set(key, p);
            changed.push(p);

            if (categoryOrNull) newCats.push(categoryOrNull);
          }
        }

        // 2) UI 먼저 반영 (optimistic)
        setData((prev) => ({
          ...prev,
          products: nextProducts,
          updatedAt: Date.now(),
        }));

        // categories UI 반영
        if (newCats.length > 0) {
          const set = new Set([...categories.map((x) => x.trim()), ...newCats.map((x) => x.trim())].filter(Boolean));
          setCategories(Array.from(set));
        }

        // 3) DB 반영 (순차 upsert)
        const catSet = new Set(newCats.map((x) => x.trim()).filter(Boolean));
        for (const c of catSet) {
          await upsertCategoryDB(c);
        }
        for (const p of changed) {
          await createProductDB(p);
        }

        alert(`CSV 반영 완료: ${changed.length}건 처리됨 (업데이트+신규 포함)`);
      } catch (e: any) {
        console.error(e);
        // 롤백
        setData(prevData);
        setCategories(prevCategories);
        alert(`CSV 업로드 실패: ${e?.message ?? e}`);
        await refresh();
      } finally {
        setCsvBusy(false);
        if (csvInputRef.current) csvInputRef.current.value = "";
      }
    },
    [data, categories, refresh]
  );

  /** ✅ input onChange는 event를 받는 함수 */
  const onChangeProductCsv = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;

      await handleProductCsvUpload(f);

      // 같은 파일 다시 업로드 가능하게 초기화
      e.target.value = "";
    },
    [handleProductCsvUpload]
  );

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

  const saveProductFields = useCallback(
    async (productId: string, nextNameRaw: string, nextCategoryRaw: string) => {
      const hit = data.products.find((p) => p.id === productId);
      if (!hit) return;
  
      const nextName = nextNameRaw.trim();
      const nextCategory = nextCategoryRaw.trim();
  
      if (!nextName) {
        alert("제품명은 비워둘 수 없어.");
        setEditingProductName(editingOriginalRef.current);
        setEditingProductCategory(editingOriginalCategoryRef.current);
        return;
      }
  
      // "미분류"는 DB에 null/""로 저장하고 싶으면 여기서 정규화
      // 너 UI가 p.category ?? "미분류" 형태면, null/"" 둘 다 OK
      const normalizedCategory = nextCategory === "" || nextCategory === "미분류" ? "" : nextCategory;
  
      // 변경 없으면 종료
      if (nextName === hit.name && (normalizedCategory || "") === (hit.category || "")) return;
  
      const prevProducts = data.products;
      const next = { ...hit, name: nextName, category: normalizedCategory || null };
  
      // ✅ 1) UI 즉시 반영
      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === productId ? next : p)),
        updatedAt: Date.now(),
      }));
  
      try {
        // ✅ 2) DB 저장 (업서트)
        await createProductDB(next);
      } catch (e: any) {
        console.error(e);
        // ✅ 3) 실패 시 롤백
        setData((prev) => ({ ...prev, products: prevProducts, updatedAt: Date.now() }));
        alert(`저장 실패: ${e?.message ?? e}`);
        await refresh();
      }
    },
    [data.products, refresh]
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

        {/* ✅ 상단: 제품추가 / 입점처추가 */}
        <section className="masterTopGrid">
          <div className="masterCard masterProducts">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <h3 style={{ margin: 0 }}>제품 추가</h3>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={downloadProductCsvTemplate} style={{ padding: "6px 10px", fontSize: 13 }}>
                  CSV 템플릿 다운로드
                </button>

                <button
                  type="button"
                  onClick={() => csvInputRef.current?.click()}
                  disabled={loading || csvBusy}
                  style={{ padding: "6px 10px", fontSize: 13 }}
                >
                  CSV로 제품 일괄 추가/업데이트
                </button>

                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv"
                  style={{ display: "none" }}
                  onChange={onChangeProductCsv}
                />
              </div>
            </div>

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
          setCategoryTyped(true);
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

      {isExistingCategory && categoryTyped && (
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
                  setCategoryTyped(false);
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
      disabled={loading}
    >
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
        style={{
          padding: "8px 12px",
          opacity: !mergeTargetCategory.trim() || uncategorizedCount === 0 ? 0.5 : 1,
        }}
      >
        {isMergingCategory ? "적용중..." : "적용"}
      </button>

      {uncategorizedCount === 0 && <span style={{ fontSize: 12, color: "#6b7280" }}>미분류 제품이 없습니다</span>}
    </div>
  </div>
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

    <button onClick={addStore} disabled={loading} style={{ padding: "8px 12px" }}>
      추가
    </button>
  </div>
</div>

        </section>
  
        {/* ✅ 백업/복구 */}
        <section style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <div className="masterCard" style={{ minWidth: 280, flex: 1 }}>
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
  
            <p style={{ margin: "8px 0 0", color: "#666", fontSize: 13 }}>
              * 백업은 “현재 DB 데이터 기준”으로 export 하는 용도.
            </p>
          </div>
        </section>
  
        {/* ✅ 입점처별 취급 제품 설정 */}
<section className="masterCard" style={{ marginBottom: 16 }}>
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
      {(() => {
  // ✅ 활성 제품만 대상
  const activeProducts = products.filter((p) => p.active);

  // ✅ 카테고리별 그룹핑
  const groups = new Map<string, Product[]>();
  for (const p of activeProducts) {
    const cat = (p.category ?? "미분류").trim() || "미분류";
    const arr = groups.get(cat) ?? [];
    arr.push(p);
    groups.set(cat, arr);
  }

  // ✅ 카테고리 정렬 (가나다)
  const cats = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, "ko"));

  return (
    <div style={{ marginTop: 10 }}>
      {cats.map((cat) => {
        const list = groups.get(cat) ?? [];

        // ✅ 제품명 가나다 정렬(같은 카테고리 내)
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"));

        // ✅ 기본값: 처음엔 펼쳐진 상태(원하면 false로 바꿔도 됨)
        const isOpen = openStoreCats[cat] ?? false;

        // ✅ ON 개수 표시
        const onCount = sorted.reduce((acc, p) => (isEnabledInStore(manageStoreId, p.id) ? acc + 1 : acc), 0);

        return (
          <div
            key={cat}
            style={{
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: 12,
              background: "#fff",
              marginBottom: 10,
              overflow: "hidden",
            }}
          >
            {/* 카테고리 헤더 */}
            <button
              type="button"
              onClick={() =>
                setOpenStoreCats((prev) => ({
                  ...prev,
                  [cat]: !(prev[cat] ?? true),
                }))
              }
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 12px",
                background: "rgba(17, 24, 39, 0.02)",
                border: "none",
                cursor: "pointer",
                fontWeight: 900,
                textAlign: "left",
              }}
            >
              <span style={{ color: "#111827" }}>
                {cat}{" "}
                <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
                  ({onCount}/{sorted.length} ON)
                </span>
              </span>

              <span style={{ color: "#6b7280", fontWeight: 900 }}>
                {isOpen ? "▾" : "▸"}
              </span>
            </button>

            {/* 카테고리 바디 */}
            {isOpen && (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {sorted.map((p) => {
                  const enabled = isEnabledInStore(manageStoreId, p.id);

                  return (
                    <li
                      key={p.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 12px",
                        borderTop: "1px solid rgba(0,0,0,0.06)",
                        opacity: enabled ? 1 : 0.45,
                      }}
                    >
                      <div>
                        <strong>{p.name}</strong>
                        <div style={{ fontSize: 12, color: "#666" }}>
                          {enabled ? "ON (취급)" : "OFF (미취급)"}
                        </div>
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
            )}
          </div>
        );
      })}
    </div>
  );
})()}

      </div>
    </div>
  )}
</section>

  
        {/* ✅ 하단: 제품 목록 / 입점처 목록 */}
        <section
          className="masterTwoCol"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
            gap: 16,
            alignItems: "start",
          }}
        >
          {/* ============================
              ✅ 제품 목록 (카테고리 + 페이지네이션)
             ============================ */}
          <div className="masterCard" style={{ minWidth: 0 }}>
            <h3 style={{ marginTop: 0 }}>제품 목록</h3>
  
            {/* ✅ 카테고리 필터 */}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 12, color: "#6b7280" }}>카테고리:</span>
  
              <select
                value={productListCategory}
                onChange={(e) => setProductListCategory(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.12)",
                }}
              >
                <option value="all">전체</option>
                <option value="uncategorized">미분류</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
  
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {filteredProducts.length === 0
                  ? "0개"
                  : `${Math.min((productListPage - 1) * ITEMS_PER_PAGE + 1, filteredProducts.length)}-${Math.min(
                      productListPage * ITEMS_PER_PAGE,
                      filteredProducts.length
                    )} / ${filteredProducts.length}개`}
              </span>
            </div>
  
            {filteredProducts.length === 0 ? (
  <p style={{ color: "#666" }}>선택한 카테고리에 제품이 없어.</p>
) : (
  <>
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {pagedProducts.map((p) => (
        <li
          key={p.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 0",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            opacity: p.active ? (p.makeEnabled === false ? 0.6 : 1) : 0.4,
          }}
        >
          {/* ✅ 왼쪽: 제품 정보 */}
<div className="productLeft">
  <div className="productNameCol">
    {editingProductId === p.id ? (
      <div className="productEditRow">
        <select
          className="productCategorySelect"
          value={editingProductCategory}
          onChange={(e) => setEditingProductCategory(e.target.value)}
        >
          <option value="">미분류</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <input
          className="productNameInput"
          value={editingProductName}
          autoFocus
          onChange={(e) => setEditingProductName(e.target.value)}
          placeholder="제품명"
          onKeyDown={async (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              await saveProductFields(p.id, editingProductName, editingProductCategory);
              setEditingProductId(null);
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditingProductName(editingOriginalRef.current);
              setEditingProductCategory(editingOriginalCategoryRef.current);
              setEditingProductId(null);
            }
          }}
        />

        <button
          type="button"
          className="iconBtn"
          title="저장"
          onClick={async () => {
            await saveProductFields(p.id, editingProductName, editingProductCategory);
            setEditingProductId(null);
          }}
        >
          ✓
        </button>

        <button
          type="button"
          className="iconBtn"
          title="취소"
          onClick={() => {
            setEditingProductName(editingOriginalRef.current);
            setEditingProductCategory(editingOriginalCategoryRef.current);
            setEditingProductId(null);
          }}
        >
          ✕
        </button>
      </div>
    ) : (
      <div className="productNameRow">
        <strong className="productNameText">
          [{p.category ?? "미분류"}] {p.name}
        </strong>

        <button
          type="button"
          className="iconBtn"
          title="제품명/카테고리 수정"
          onClick={() => {
            setEditingProductId(p.id);
            setEditingProductName(p.name);
            editingOriginalRef.current = p.name;
            setEditingProductCategory(p.category ?? "");
            editingOriginalCategoryRef.current = p.category ?? "";
          }}
        >
          ✎
        </button>
      </div>
    )}
  </div>

  <span style={{ fontSize: 12, color: "#666" }}>
    {p.active ? "활성" : "비활성"}
    {p.makeEnabled === false ? " · 제작중지" : ""}
  </span>
</div>

{/* ✅ 오른쪽: 액션 */}
<div className="productActions">
  <label className="makeEnabledWrap">
    <input
      type="checkbox"
      checked={p.makeEnabled !== false}
      onChange={() => toggleProductMakeEnabled(p.id)}
    />
    제작대상
  </label>

  <div className="actionButtons">
    <button
      type="button"
      className={`iconBtn iconBtnText ${p.active ? "iconBtnMuted" : "iconBtnPrimary"}`}
      onClick={() => toggleProductActive(p.id)}
    >
      {p.active ? "비활성" : "활성"}
    </button>

    <button
      type="button"
      className="iconBtn iconBtnDanger iconBtnSmall"
      onClick={() => deleteProduct(p.id)}
      disabled={loading}
    >
      ✕
    </button>
  </div>
</div>

        </li>
      ))}
    </ul>

    {/* ✅ 페이지네이션 */}
    {totalPages > 1 && (
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        {Array.from({ length: totalPages }).map((_, idx) => {
          const pageNum = idx + 1;
          const active = pageNum === productListPage;

          return (
            <button
              key={pageNum}
              type="button"
              onClick={() => setProductListPage(pageNum)}
              style={{
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.12)",
                background: active ? "#111827" : "#fff",
                color: active ? "#fff" : "#111827",
                fontWeight: 800,
                cursor: "pointer",
                minWidth: 36,
              }}
            >
              {pageNum}
            </button>
          );
        })}
      </div>
    )}
  </>
)}
          </div>  {/* ✅ 제품 목록 카드 닫기 */}

{/* ============================
    ✅ 입점처 목록
   ============================ */}
<div className="masterCard" style={{ minWidth: 0 }}>
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