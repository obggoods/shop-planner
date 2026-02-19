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
  getOrCreateMyProfile,
  updateMyDefaultTargetQty,
  updateMyLowStockThreshold,
} from "../lib/supabaseClient";

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"


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
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold m-0">마스터 관리</h2>
        </div>
  
        {loading && (
          <div className="text-sm text-muted-foreground">
            동기화 중…
          </div>
        )}  

        {/* ✅ 유저별 설정 */}
<div className="ui-card mb-4">
  <div className="ui-card-body">
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <div className="font-semibold">기본 목표 재고 수량</div>
        <input
          className="ui-input w-[90px]"
          type="number"
          min={0}
          step={1}
          value={defaultTargetQtyInput}
          onChange={(e) => setDefaultTargetQtyInput(e.target.value)}
          onBlur={async () => {
            const val =
              defaultTargetQtyInput.trim() === ""
                ? 0
                : Math.max(0, parseInt(defaultTargetQtyInput, 10) || 0)

            setDefaultTargetQtyInput(String(val))

            try {
              setProfileSaving(true)
              await updateMyDefaultTargetQty(val)
            } catch (e) {
              console.error("[profiles] failed to save default_target_qty", e)
            } finally {
              setProfileSaving(false)
            }
          }}
          disabled={profileLoading || profileSaving}
        />
      </div>

      <div className="flex items-center gap-2">
        <div className="font-semibold">최소 재고 수량(≤)</div>
        <input
          className="ui-input w-[70px]"
          type="number"
          min={0}
          step={1}
          value={lowStockThresholdInput}
          onChange={(e) => setLowStockThresholdInput(e.target.value)}
          onBlur={async () => {
            const val =
              lowStockThresholdInput.trim() === ""
                ? 0
                : Math.max(0, parseInt(lowStockThresholdInput, 10) || 0)

            setLowStockThresholdInput(String(val))

            try {
              setProfileSaving(true)
              await updateMyLowStockThreshold(val)
            } catch (e) {
              console.error("[profiles] failed to save low_stock_threshold", e)
            } finally {
              setProfileSaving(false)
            }
          }}
          disabled={profileLoading || profileSaving}
        />
      </div>

      <div className="ui-muted">
        {profileLoading ? "불러오는 중…" : profileSaving ? "저장 중…" : "제작 리스트 계산 기준으로 사용돼요."}
      </div>
    </div>
  </div>
</div>


        {/* ✅ 상단: 제품추가 / 입점처추가 */}
<section className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start">
  {/* ✅ 제품 추가 카드 */}
  <div className="ui-card min-w-0">
    <div className="ui-card-header">
      <h3 className="ui-card-title">제품 추가</h3>

      <div className="ui-card-actions">
        <button type="button" className="ui-btn-outline" onClick={downloadProductCsvTemplate}>
          CSV 템플릿 다운로드
        </button>

        <button
          type="button"
          className="ui-btn-outline"
          onClick={() => csvInputRef.current?.click()}
          disabled={loading || csvBusy}
        >
          CSV로 제품 일괄 추가/업데이트
        </button>

        <input
          ref={csvInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={onChangeProductCsv}
        />
      </div>
    </div>

    <div className="ui-card-body space-y-3">
      {/* 입력 라인 */}
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        {/* ✅ 카테고리 콤보박스 (Popover + Command) */}
        <Popover
          open={categoryOpen}
          onOpenChange={(open) => {
            setCategoryOpen(open)
            if (!open) setCategoryTyped(false)
          }}
        >
          <div className="flex-[1_1_180px] min-w-[160px] max-w-[220px]">
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="w-full justify-between h-10">
                <span className="truncate">
                  {newCategory.trim() ? newCategory : "카테고리 입력/선택"}
                </span>
                <span className="text-muted-foreground">▾</span>
              </Button>
            </PopoverTrigger>

            <PopoverContent align="start" className="p-0 w-[--radix-popover-trigger-width]">
              <Command>
                <CommandInput
                  placeholder="카테고리 검색/입력..."
                  value={newCategory}
                  onValueChange={(v) => {
                    setCategoryTyped(true)
                    setNewCategory(v)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      saveCategoryOnly()
                    }
                  }}
                />
                <CommandList>
                  <CommandEmpty>
                    <div className="px-2 py-2 text-sm text-muted-foreground">
                      검색 결과가 없습니다.
                      {newCategory.trim() ? " Enter로 새 카테고리를 저장할 수 있어요." : ""}
                    </div>
                  </CommandEmpty>

                  <CommandGroup>
                    {categoryOptions
                      .filter((c) => {
                        const q = newCategory.trim()
                        if (!q) return true
                        return c.includes(q)
                      })
                      .map((c) => (
                        <CommandItem
                          key={c}
                          value={c}
                          onSelect={() => {
                            setCategoryTyped(false)
                            setNewCategory(c)
                            setCategoryOpen(false)
                          }}
                          className="flex items-center justify-between"
                        >
                          <span className="truncate">{c}</span>

                          <button
                            type="button"
                            className="ui-icon-btn text-destructive"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              deleteCategory(c)
                            }}
                            title="카테고리 삭제"
                          >
                            ×
                          </button>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>

            {isExistingCategory && categoryTyped && (
              <div className="mt-1 text-xs text-muted-foreground select-none">
                이미 존재하는 카테고리입니다
              </div>
            )}
          </div>
        </Popover>

        {/* ✅ 제품명 */}
        <input
          className="ui-input flex-[2_1_220px] min-w-0"
          value={newProductName}
          onChange={(e) => setNewProductName(e.target.value)}
          placeholder="예: 미드나잇블루"
          onKeyDown={(e) => {
            if (e.key === "Enter") addProduct()
          }}
        />

        {/* ✅ 추가 버튼 */}
        <button className="ui-btn flex-shrink-0 whitespace-nowrap" onClick={addProduct} disabled={loading}>
          추가
        </button>
      </div>
    </div>
  </div>

  {/* ✅ 입점처 추가 카드 */}
  <div className="ui-card min-w-0">
    <div className="ui-card-header">
      <h3 className="ui-card-title">입점처 추가</h3>
      <div className="ui-card-actions" />
    </div>

    <div className="ui-card-body">
      <div className="flex items-center gap-2">
        <input
          className="ui-input flex-1"
          value={newStoreName}
          onChange={(e) => setNewStoreName(e.target.value)}
          placeholder="예: 홍대 A소품샵"
          onKeyDown={(e) => {
            if (e.key === "Enter") addStore()
          }}
        />

        <button className="ui-btn" onClick={addStore} disabled={loading}>
          추가
        </button>
      </div>
    </div>
  </div>
</section>
  
        {/* ✅ 백업/복구 */}
<section className="flex flex-wrap gap-4 mb-4">
  <div className="ui-card min-w-[280px] flex-1">
    <div className="ui-card-body">
      <h3 className="text-base font-semibold m-0">백업 / 복구</h3>
      <div className="h-3" />

      <div className="flex flex-wrap items-start gap-2">
        <button type="button" className="ui-btn-outline" onClick={handleBackup}>
          백업(JSON 다운로드)
        </button>

        <button
          type="button"
          className="ui-btn-outline"
          onClick={() => fileInputRef.current?.click()}
        >
          복구(JSON 가져오기)
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleRestore(f)
          }}
        />
      </div>

      <p className="ui-muted text-sm mt-3 mb-0">
        * 백업은 “현재 DB 데이터 기준”으로 export 하는 용도.
      </p>
    </div>
  </div>
</section>
  
        {/* ✅ 입점처별 취급 제품 설정 */}
<section className="ui-card mb-4">
  <div className="ui-card-body space-y-3">
    <div>
      <h3 className="text-base font-semibold m-0">입점처별 취급 제품 설정</h3>
      <p className="ui-muted mt-1">
        입점처마다 입고하는 제품이 다르면 여기서 ON/OFF로 관리해. (OFF면 대시보드에서 숨김 + 제작 계산 제외)
      </p>
    </div>

    {stores.length === 0 ? (
      <p className="ui-muted">입점처가 없어. 먼저 입점처를 추가해줘.</p>
    ) : products.length === 0 ? (
      <p className="ui-muted">제품이 없어. 먼저 제품을 추가해줘.</p>
    ) : (
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="ui-select min-w-[220px]"
          value={manageStoreId}
          onChange={(e) => setManageStoreId(e.target.value)}
        >
          <option value="">(입점처 선택)</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {!manageStoreId ? (
          <span className="ui-muted text-sm">입점처를 선택하면 제품 ON/OFF 목록이 보여.</span>
        ) : (
          <span className="text-sm font-semibold">
            선택됨: {stores.find((s) => s.id === manageStoreId)?.name}
          </span>
        )}
      </div>
    )}

    {!!manageStoreId && (
      <div className="mt-2 border-t border-border pt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="ui-btn-outline"
            onClick={() => toggleAll(manageStoreId, true)}
          >
            전체 ON
          </button>

          <button
            type="button"
            className="ui-btn-outline"
            onClick={() => toggleAll(manageStoreId, false)}
          >
            전체 OFF
          </button>
        </div>

        {(() => {
          // ✅ 활성 제품만 대상
          const activeProducts = products.filter((p) => p.active)

          // ✅ 카테고리별 그룹핑
          const groups = new Map<string, Product[]>()
          for (const p of activeProducts) {
            const cat = (p.category ?? "미분류").trim() || "미분류"
            const arr = groups.get(cat) ?? []
            arr.push(p)
            groups.set(cat, arr)
          }

          // ✅ 카테고리 정렬 (가나다)
          const cats = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, "ko"))

          return (
            <div className="space-y-3">
              {cats.map((cat) => {
                const list = groups.get(cat) ?? []
                const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"))

                // 기본값 유지(현재 코드와 동일): 펼침 여부는 openStoreCats에 따름
                const isOpen = openStoreCats[cat] ?? false
                const onCount = sorted.reduce(
                  (acc, p) => (isEnabledInStore(manageStoreId, p.id) ? acc + 1 : acc),
                  0
                )

                return (
                  <div key={cat} className="rounded-xl border border-border bg-background overflow-hidden">
                    {/* 카테고리 헤더 */}
                    <button
                      type="button"
                      onClick={() =>
                        setOpenStoreCats((prev) => ({
                          ...prev,
                          [cat]: !(prev[cat] ?? true),
                        }))
                      }
                      className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left bg-muted/30 hover:bg-muted/50"
                    >
                      <span className="text-sm font-semibold">
                        {cat}{" "}
                        <span className="text-xs text-muted-foreground font-medium">
                          ({onCount}/{sorted.length} ON)
                        </span>
                      </span>

                      <span className="text-muted-foreground font-semibold">
                        {isOpen ? "▾" : "▸"}
                      </span>
                    </button>

                    {/* 카테고리 바디 */}
                    {isOpen && (
                      <ul className="list-none m-0 p-0">
                        {sorted.map((p) => {
                          const enabled = isEnabledInStore(manageStoreId, p.id)

                          return (
                            <li
                              key={p.id}
                              className={`flex items-center justify-between gap-3 px-3 py-2 border-t border-border ${
                                enabled ? "" : "opacity-50"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-semibold truncate">{p.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {enabled ? "ON (취급)" : "OFF (미취급)"}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => toggleOne(manageStoreId, p.id, !enabled)}
                                className={enabled ? "ui-btn" : "ui-btn-outline"}
                              >
                                {enabled ? "OFF" : "ON"}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    )}
  </div>
</section>

  
        {/* ✅ 하단: 제품 목록 / 입점처 목록 */}
        <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start">

          <div className="ui-card min-w-0">
  <div className="ui-card-body space-y-3">
    <h3 className="text-base font-semibold m-0">제품 목록</h3>

    {/* ✅ 카테고리 필터 */}
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">카테고리:</span>

      <select
        className="ui-select"
        value={productListCategory}
        onChange={(e) => setProductListCategory(e.target.value)}
      >
        <option value="all">전체</option>
        <option value="uncategorized">미분류</option>
        {categoryOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <span className="text-xs text-muted-foreground">
        {filteredProducts.length === 0
          ? "0개"
          : `${Math.min((productListPage - 1) * ITEMS_PER_PAGE + 1, filteredProducts.length)}-${Math.min(
              productListPage * ITEMS_PER_PAGE,
              filteredProducts.length
            )} / ${filteredProducts.length}개`}
      </span>
    </div>

    {filteredProducts.length === 0 ? (
      <p className="ui-muted">선택한 카테고리에 제품이 없어.</p>
    ) : (
      <>
        <ul className="list-none p-0 m-0 divide-y divide-border">
          {pagedProducts.map((p) => (
            <li
              key={p.id}
              className={`flex items-start justify-between gap-3 py-1.5 ${
                p.active ? (p.makeEnabled === false ? "opacity-70" : "") : "opacity-50"
              }`}
            >
              {/* ✅ 왼쪽: 제품 정보 */}
              <div className="min-w-0 flex-1">
                {editingProductId === p.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="ui-select w-[140px]"
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
                      className="ui-input flex-1 min-w-[200px]"
                      value={editingProductName}
                      autoFocus
                      onChange={(e) => setEditingProductName(e.target.value)}
                      placeholder="제품명"
                      onKeyDown={async (e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          await saveProductFields(p.id, editingProductName, editingProductCategory)
                          setEditingProductId(null)
                        } else if (e.key === "Escape") {
                          e.preventDefault()
                          setEditingProductName(editingOriginalRef.current)
                          setEditingProductCategory(editingOriginalCategoryRef.current)
                          setEditingProductId(null)
                        }
                      }}
                    />

                    <button
                      type="button"
                      className="ui-icon-btn"
                      title="저장"
                      onClick={async () => {
                        await saveProductFields(p.id, editingProductName, editingProductCategory)
                        setEditingProductId(null)
                      }}
                    >
                      ✓
                    </button>

                    <button
                      type="button"
                      className="ui-icon-btn"
                      title="취소"
                      onClick={() => {
                        setEditingProductName(editingOriginalRef.current)
                        setEditingProductCategory(editingOriginalCategoryRef.current)
                        setEditingProductId(null)
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 min-w-0">
                    <strong className="truncate text-sm">
                      [{p.category ?? "미분류"}] {p.name}
                    </strong>

                    <button
                      type="button"
                      className="ui-icon-btn"
                      title="제품명/카테고리 수정"
                      onClick={() => {
                        setEditingProductId(p.id)
                        setEditingProductName(p.name)
                        editingOriginalRef.current = p.name
                        setEditingProductCategory(p.category ?? "")
                        editingOriginalCategoryRef.current = p.category ?? ""
                      }}
                    >
                      ✎
                    </button>
                  </div>
                )}

                <div className="text-xs text-muted-foreground mt-1">
                  {p.active ? "활성" : "비활성"}
                  {p.makeEnabled === false ? " · 제작중지" : ""}
                </div>
              </div>

              {/* ✅ 오른쪽: 액션 */}
              <div className="flex flex-col items-end gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={p.makeEnabled !== false}
                    onChange={() => toggleProductMakeEnabled(p.id)}
                  />
                  제작대상
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className={p.active ? "ui-btn-outline" : "ui-btn"}
                    onClick={() => toggleProductActive(p.id)}
                  >
                    {p.active ? "비활성" : "활성"}
                  </button>

                  <button
                    type="button"
                    className="ui-btn-danger"
                    onClick={() => deleteProduct(p.id)}
                    disabled={loading}
                    title="삭제"
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
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            {Array.from({ length: totalPages }).map((_, idx) => {
              const pageNum = idx + 1
              const active = pageNum === productListPage

              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setProductListPage(pageNum)}
                  className={active ? "ui-btn" : "ui-btn-outline"}
                >
                  {pageNum}
                </button>
              )
            })}
          </div>
        )}
      </>
    )}
  </div>
</div>

{/* ============================
    ✅ 입점처 목록
   ============================ */}
<div className="ui-card min-w-0">
  <div className="ui-card-body space-y-3">
    <h3 className="text-base font-semibold m-0">입점처 목록</h3>

    {stores.length === 0 ? (
      <p className="ui-muted">아직 입점처가 없어. 위에서 추가해봐.</p>
    ) : (
      <ul className="list-none p-0 m-0 divide-y divide-border">
        {stores.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2">
            <strong className="text-sm">{s.name}</strong>

            <button
              type="button"
              className="ui-btn-danger"
              onClick={() => deleteStore(s.id)}
              title="삭제"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    )}
  </div>
</div>
</section>
  </div>
</div>
);
}