// src/pages/Privacy.tsx
import { Link } from "react-router-dom";

export default function Privacy() {
  const serviceNameKo = "스톡앤메이크";
  const serviceNameEn = "Stock & Make";
  const contactEmail = "support@stocknmake.vercel.app"; // ✅ 나중에 실제 이메일로 교체 추천

  return (
    <div className="pageWrap">
      <div className="pageContainer" style={{ maxWidth: 920 }}>
        <h2 style={{ marginTop: 0 }}>개인정보처리방침</h2>

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
            {serviceNameEn} collects minimal personal data (e.g., account email) to provide login-based service.
            Service data is stored in Supabase. Users can request access/deletion via {contactEmail}.
          </div>
        </div>

        <p style={{ color: "#374151", lineHeight: 1.7 }}>
          {serviceNameKo}({serviceNameEn})는 개인정보 보호법 등 관련 법령을 준수하며, 이용자의 개인정보를 안전하게 처리합니다.
        </p>

        <h3>1. 수집하는 개인정보 항목</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>회원 가입/로그인: 이메일(계정 식별), 인증 정보(로그인 처리에 필요한 범위)</li>
          <li>서비스 이용 과정에서 생성되는 정보: 접속 로그, 이용 기록(서비스 안정성 및 개선 목적)</li>
        </ul>

        <h3>2. 개인정보 수집 및 이용 목적</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>회원 식별 및 로그인 기반 서비스 제공</li>
          <li>서비스 운영/개선, 오류 대응, 보안/부정 이용 방지</li>
          <li>문의 대응 및 공지 전달(필요 시)</li>
        </ul>

        <h3>3. 개인정보의 보관 및 이용기간</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>원칙적으로 회원 탈퇴 시 지체 없이 파기합니다.</li>
          <li>단, 관련 법령에 따라 보관이 필요한 경우 해당 기간 동안 보관할 수 있습니다.</li>
        </ul>

        <h3>4. 개인정보의 처리 위탁 및 제3자 제공</h3>
        <p style={{ color: "#374151", lineHeight: 1.7 }}>
          서비스 제공을 위해 다음과 같은 외부 서비스를 사용할 수 있습니다.
        </p>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>
            인증/데이터 저장: Supabase (로그인 및 데이터 저장/조회 목적)
          </li>
          <li>
            (예정) 결제 처리: Paddle (유료 플랜 도입 시 결제 및 구독 관리 목적)
          </li>
        </ul>
        <p style={{ color: "#6b7280", fontSize: 13, lineHeight: 1.6 }}>
          * 결제 기능이 활성화되는 경우, 결제 처리에 필요한 정보는 결제대행사 정책에 따라 처리될 수 있으며, 사전에 안내합니다.
        </p>

        <h3>5. 이용자의 권리</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>이용자는 개인정보 열람, 정정, 삭제, 처리정지 요청을 할 수 있습니다.</li>
          <li>
            요청은 이메일(
            <a href={`mailto:${contactEmail}`}>{contactEmail}</a>)로 접수할 수 있습니다.
          </li>
        </ul>

        <h3>6. 개인정보의 안전성 확보 조치</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>접근 통제 및 권한 관리(RLS 등)</li>
          <li>전송 구간 암호화(HTTPS)</li>
          <li>보안 업데이트 및 취약점 대응 노력</li>
        </ul>

        <h3>7. 문의</h3>
        <p style={{ color: "#374151", lineHeight: 1.7 }}>
          개인정보 관련 문의: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>

        <div style={{ marginTop: 18, fontSize: 13, color: "#6b7280" }}>
          자세한 서비스 이용 규정은{" "}
          <Link to="/terms" style={{ textDecoration: "underline" }}>
            이용약관
          </Link>
          에서 확인할 수 있습니다.
        </div>
      </div>
    </div>
  );
}
