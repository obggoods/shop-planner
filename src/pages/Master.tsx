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
} from "../data/store.supabase";

const CATEGORIES = ["스크런치", "버튼키링", "거울키링", "케이블홀더", "립밤케이스", "쿠션코스터", "거울인형"] as const;
type Category = (typeof CATEGORIES)[number];

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
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [newProductName, setNewProductName] = useState("");
  const [newStoreName, setNewStoreName] = useState("");
  const [newCategory, setNewCategory] = useState<Category>("스크런치");

  const [manageStoreId, setManageStoreId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const dbData = await loadDataFromDB();

    // ✅ store×product 조합이 없으면 기본값 true 때문에 UI/DB가 어긋남
    await ensureStoreProductStatesSeedDB({
      storeIds: dbData.stores.map((s) => s.id),
      productIds: dbData.products.map((p) => p.id),
    });

    // seed 반영 후 다시 로드(중요)
    const dbData2 = await loadDataFromDB();
    setData(dbData2);
  }, []);

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
      return hit ? hit.enabled : true; // 기본값 true (seed가 잘 되면 hit가 생김)
    },
    [data.storeProductStates]
  );

  // ✅ 제품 삭제
  const deleteProduct = useCallback(
    async (productId: string) => {
      if (!confirm("이 제품을 삭제할까요?")) return;
      try {
        await deleteProductDB(productId);
        await refresh();
      } catch (e) {
        console.error(e);
        alert("제품 삭제 실패 (로그인 / 권한 / RLS 확인)");
      }
    },
    [refresh]
  );
  
  // ✅ 단일 ON/OFF (UI 즉시 반영 + DB upsert)
  const toggleOne = useCallback(
    async (storeId: string, productId: string, nextEnabled: boolean) => {
      // 1) UI 즉시 반영
      setData((prev) => ({
        ...prev,
        storeProductStates: [
          ...prev.storeProductStates.filter((x) => !(x.storeId === storeId && x.productId === productId)),
          { storeId, productId, enabled: nextEnabled },
        ],
        updatedAt: Date.now(),
      }));

      // 2) DB 반영
      try {
        await setStoreProductEnabledDB({ storeId, productId, enabled: nextEnabled });
      } catch (e) {
        console.error(e);
        alert("저장 실패 (로그인 / 권한 / RLS 확인)");
        // 실패했으면 DB 기준으로 다시 맞추기
        await refresh();
      }
    },
    [refresh]
  );

  // ✅ 전체 ON/OFF (UI 즉시 반영 + DB 병렬 upsert)
  const toggleAll = useCallback(
    async (storeId: string, nextEnabled: boolean) => {
      // 전역 비활성 제품 제외 (UI와 맞추기)
      const activeProductIds = data.products.filter((p) => p.active).map((p) => p.id);
  
      // 1) UI 즉시 반영
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
  
      // 2) DB 반영
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
    [data.products, refresh]
  );


  // ✅ 제품 추가 (DB 저장 후 refresh)
  const addProduct = useCallback(async () => {
    const name = newProductName.trim();
    if (!name) return;

    const p: Product = {
      id: generateId("p"),
      name,
      category: newCategory,
      active: true,
      makeEnabled: true, // ✅ 추가 (기본: 제작 대상)
      createdAt: Date.now(),
    };

    try {
      await createProductDB(p);
      setNewProductName("");
      await refresh();
    } catch (e) {
      console.error(e);
      alert("제품 추가 실패 (로그인 / 권한 / RLS 확인)");
    }
  }, [newProductName, newCategory, refresh]);

  // ✅ 제품 활성/비활성 (즉시 반영 + DB 저장)
const toggleProductActive = useCallback(
  async (productId: string) => {
    const hit = data.products.find((p) => p.id === productId);
    if (!hit) return;

    const next = { ...hit, active: !hit.active };

    // ✅ 1) UI 먼저 즉시 반영(optimistic)
    setData((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === productId ? next : p)),
    }));

    try {
      // ✅ 2) DB 저장
      await createProductDB(next);
      // ❌ refresh() 제거: 지연/튐의 원인
    } catch (e) {
      console.error(e);

      // ✅ 3) 실패 시 롤백
      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === productId ? hit : p)),
      }));

      alert("제품 활성/비활성 변경 실패 (로그인 / 권한 / RLS 확인)");
    }
  },
  [data.products, setData]
);

  // ✅ 제품 제작 대상 ON/OFF (즉시 반영 + DB 저장)
const toggleProductMakeEnabled = useCallback(
  async (productId: string) => {
    const hit = data.products.find((p) => p.id === productId);
    if (!hit) return;

    const next = { ...hit, makeEnabled: !(hit.makeEnabled ?? true) };

    // ✅ 1) UI 먼저 즉시 반영(optimistic)
    setData((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === productId ? next : p)),
    }));

    try {
      // ✅ 2) DB 저장
      await createProductDB(next);
      // ❌ refresh() 제거
    } catch (e) {
      console.error(e);

      // ✅ 3) 실패 시 롤백
      setData((prev) => ({
        ...prev,
        products: prev.products.map((p) => (p.id === productId ? hit : p)),
      }));

      alert("제품 제작 대상 변경 실패 (로그인 / 권한 / RLS 확인)");
    }
  },
  [data.products, setData]
);

  // ✅ 입점처 추가 (DB 저장 후 refresh)
  const addStore = useCallback(async () => {
    const name = newStoreName.trim();
    if (!name) return;

    const s: Store = {
      id: generateId("s"),
      name,
      createdAt: Date.now(),
    };

    try {
      await createStoreDB(s);
      setNewStoreName("");
      await refresh();
    } catch (e) {
      console.error(e);
      alert("입점처 추가 실패 (로그인 / 권한 / RLS 확인)");
    }
  }, [newStoreName, refresh]);

  const deleteStore = useCallback(
    async (storeId: string) => {
      if (!confirm("이 입점처를 삭제할까요? (관련 재고/정산/계획도 함께 삭제됩니다)")) return;
      try {
        await deleteStoreDB(storeId);
        if (manageStoreId === storeId) setManageStoreId("");
        await refresh();
      } catch (e) {
        console.error(e);
        alert("입점처 삭제 실패 (로그인 / 권한 / RLS 확인)");
      }
    },
    [manageStoreId, refresh]
  );

  // ✅ 백업(JSON 다운로드) - DB 데이터 기준으로 export
  const handleBackup = useCallback(async () => {
    try {
      await refresh(); // 최신 DB로 동기화하고
      const filename = `shop-planner-backup_${new Date().toISOString().slice(0, 10)}.json`;
      downloadJson(filename, data);
    } catch (e) {
      console.error(e);
      alert("백업 실패");
    }
  }, [data, refresh]);

  // ✅ 복구(JSON 업로드) - (원하면 나중에 “DB로 업로드”도 붙일 수 있음)
  async function handleRestore(file: File) {
    try {
      const parsed = (await readJsonFile(file)) as Partial<AppData>;
      if (!parsed || parsed.schemaVersion !== 1) {
        alert("백업 파일 형식이 올바르지 않습니다 (schemaVersion 불일치).");
        return;
      }
      // 여기서는 우선 화면에만 반영(=미리보기/검증용). DB 업로드까지 하고 싶으면 말해줘.
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

  if (loading) return <div style={{ padding: 16 }}>로딩 중…</div>;
  if (errorMsg) return <div style={{ padding: 16, color: "crimson" }}>에러: {errorMsg}</div>;

  return (
    <div className="pageWrap">
    <div className="pageContainer">
      <h2 style={{ marginTop: 0 }}>마스터 관리</h2>

      <section className="masterTopGrid">
  <div className="masterCard masterProducts">
    <h3 style={{ marginTop: 0 }}>제품 추가</h3>

    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <select
        value={newCategory}
        onChange={(e) => setNewCategory(e.target.value as Category)}
        style={{ padding: 8, minWidth: 140 }}
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <input
        value={newProductName}
        onChange={(e) => setNewProductName(e.target.value)}
        placeholder="예: 미드나잇블루"
        style={{ flex: 1, padding: 8, minWidth: 200 }}
        onKeyDown={(e) => {
          if (e.key === "Enter") addProduct();
        }}
      />

      <button onClick={addProduct} style={{ padding: "8px 12px" }}>
        추가
      </button>
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

      <button onClick={addStore} style={{ padding: "8px 12px" }}>
        추가
      </button>
    </div>
  </div>
</section>


      <section style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minWidth: 280, flex: 1 }}>
          <h3 style={{ marginTop: 0 }}>백업 / 복구</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
            <select value={manageStoreId} onChange={(e) => setManageStoreId(e.target.value)} style={{ padding: 8, minWidth: 220 }}>
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
                            [{p.category}] {p.name}
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
                    [{p.category}] {p.name}
                  </strong>
                  <span style={{ fontSize: 12, color: "#666" }}>
                    {p.active ? "활성" : "비활성"}
                    {p.makeEnabled === false ? " · 제작중지" : ""}
                  </span>
                </div>
              
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={p.makeEnabled !== false}
                      onChange={() => toggleProductMakeEnabled(p.id)}
                    />
                    제작대상
                  </label>
              
                  <button onClick={() => toggleProductActive(p.id)} style={{ padding: "6px 10px" }}>
                    {p.active ? "비활성" : "활성"}
                  </button>
              
                  <button onClick={() => deleteProduct(p.id)} style={{ padding: "6px 10px" }}>
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
