// src/features/settlements/lib/parseSettlementCsv.ts

export type ColumnMapping = {
    productName: string // CSV 헤더 중 "상품명"에 해당하는 컬럼명
    qty: string // CSV 헤더 중 "판매수량"에 해당하는 컬럼명
    sku?: string // 선택
    unitPrice?: string // 선택
    amount?: string // 선택(매출액/정산금 등)
  }
  
  export type ParsedRow = {
    productName: string
    sku?: string
    qty: number
    unitPrice?: number
    amount?: number
    raw?: Record<string, string>
  }
  
  function toNumberLoose(v: unknown): number | null {
    if (v == null) return null
    const s = String(v).trim()
    if (!s) return null
    // 1) 쉼표 제거 2) 원화 기호 제거(있을 수 있음)
    const cleaned = s.replace(/,/g, "").replace(/₩/g, "")
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : null
  }
  
  function splitLineQuoteSafe(line: string, delimiter: string): string[] {
    const out: string[] = []
    let cur = ""
    let inQuotes = false
  
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
  
      if (ch === '"') {
        // "" -> " 처리
        const next = line[i + 1]
        if (inQuotes && next === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
        continue
      }
  
      if (!inQuotes && ch === delimiter) {
        out.push(cur.trim())
        cur = ""
        continue
      }
  
      cur += ch
    }
  
    out.push(cur.trim())
  
    // 양끝 따옴표 제거(남아있다면)
    return out.map((v) => v.replace(/^"|"$/g, "").trim())
  }
  
  function detectDelimiter(lines: string[]): string {
    const candidates = [",", ";", "\t", "|"] as const
  
    // 첫 5줄 정도로 “열 개수 최대 + 일관성” 기준으로 선택
    const sample = lines.slice(0, Math.min(5, lines.length))
  
    let best = ","
    let bestScore = -Infinity
  
    for (const d of candidates) {
      const counts = sample.map((l) => splitLineQuoteSafe(l, d).length)
      const maxCols = Math.max(...counts)
      const minCols = Math.min(...counts)
      const variance = maxCols - minCols // 0에 가까울수록 일관적
  
      // 점수: 열 많을수록 좋고, 일관성 있을수록 좋음
      const score = maxCols * 10 - variance
  
      if (score > bestScore) {
        bestScore = score
        best = d
      }
    }
  
    return best
  }
  
  export function parseCsvTextBasic(csvText: string): { headers: string[]; rows: string[][] } {
    const lines = csvText
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      // trim은 헤더 내부 공백까지 날릴 수 있어서 양끝만 정리
      .map((l) => l.replace(/^\uFEFF/, "").trimEnd()) // BOM 제거 + 오른쪽 공백 제거
      .filter((l) => l.trim().length > 0)
  
    if (lines.length === 0) return { headers: [], rows: [] }
  
    const delimiter = detectDelimiter(lines)
  
    const headers = splitLineQuoteSafe(lines[0], delimiter).map((h) => h.trim())
    const rows = lines.slice(1).map((l) => splitLineQuoteSafe(l, delimiter))
  
    return { headers, rows }
  }
  
  /**
   * CSV 원본 텍스트 + 컬럼 매핑 -> ParsedRow[]
   */
  export function parseSettlementCsv(input: {
    csvText: string
    mapping: ColumnMapping
  }): ParsedRow[] {
    const { headers, rows } = parseCsvTextBasic(input.csvText)
    if (headers.length === 0) return []
  
    const headerIndex = new Map<string, number>()
    headers.forEach((h, i) => headerIndex.set(h, i))
  
    // 필수 매핑 검증
    if (!headerIndex.has(input.mapping.productName)) {
      throw new Error(`CSV에 '${input.mapping.productName}' 컬럼이 없습니다.`)
    }
    if (!headerIndex.has(input.mapping.qty)) {
      throw new Error(`CSV에 '${input.mapping.qty}' 컬럼이 없습니다.`)
    }
  
    const idxName = headerIndex.get(input.mapping.productName)!
    const idxQty = headerIndex.get(input.mapping.qty)!
  
    const idxSku = input.mapping.sku ? headerIndex.get(input.mapping.sku) ?? null : null
    const idxUnit = input.mapping.unitPrice ? headerIndex.get(input.mapping.unitPrice) ?? null : null
    const idxAmount = input.mapping.amount ? headerIndex.get(input.mapping.amount) ?? null : null
  
    const parsed: ParsedRow[] = []
  
    for (const row of rows) {
      const productName = (row[idxName] ?? "").trim()
      if (!productName) continue
  
      const qty = toNumberLoose(row[idxQty]) ?? 0
  
      const sku = idxSku != null ? (row[idxSku] ?? "").trim() : ""
      const unitPrice = idxUnit != null ? toNumberLoose(row[idxUnit]) : null
      const amount = idxAmount != null ? toNumberLoose(row[idxAmount]) : null
  
      // 원본 row를 key-value로 보관(디버그/미리보기용)
      const raw: Record<string, string> = {}
      headers.forEach((h, i) => {
        raw[h] = row[i] ?? ""
      })
  
      parsed.push({
        productName,
        sku: sku || undefined,
        qty: Math.max(0, Math.floor(qty)),
        unitPrice: unitPrice ?? undefined,
        amount: amount ?? undefined,
        raw,
      })
    }
  
    return parsed
  }
  