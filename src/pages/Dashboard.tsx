import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import type { AppData } from "../data/models";
import { loadData as loadLocalData } from "../data/store";
import { supabase, getOrCreateMyProfile } from "../lib/supabaseClient";

import {
  loadDataFromDB,
  isDBEmpty,
  migrateLocalToDBOnce,
  upsertInventoryItemDB,
  ensureStoreProductStatesSeedDB,
} from "../data/store.supabase";

type DashView = "inventory" | "todo";

const LOW_STOCK_THRESHOLD_DEFAULT = 2;
const RESTOCK_TO_DEFAULT = 5;

// 제작 리스트의 "합계" 탭을 위한 특수 ID
const ALL_TAB_ID = "__ALL__";

const FILE_PREFIX = "ShopPlanner";

const DASH = {
  inventory: "inventory",
  todo: "todo",
} as const;

export default function Dashboard() {
  function safeFilename(name: string) {
    return name.replace(/[\\\/:*?"<>|]/g, "_").trim();
  }

  // ✅ 데이터(초기엔 로컬 표시)
  const [data, setData] = useState<AppData>(() => loadLocalData());

    // ✅ 유저별 기본 목표 재고 수량 (profiles.default_target_qty)
    const [restockTo, setRestockTo] = useState<number>(RESTOCK_TO_DEFAULT);
  
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(LOW_STOCK_THRESHOLD_DEFAULT);

    // ✅ DB 로드 상태
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [showDisabledProducts, setShowDisabledProducts] = useState(false);

  // ✅ 화면 상태
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");
  const [dashView, setDashView] = useState<DashView>(DASH.inventory);

  // -----------------------------
  // 1) DB에서 최신 데이터 로드 함수
  // -----------------------------
  const refreshFromDB = useCallback(async () => {
    // 1) DB 데이터 로드
    const dbData = await loadDataFromDB();
  
    // 2) store × product 조합 seed (없으면 생성)
    await ensureStoreProductStatesSeedDB({
      storeIds: dbData.stores.map((s) => s.id),
      productIds: dbData.products.map((p) => p.id),
    });
  
    // 3) seed 반영된 데이터 다시 로드
    const dbData2 = await loadDataFromDB();
    setData(dbData2);
  
    // 4) 선택 입점처 기본값 설정
    if (dbData2.stores.length > 0) {
      setSelectedStoreId((prev) => prev || dbData2.stores[0].id);
    }
  }, []);
  
  // -----------------------------
  // 2) 최초 진입 시: DB 비었으면 마이그레이션 + 로드
  // -----------------------------
  useEffect(() => {
    let alive = true;
  
    (async () => {
      console.log("[DB] start");
      try {
        setLoading(true);
        setErrorMsg(null);
  
        console.log("[DB] check empty...");
        const empty = await isDBEmpty();
        console.log("[DB] empty =", empty);
  
        if (empty) {
          console.log("[DB] migrate start...");
          await migrateLocalToDBOnce();
          console.log("[DB] migrate done");
        }
  
        console.log("[DB] refreshFromDB start...");
        await refreshFromDB();
        console.log("[DB] refreshFromDB done");
  
        if (!alive) return;
      } catch (e: any) {
        console.error("[DB] error", e);
        if (!alive) return;
        setErrorMsg(e?.message ?? String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
  
    return () => {
      alive = false;
    };
  }, [refreshFromDB]);
  
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const profile = await getOrCreateMyProfile();
        if (!alive) return;
        setRestockTo(profile.default_target_qty ?? RESTOCK_TO_DEFAULT);
        setLowStockThreshold(profile.low_stock_threshold ?? LOW_STOCK_THRESHOLD_DEFAULT);
      } catch (e) {
        console.error("[profiles] failed to load profile in dashboard", e);
        if (!alive) return;
        setRestockTo(RESTOCK_TO_DEFAULT);
      } 
    })();

    return () => {
      alive = false;
    };
  }, []);

  // -----------------------------
  // 3) ✅ Realtime 구독(4개 테이블) → 변경 시 refreshFromDB()
  // -----------------------------
  useEffect(() => {
    let active = true;
    let timer: number | null = null;

    const scheduleRefresh = () => {
      if (!active) return;
      if (timer) window.clearTimeout(timer);

      // 이벤트 폭주 디바운스
      timer = window.setTimeout(() => {
        refreshFromDB().catch((e) => console.error("[RT] refresh error", e));
      }, 250);
    };

    console.log("[RT] subscribe start");

    const channel = supabase
      .channel("shop-planner-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "stores" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "inventory" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "store_product_states" }, scheduleRefresh)
      .subscribe((status) => {
        console.log("[RT] status =", status);
      });

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      supabase.removeChannel(channel);
      console.log("[RT] unsubscribed");
    };
  }, [refreshFromDB]);

  // -----------------------------
// 📥 CSV 다운로드 유틸
// -----------------------------
function downloadCSV(filename: string, rows: string[][]) {
  const csvContent = rows
    .map((r) =>
      r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  const BOM = "\uFEFF"; // ✅ 엑셀 한글 깨짐 방지
  const blob = new Blob([BOM + csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// -----------------------------
// 📥 재고 현황 CSV
// -----------------------------
const exportInventoryCSV = useCallback(() => {
  console.log("[CSV] exportInventoryCSV start", new Date().toISOString());
  const today = new Date().toISOString().slice(0, 10);

  // -----------------------------
  // 1) 전체 재고 현황 CSV
  // -----------------------------
  const allRows: string[][] = [];
  allRows.push(["입점처", "제품", "현재 재고"]);

  // 정렬: 입점처 → 제품
  const allItems: Array<{ storeName: string; productLabel: string; qty: number }> = [];

  data.inventory.forEach((inv) => {
    const store = data.stores.find((s) => s.id === inv.storeId);
    const product = data.products.find((p) => p.id === inv.productId);
    if (!store || !product) return;

    allItems.push({
      storeName: store.name,
      productLabel: `${product.category ?? "-"} - ${product.name}`,
      qty: inv.onHandQty,
    });
  });

  allItems.sort((a, b) => {
    const s = a.storeName.localeCompare(b.storeName, "ko");
    if (s !== 0) return s;
    return a.productLabel.localeCompare(b.productLabel, "ko");
  });

  for (const it of allItems) {
    allRows.push([it.storeName, it.productLabel, String(it.qty)]);
  }

  downloadCSV(`${FILE_PREFIX}_재고현황_전체_${today}.csv`, allRows);

  // -----------------------------
  // 2) 입점처별 CSV 여러 개
  // -----------------------------
  for (const store of data.stores) {
    const storeRows: string[][] = [];
    storeRows.push(["제품", "현재 재고"]);

    const items: Array<{ productLabel: string; qty: number }> = [];

    data.inventory
      .filter((inv) => inv.storeId === store.id)
      .forEach((inv) => {
        const product = data.products.find((p) => p.id === inv.productId);
        if (!product) return;

        items.push({
          productLabel: `${product.category ?? "-"} - ${product.name}`,
          qty: inv.onHandQty,
        });
      });

    // 제품 정렬
    items.sort((a, b) => a.productLabel.localeCompare(b.productLabel, "ko"));

    for (const it of items) {
      storeRows.push([it.productLabel, String(it.qty)]);
    }

    const storeSafe = safeFilename(store.name);
    downloadCSV(`${FILE_PREFIX}_재고현황_${storeSafe}_${today}.csv`, storeRows);
  }
}, [data]);

  // -----------------------------
  // 4) derived 값들
  // -----------------------------
  const stores = useMemo(
    () => [...data.stores].sort((a, b) => b.createdAt - a.createdAt),
    [data.stores]
  );

  // inventory index: storeId::productId -> onHandQty
const invIndex = useMemo(() => {
  const m = new Map<string, number>();
  for (const it of data.inventory) {
    m.set(`${it.storeId}::${it.productId}`, it.onHandQty);
  }
  return m;
}, [data.inventory]);

const getOnHandQty = useCallback(
  (storeId: string, productId: string) => {
    return invIndex.get(`${storeId}::${productId}`) ?? 0;
  },
  [invIndex]
);

  // ✅ 재고 저장 디바운스 타이머
const invSaveTimers = useRef<Record<string, number>>({});

// ✅ 재고 저장 예약(디바운스)
const scheduleInventorySave = useCallback(
  (storeId: string, productId: string, qty: number) => {
    const key = `${storeId}__${productId}`;

    // 기존 예약 취소
    const prev = invSaveTimers.current[key];
    if (prev) window.clearTimeout(prev);

    // 500ms 뒤에 DB 저장 1번만 실행
    invSaveTimers.current[key] = window.setTimeout(async () => {
      try {
        await upsertInventoryItemDB({
          storeId,
          productId,
          onHandQty: qty,
        });
      } catch (e) {
        console.error(e);
        alert("재고 저장 실패 (로그인 / 권한 / RLS 확인)");
      }
    }, 500);
  },
  []
);  

// ✅ 입점처별 제품 활성화 여부
const isEnabledInStore = useCallback(
  (storeId: string, productId: string) => {
    const hit = data.storeProductStates.find(
      (x) => x.storeId === storeId && x.productId === productId
    );
    return hit ? hit.enabled : true; // 기본값 true
  },
  [data.storeProductStates]
);

  const products = useMemo(() => {
    return [...data.products]
      .filter((p) => p.active)
      .sort((a, b) => {
        const c = (a.category ?? "").localeCompare(b.category ?? "");
        if (c !== 0) return c;
        return a.name.localeCompare(b.name);
      });
  }, [data.products]);

  const visibleProductsForSelectedStore = useMemo(() => {
    if (!selectedStoreId) return products;
    if (selectedStoreId === ALL_TAB_ID) return products;
    return products.filter((p) => isEnabledInStore(selectedStoreId, p.id));
  }, [products, selectedStoreId, isEnabledInStore]);


  // ✅ 재고 현황 탭에서: 선택 입점처 기준으로 (ON 제품 먼저, OFF 제품은 접기/펼치기)
const { disabledProducts, productsForInventory } = useMemo(() => {
  // 입점처 선택 전이면 기존 정렬 그대로
  if (!selectedStoreId || selectedStoreId === ALL_TAB_ID) {
    return {
      disabledProducts: [] as typeof products,
      productsForInventory: products,
    };
  }

  const enabled: typeof products = [];
  const disabled: typeof products = [];

  for (const p of products) {
    (isEnabledInStore(selectedStoreId, p.id) ? enabled : disabled).push(p);
  }

  return {
    disabledProducts: disabled,
    productsForInventory: showDisabledProducts ? [...enabled, ...disabled] : enabled,
  };
}, [products, selectedStoreId, isEnabledInStore, showDisabledProducts]);

useEffect(() => {
  setShowDisabledProducts(false);
}, [selectedStoreId]);

  // 선택 입점처 총 재고
  const totalOnHand = useMemo(() => {
    if (!selectedStoreId || selectedStoreId === ALL_TAB_ID) return 0;
    let sum = 0;
    for (const it of data.inventory) {
      if (it.storeId === selectedStoreId) sum += it.onHandQty;
    }
    return sum;
  }, [data.inventory, selectedStoreId]);

  // 선택 입점처 제작 리스트
  const storeTodoRows = useMemo(() => {
    if (!selectedStoreId || selectedStoreId === ALL_TAB_ID) return [];

    return visibleProductsForSelectedStore
      .filter((p) => p.makeEnabled !== false) // 제작 제외
      .map((p) => {
        const onHand = getOnHandQty(selectedStoreId, p.id);
        const need = onHand <= lowStockThreshold ? Math.max(0, restockTo - onHand) : 0;
        return { product: p, onHand, need };
      })
      .filter((row) => row.need > 0);
  }, [selectedStoreId, visibleProductsForSelectedStore, getOnHandQty]);

  // 전체 제작 리스트(합계)
const allTodoRows = useMemo(() => {
  const out: Array<{ product: (typeof products)[number]; totalNeed: number }> = [];

  for (const p of products) {
    if (p.makeEnabled === false) continue; // 제작 제외(단종/제작중지)

    let sumNeed = 0;

    for (const s of stores) {
      if (!isEnabledInStore(s.id, p.id)) continue;
      const onHand = getOnHandQty(s.id, p.id);
      if (onHand <= lowStockThreshold) {
        sumNeed += Math.max(0, restockTo - onHand);
      }
    }

    if (sumNeed > 0) out.push({ product: p, totalNeed: sumNeed });
  }

  return out;
}, [products, stores, isEnabledInStore, getOnHandQty, lowStockThreshold, restockTo]);

/// -----------------------------
// 📥 제작 리스트 CSV (전체=제품별 총합 + 입점처별 파일)
// -----------------------------
const exportProductionCSV = useCallback(() => {
  const today = new Date().toISOString().slice(0, 10);

  // 1) 전체 제작 리스트 (제품별 총합)
  {
    const rows: string[][] = [];
    rows.push(["품목", "제품", "총 필요 수량"]);

    const sortedAllTodo = [...allTodoRows].sort((a, b) => {
      const ac = (a.product.category ?? "").localeCompare(b.product.category ?? "", "ko");
      if (ac !== 0) return ac;
      return a.product.name.localeCompare(b.product.name, "ko");
    });

    for (const row of sortedAllTodo) {
      rows.push([row.product.category ?? "-", row.product.name, String(row.totalNeed)]);
    }

    downloadCSV(`${FILE_PREFIX}_제작리스트_전체_${today}.csv`, rows);
  }

  // 2) 입점처별 제작 리스트 (각 파일)
  for (const store of data.stores) {
    const items: Array<{
      productLabel: string;
      onHand: number;
      need: number;
    }> = [];

    // 이 입점처의 제품들 중 제작 필요만 모으기
    for (const p of products) {
      // 입점처 취급 OFF 제외 + 제작 제외 제외
      if (!isEnabledInStore(store.id, p.id)) continue;
      if (p.makeEnabled === false) continue;

      const onHand = getOnHandQty(store.id, p.id);
      const need = onHand <= lowStockThreshold ? Math.max(0, restockTo - onHand) : 0;
      if (need <= 0) continue;

      items.push({
        productLabel: `${p.category ?? "-"} - ${p.name}`,
        onHand,
        need,
      });
    }

    if (items.length === 0) continue;

    items.sort((a, b) => a.productLabel.localeCompare(b.productLabel, "ko"));

    const storeRows: string[][] = [];
    storeRows.push(["제품", "현재 재고", "목표 재고", "필요 수량"]);

    for (const it of items) {
      storeRows.push([it.productLabel, String(it.onHand), String(restockTo), String(it.need)]);
    }

    const storeSafe = safeFilename(store.name);
    downloadCSV(`${FILE_PREFIX}_제작리스트_${storeSafe}_${today}.csv`, storeRows);
  }
}, [
  data.stores,
  products,
  allTodoRows,
  getOnHandQty,
  isEnabledInStore,
  lowStockThreshold,
  restockTo,
]);

  // -----------------------------
  // 5) 화면 렌더
  // -----------------------------
  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Shop Planner</div>
        DB에서 데이터를 불러오는 중...
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Shop Planner</div>
        <h2 style={{ marginTop: 0 }}>DB 로드 실패</h2>
        <div style={{ padding: 12, background: "#f3f4f6", borderRadius: 8 }}>{errorMsg}</div>
        <button
          style={{ marginTop: 12 }}
          onClick={() => {
            setErrorMsg(null);
            setLoading(true);
            refreshFromDB()
              .catch((e) => setErrorMsg(e?.message ?? String(e)))
              .finally(() => setLoading(false));
          }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  // ✅ 대시보드 페이지
  return (
    <div className="pageWrap">
    <div className="pageContainer">
      <h2 className="pageTitle">대시보드</h2>

      <div className="summaryRow">
        <Card title="입점처" value={`${stores.length}`} />
        <Card title="활성 제품" value={`${products.length}`} />
        <Card title="선택 입점처 총 재고" value={`${totalOnHand}`} />
        </div>

      {/* 화면 전환 버튼 */}
      <div className="viewSwitch">
        <button
          type="button"
          className={`viewBtn ${dashView === DASH.inventory ? "viewBtnActive" : ""}`}
          onClick={() => setDashView(DASH.inventory)}
        >
          재고 현황
        </button>

        <button
          type="button"
          className={`viewBtn ${dashView === DASH.todo ? "viewBtnActive" : ""}`}
          onClick={() => setDashView(DASH.todo)}
        >
          제작 리스트
        </button>
      </div>

      {/* 📥 데이터 다운로드 ← 여기 */}
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "8px 0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, color: "#666" }}>데이터 다운로드</span>

       <button onClick={exportInventoryCSV} className="viewBtn">
      재고 현황
       </button>

       <button onClick={exportProductionCSV} className="viewBtn">
      제작 리스트
       </button>
       </div>
     </div>

      {/* 1) 재고 현황 */}
      {dashView === DASH.inventory && (
        <section className="panel">
          <h3 className="sectionTitle">입점처별 재고 현황</h3>
          <p className="sectionDesc">엑셀 시트처럼 입점처 탭을 눌러 재고를 확인/수정할 수 있어.</p>

          {stores.length === 0 ? (
            <p className="emptyState">입점처가 없어. 마스터에서 입점처를 추가해줘.</p>
          ) : products.length === 0 ? (
            <p className="emptyState">활성 제품이 없어. 마스터에서 제품을 추가/활성해줘.</p>
          ) : (
            <>
              <StoreTabs
                stores={stores}
                selectedStoreId={selectedStoreId}
                onSelect={setSelectedStoreId}
                showAllTab={false}
              />

              {!selectedStoreId || selectedStoreId === ALL_TAB_ID ? (
                <p className="emptyState" style={{ marginTop: 12 }}>
                  위 탭에서 입점처를 선택해줘.
                </p>
              ) : (
                <>
                {disabledProducts.length > 0 && (
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                    <button
                      type="button"
                      className="viewBtn"
                      onClick={() => setShowDisabledProducts((v) => !v)}
                    >
                      {showDisabledProducts ? "OFF 제품 접기" : `OFF 제품 ${disabledProducts.length}개 펼치기`}
                    </button>
                  </div>
                )}

                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>품목</th>
                        <th>제품</th>
                        <th className="numCol">현재 재고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productsForInventory.map((p) => {
                        const enabled = isEnabledInStore(selectedStoreId, p.id);
                        const onHand = getOnHandQty(selectedStoreId, p.id);

                        return (
                          <tr key={p.id} className={!enabled ? "rowDisabled" : undefined}>
                            <td>{p.category ?? "-"}</td>
                            <td>{p.name}</td>
                            <td className="numCol">
                            <input
  className="qtyInput"
  type="number"
  inputMode="numeric"
  value={onHand === 0 ? "" : onHand}
  placeholder="0"
  onWheel={(e) => (e.currentTarget as HTMLInputElement).blur()}
  onChange={(e) => {
    const raw = e.target.value;          // 빈칸이면 ""
    const nextQty = raw === "" ? 0 : Number(raw);

    // 1) UI 즉시 반영
    setData((prev) => {
      const storeId = selectedStoreId;
      const productId = p.id;

      const idx = prev.inventory.findIndex(
        (it) => it.storeId === storeId && it.productId === productId
      );

      if (idx === -1) {
        return {
          ...prev,
          inventory: [
            ...prev.inventory,
            { storeId, productId, onHandQty: nextQty, updatedAt: Date.now() },
          ],
        };
      }

      const nextInv = [...prev.inventory];
      nextInv[idx] = { ...nextInv[idx], onHandQty: nextQty, updatedAt: Date.now() };
      return { ...prev, inventory: nextInv };
    });

    // 2) DB 저장 디바운스
    scheduleInventorySave(selectedStoreId, p.id, nextQty);
  }}
/>

                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </>
          )}
        </section>
      )}

      {/* 2) 제작 리스트 */}
      {dashView === DASH.todo && (
        <section className="panel">
          <h3 className="sectionTitle">제작 리스트</h3>
          <p className="sectionDesc">
            <b>합계</b> 탭은 전체 입점처 부족분 합산, 입점처 탭은 해당 입점처 기준으로 보여줘. (재고 2개 이하만,
            목표 5개까지 채우기)
          </p>

          {stores.length === 0 ? (
            <p className="emptyState">입점처가 없어. 마스터에서 입점처를 추가해줘.</p>
          ) : (
            <>
              <StoreTabs
                stores={stores}
                selectedStoreId={selectedStoreId}
                onSelect={setSelectedStoreId}
                showAllTab={true}
              />

              {selectedStoreId === ALL_TAB_ID ? (
                allTodoRows.length === 0 ? (
                  <p className="emptyState" style={{ marginTop: 12 }}>
                    전체 기준 제작 필요 없음
                  </p>
                ) : (
                  <div className="tableWrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: 140 }}>품목</th>
                          <th>제품</th>
                          <th className="numCol">총 만들기</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allTodoRows.map((row) => (
                          <tr key={row.product.id}>
                            <td>{row.product.category ?? "-"}</td>
                            <td>{row.product.name}</td>
                            <td className="numCol" style={{ fontWeight: 800 }}>
                              {row.totalNeed}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : !selectedStoreId ? (
                <p className="emptyState" style={{ marginTop: 12 }}>
                  위 탭에서 입점처를 선택해줘.
                </p>
              ) : storeTodoRows.length === 0 ? (
                <p className="emptyState" style={{ marginTop: 12 }}>
                  제작 필요 없음 (재고 2개 이하 제품이 없어)
                </p>
              ) : (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 140 }}>품목</th>
                        <th>제품</th>
                        <th className="numCol">현재 재고</th>
                        <th className="numCol">만들기</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storeTodoRows.map((row) => (
                        <tr key={row.product.id}>
                          <td>{row.product.category ?? "-"}</td>
                          <td>{row.product.name}</td>
                          <td className="numCol">{row.onHand}</td>
                          <td className="numCol" style={{ fontWeight: 800 }}>
                            {row.need}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
   </div>
  </div>
 );
}

// -----------------------------
// UI 컴포넌트들
// -----------------------------


function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="summaryCard">
      <div className="summaryCardTitle">{title}</div>
      <div className="summaryCardValue">{value}</div>
    </div>
  );
}

function StoreTabs({
  stores,
  selectedStoreId,
  onSelect,
  showAllTab,
}: {
  stores: Array<{ id: string; name: string }>;
  selectedStoreId: string;
  onSelect: (id: string) => void;
  showAllTab: boolean;
}) {
  return (
    <div className="sheetTabsWrap">
      <div className="sheetTabs">
        {showAllTab && (
          <button
            type="button"
            onClick={() => onSelect(ALL_TAB_ID)}
            className={`sheetTab ${selectedStoreId === ALL_TAB_ID ? "sheetTabActive" : ""}`}
          >
            합계
          </button>
        )}

        {stores.map((s) => {
          const active = selectedStoreId === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`sheetTab ${active ? "sheetTabActive" : ""}`}
              type="button"
            >
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
  