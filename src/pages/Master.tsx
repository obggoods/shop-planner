import { useEffect, useMemo, useRef, useState } from "react";
import type { AppData, Product, Store, StoreProductState } from "../data/models";
import { downloadJson, generateId, loadData, readJsonFile, saveData } from "../data/store";

const CATEGORIES = ["스크런치", "버튼키링", "거울키링", "케이블홀더", "립밤케이스", "쿠션코스터", "거울인형"] as const;
type Category = (typeof CATEGORIES)[number];

function sortByCreatedAtDesc<T extends { createdAt: number }>(arr: T[]) {
  return [...arr].sort((a, b) => b.createdAt - a.createdAt);
}

export default function Master() {
  const [data, setData] = useState<AppData>(() => loadData());

  const [newProductName, setNewProductName] = useState("");
  const [newStoreName, setNewStoreName] = useState("");
  const [newCategory, setNewCategory] = useState<Category>("스크런치");
  const productCsvRef = useRef<HTMLInputElement | null>(null);
  const [csvMsg, setCsvMsg] = useState<string>("");
  const [manageStoreId, setManageStoreId] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    saveData(data);
  }, [data]);

  const products = useMemo(() => sortByCreatedAtDesc(data.products), [data.products]);
  const stores = useMemo(() => sortByCreatedAtDesc(data.stores), [data.stores]);
  const isEnabledInStore = (storeId: string, productId: string) => {
    const hit = data.storeProductStates.find(
      (x) => x.storeId === storeId && x.productId === productId
    );
    return hit ? hit.enabled : true; // 기본값 true
  };
  
  const toggleStoreProduct = (storeId: string, productId: string) => {
    setData((prev) => {
      const list = prev.storeProductStates ?? [];
      const idx = list.findIndex((x) => x.storeId === storeId && x.productId === productId);
      const nextList = [...list];
  
      if (idx >= 0) {
        nextList[idx] = { ...nextList[idx], enabled: !nextList[idx].enabled };
      } else {
        // 기본은 true인데, 처음 누르는 순간 OFF로 만들 가능성이 높으니 false 저장
        nextList.push({ storeId, productId, enabled: false });
      }
  
      return { ...prev, storeProductStates: nextList, updatedAt: Date.now() };
    });
  };
  
  function addProduct() {
    const name = newProductName.trim();
    if (!name) return;

    const p: Product = {
      id: generateId("p"),
      name,
      category: newCategory, // ✅ 추가
      active: true,
      createdAt: Date.now(),
    };

    setData((prev) => ({ ...prev, products: [p, ...prev.products] }));
    setNewProductName("");
  }

  function toggleProductActive(id: string) {
    setData((prev) => ({
      ...prev,
      products: prev.products.map((p) => (p.id === id ? { ...p, active: !p.active } : p)),
    }));
  }

  function deleteProduct(id: string) {
    if (!confirm("이 제품을 삭제할까요?")) return;
    setData((prev) => ({
      ...prev,
      products: prev.products.filter((p) => p.id !== id),
      inventory: prev.inventory.filter((it) => it.productId !== id),
      settlements: prev.settlements.map((s) => ({
        ...s,
        items: s.items.filter((it) => it.productId !== id),
      })),
      plans: prev.plans.map((pl) => ({
        ...pl,
        items: pl.items.filter((it) => it.productId !== id),
      })),
    }));
  }

  function addStore() {
    const name = newStoreName.trim();
    if (!name) return;

    const s: Store = {
      id: generateId("s"),
      name,
      createdAt: Date.now(),
    };

    setData((prev) => ({ ...prev, stores: [s, ...prev.stores] }));
    setNewStoreName("");
  }

  function deleteStore(id: string) {
    if (!confirm("이 입점처를 삭제할까요? (관련 재고/정산/계획도 함께 삭제됩니다)")) return;
    setData((prev) => ({
      ...prev,
      stores: prev.stores.filter((s) => s.id !== id),
      inventory: prev.inventory.filter((it) => it.storeId !== id),
      settlements: prev.settlements.filter((st) => st.storeId !== id),
      plans: prev.plans.filter((pl) => pl.storeId !== id),
    }));
  }

  function handleBackup() {
    const filename = `shop-planner-backup_${new Date().toISOString().slice(0, 10)}.json`;
    downloadJson(filename, data);
  }
  function parseBool(v: string) {
    const s = (v ?? "").trim().toLowerCase();
    return s === "true" || s === "1" || s === "y" || s === "yes" || s === "활성";
  }
  
  function splitCsvLine(line: string) {
    // 아주 단순 CSV(따옴표 포함도 어느 정도 처리)
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((x) => x.trim());
  }
  
  async function importProductsCsv(file: File) {
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  
    if (lines.length < 2) {
      setCsvMsg("CSV에 데이터가 없어. (헤더 + 최소 1줄 필요)");
      return;
    }
  
    const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
    const idxCategory = header.indexOf("category");
    const idxName = header.indexOf("name");
    const idxActive = header.indexOf("active");
  
    if (idxCategory === -1 || idxName === -1) {
      setCsvMsg('헤더가 필요해: category,name,active (active는 생략 가능)');
      return;
    }
  
    // 중복 방지(카테고리+이름 기준)
    const existingKey = new Set(
      data.products.map((p) => `${p.category}|||${p.name}`.toLowerCase())
    );
  
    let added = 0;
  
    setData((prev) => {
      const next = { ...prev, products: [...prev.products] };
  
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]);
        const category = (cols[idxCategory] ?? "").trim();
        const name = (cols[idxName] ?? "").trim();
        const active = idxActive >= 0 ? parseBool(cols[idxActive] ?? "true") : true;
  
        if (!category || !name) continue;
  
        const key = `${category}|||${name}`.toLowerCase();
        if (existingKey.has(key)) continue;
        existingKey.add(key);
  
        next.products.push({
          id: generateId("p"),
          category,
          name,
          active,
          createdAt: Date.now(),
        });
        added++;
      }
  
      next.updatedAt = Date.now();
      return next;
    });
  
    setCsvMsg(`CSV 업로드 완료: ${added}개 추가됨`);
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
        storeProductStates: parsed.storeProductStates ?? [], // ✅ 추가
        settlements: parsed.settlements ?? [],
        plans: parsed.plans ?? [],
        updatedAt: Date.now(),
      };      
      setData(next);
      alert("복구 완료!");
    } catch {
      alert("복구 실패: JSON 파일을 읽을 수 없습니다.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
<div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #eee" }}>
  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
    <input
      ref={productCsvRef}
      type="file"
      accept=".csv,text/csv"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) importProductsCsv(f);
        e.currentTarget.value = "";
      }}
    />
    <button
      type="button"
      onClick={() => productCsvRef.current?.click()}
      style={{ padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8, background: "white" }}
    >
      CSV로 제품 일괄 등록
    </button>
    <span style={{ fontSize: 12, color: "#666" }}>
      (헤더: category,name,active)
    </span>
  </div>

  {csvMsg && <div style={{ marginTop: 8, fontSize: 13 }}>{csvMsg}</div>}
</div>

          <p style={{ margin: "8px 0 0", color: "#666", fontSize: 13 }}>
            * 제품은 일단 이름만 관리. (옵션/색상은 2차에서 확장)
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
          <p style={{ margin: "8px 0 0", color: "#666", fontSize: 13 }}>
            * 이 백업 파일이 나중에 Supabase로 옮길 때 “원본 데이터”가 됩니다.
          </p>
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
        <button
          type="button"
          onClick={() => {
            // 전체 ON
            setData((prev) => {
              const list = prev.storeProductStates ?? [];
              const map = new Map<string, StoreProductState>();
              for (const x of list) map.set(`${x.storeId}|||${x.productId}`, x);

              for (const p of prev.products) {
                const key = `${manageStoreId}|||${p.id}`;
                map.set(key, { storeId: manageStoreId, productId: p.id, enabled: true });
              }

              return { ...prev, storeProductStates: Array.from(map.values()), updatedAt: Date.now() };
            });
          }}
          style={{ padding: "6px 10px" }}
        >
          전체 ON
        </button>

        <button
          type="button"
          onClick={() => {
            // 전체 OFF
            setData((prev) => {
              const list = prev.storeProductStates ?? [];
              const map = new Map<string, StoreProductState>();
              for (const x of list) map.set(`${x.storeId}|||${x.productId}`, x);

              for (const p of prev.products) {
                const key = `${manageStoreId}|||${p.id}`;
                map.set(key, { storeId: manageStoreId, productId: p.id, enabled: false });
              }

              return { ...prev, storeProductStates: Array.from(map.values()), updatedAt: Date.now() };
            });
          }}
          style={{ padding: "6px 10px" }}
        >
          전체 OFF
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {products
            .filter((p) => p.active) // 전역 비활성 제품은 아예 제외
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
                    onClick={() => toggleStoreProduct(manageStoreId, p.id)}
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


      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>제품 목록</h3>
          {products.length === 0 ? (
            <p style={{ color: "#666" }}>아직 제품이 없어요. 위에서 추가해봐.</p>
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
                    opacity: p.active ? 1 : 0.5,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column" }}>
                  <strong>
                   [{p.category}] {p.name}
                  </strong>

                    <span style={{ fontSize: 12, color: "#666" }}>{p.active ? "활성" : "비활성"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
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
            <p style={{ color: "#666" }}>아직 입점처가 없어요. 위에서 추가해봐.</p>
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
  );
}
