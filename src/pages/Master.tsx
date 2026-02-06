import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Product, Store, StoreProductState } from "../data/models";
import { downloadJson, generateId, readJsonFile } from "../data/store";
import { loadDataFromDB } from "../data/store.supabase";
import { setStoreProductEnabledDB } from "../data/store.supabase";

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

  const productCsvRef = useRef<HTMLInputElement | null>(null);
  const [csvMsg, setCsvMsg] = useState<string>("");
  const [manageStoreId, setManageStoreId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ Master도 DB에서 로드
  const refresh = async () => {
    const db = await loadDataFromDB();
    setData(db);
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErrorMsg(null);
        const db = await loadDataFromDB();
        if (!alive) return;
        setData(db);
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
  }, []);

  const products = useMemo(() => sortByCreatedAtDesc(data.products), [data.products]);
  const stores = useMemo(() => sortByCreatedAtDesc(data.stores), [data.stores]);

  const isEnabledInStore = (storeId: string, productId: string) => {
    const hit = (data.storeProductStates ?? []).find(
      (x) => x.storeId === storeId && x.productId === productId
    );
    return hit ? hit.enabled : true; // 기본값 true
  };

  // ✅ 개별 토글 (UI 즉시 반영 + DB 반영)
  const toggleOne = async (storeId: string, productId: string, nextEnabled: boolean) => {
    // 1) UI 즉시 반영
    setData((prev) => ({
      ...prev,
      storeProductStates: [
        ...(prev.storeProductStates ?? []).filter(
          (x) => !(x.storeId === storeId && x.productId === productId)
        ),
        { storeId, productId, enabled: nextEnabled },
      ],
      updatedAt: Date.now(),
    }));

    // 2) DB 반영
    try {
      await setStoreProductEnabledDB({ storeId, productId, enabled: nextEnabled });
      // (선택) DB 기준으로 다시 동기화하고 싶으면 아래 주석 해제
      // await refresh();
    } catch (e: any) {
      console.error("[MASTER] toggleOne failed", e);
      alert("저장 실패: 콘솔(Network)에서 401/403 확인해줘 (로그인/RLS 문제일 가능성 큼)");
    }
  };

  // ✅ 전체 ON/OFF (UI 즉시 반영 + DB 반영)
  const toggleAll = async (storeId: string, nextEnabled: boolean) => {
    const activeProductIds = (data.products ?? []).filter((p) => p.active).map((p) => p.id);

    // 1) UI 즉시 반영
    setData((prev) => {
      const list = prev.storeProductStates ?? [];
      const map = new Map<string, StoreProductState>();
      for (const x of list) map.set(`${x.storeId}|||${x.productId}`, x);

      for (const productId of activeProductIds) {
        map.set(`${storeId}|||${productId}`, { storeId, productId, enabled: nextEnabled });
      }

      return { ...prev, storeProductStates: Array.from(map.values()), updatedAt: Date.now() };
    });

    // 2) DB 반영 (병렬)
    try {
      await Promise.all(
        activeProductIds.map((productId) =>
          setStoreProductEnabledDB({ storeId, productId, enabled: nextEnabled })
        )
      );
      // (선택) await refresh();
    } catch (e: any) {
      console.error("[MASTER] toggleAll failed", e);
      alert("전체 ON/OFF 저장 실패: 콘솔(Network)에서 401/403 확인해줘 (로그인/RLS 문제일 가능성 큼)");
    }
  };

  // ---- 아래 addProduct/addStore는 네 프로젝트에서 DB upsert 함수가 따로 있어야 완전하게 DB와 동기화됨 ----
  // 지금 이 파일은 "취급 ON/OFF" 문제 해결에 초점을 맞춘 버전이야.
  // 제품/입점처 추가도 DB로 저장하려면 products/stores upsert 함수도 붙여야 함.

  function addProduct() {
    const name = newProductName.trim();
    if (!name) return;

    const p: Product = {
      id: generateId("p"),
      name,
      category: newCategory,
      active: true,
      createdAt: Date.now(),
    };

    setData((prev) => ({ ...prev, products: [p, ...prev.products], updatedAt: Date.now() }));
    setNewProductName("");
  }

  function addStore() {
    const name = newStoreName.trim();
    if (!name) return;

    const s: Store = {
      id: generateId("s"),
      name,
      createdAt: Date.now(),
    };

    setData((prev) => ({ ...prev, stores: [s, ...prev.stores], updatedAt: Date.now() }));
    setNewStoreName("");
  }

  function handleBackup() {
    const filename = `shop-planner-backup_${new Date().toISOString().slice(0, 10)}.json`;
    downloadJson(filename, data);
  }

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
      alert("복구 완료! (※ DB로 반영하려면 별도 업로드/마이그레이션 로직 필요)");
    } catch {
      alert("복구 실패: JSON 파일을 읽을 수 없습니다.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // --- UI ---
  if (loading) {
    return <div style={{ padding: 16 }}>마스터 로딩 중…</div>;
  }
  if (errorMsg) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>마스터 로드 실패</div>
        <div style={{ padding: 12, background: "#f3f4f6", borderRadius: 8 }}>{errorMsg}</div>
        <button style={{ marginTop: 12 }} onClick={() => location.reload()}>
          새로고침
        </button>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>마스터 관리</h2>

      <section style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minWidth: 280, flex: 1 }}>
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
            * (주의) 지금 파일은 제품/입점처 추가를 DB에 저장하진 않음. ON/OFF 동기화 문제부터 잡는 버전.
          </p>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minWidth: 280, flex: 1 }}>
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
        </div>
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>입점처별 취급 제품 설정</h3>
        <p style={{ marginTop: 0, color: "#666", fontSize: 13 }}>
          OFF면 대시보드에서 숨김 + 제작 계산 제외
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
    </div>
  );
}
