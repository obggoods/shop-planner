// src/pages/Pricing.tsx
import { Link } from "react-router-dom";

export default function Pricing() {
  return (
    <div className="pageWrap">
      <div className="pageContainer" style={{ maxWidth: 920 }}>
        <h2 style={{ marginTop: 0 }}>가격 안내</h2>

        {/* 영어 요약(심사용) */}
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 12,
            padding: 12,
            background: "rgba(17,24,39,0.02)",
            marginBottom: 16,
          }}
        >
          <div style={{ fontWeight: 800 }}>English summary (for verification)</div>
          <div style={{ fontSize: 13, color: "#374151", marginTop: 6, lineHeight: 1.5 }}>
            Stock & Make (스톡앤메이크) is currently in beta. Subscription billing will be enabled after beta.
            This page will be updated with final pricing before payments are activated.
          </div>
        </div>

        <p style={{ color: "#374151", lineHeight: 1.7 }}>
          스톡앤메이크는 <strong>오프라인 입점처 재고</strong>와 <strong>부족분 제작</strong>을 한 번에 관리할 수 있도록 돕는 툴입니다.
          <br />
          현재는 <strong>베타 테스트 기간</strong>으로, 결제 기능은 비활성화되어 있습니다.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 16 }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "#fff" }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Beta (현재)</div>
            <div style={{ marginTop: 6, color: "#6b7280" }}>무료</div>
            <ul style={{ marginTop: 10, color: "#374151", lineHeight: 1.7 }}>
              <li>제품/입점처/재고 관리</li>
              <li>입점처별 취급 제품 ON/OFF</li>
              <li>제작 대상/비활성 제품 관리</li>
              <li>백업(JSON) 다운로드</li>
            </ul>
            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              * 베타 종료 후 정식 요금제가 적용될 수 있습니다.
            </div>
          </div>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "#fff", opacity: 0.9 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Pro (예정)</div>
            <div style={{ marginTop: 6, color: "#6b7280" }}>가격 공개 예정</div>
            <ul style={{ marginTop: 10, color: "#374151", lineHeight: 1.7 }}>
              <li>제작 리스트 고도화</li>
              <li>변경 이력/감사 로그</li>
              <li>데이터 내보내기/가져오기 확장</li>
              <li>팀/권한(선택)</li>
            </ul>
            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              * 베타 종료 전에 안내 페이지를 업데이트합니다.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 18, fontSize: 13, color: "#6b7280" }}>
          결제 및 구독 관련 정책은{" "}
          <Link to="/terms" style={{ textDecoration: "underline" }}>
            이용약관
          </Link>{" "}
          에서 확인할 수 있습니다.
        </div>
      </div>
    </div>
  );
}
