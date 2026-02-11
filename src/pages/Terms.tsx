// src/pages/Terms.tsx
import { Link } from "react-router-dom";

export default function Terms() {
  const serviceNameKo = "스톡앤메이크";
  const serviceNameEn = "Stock & Make";
  const contactEmail = "support@stocknmake.vercel.app"; // ✅ 나중에 실제 이메일로 교체 추천

  return (
    <div className="pageWrap">
      <div className="pageContainer" style={{ maxWidth: 920 }}>
        <h2 style={{ marginTop: 0 }}>이용약관</h2>

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
            {serviceNameEn} is currently in beta. Payments/subscriptions are not yet active. This Terms page includes
            rules for service use, cancellation/refunds (when paid plans launch), and contact information.
            Contact: {contactEmail}
          </div>
        </div>

        <p style={{ color: "#374151", lineHeight: 1.7 }}>
          본 약관은 {serviceNameKo}({serviceNameEn}) 서비스 이용과 관련하여 서비스 제공자와 이용자 간의 권리·의무 및 책임사항을 규정합니다.
        </p>

        <h3>1. 정의</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>“서비스”란 {serviceNameKo}가 제공하는 재고/제작 관리 기능 및 관련 웹 서비스를 의미합니다.</li>
          <li>“이용자”란 본 약관에 따라 서비스를 이용하는 회원을 의미합니다.</li>
          <li>“콘텐츠/데이터”란 이용자가 서비스에 입력·업로드·생성한 제품/재고/입점처 등 정보를 의미합니다.</li>
        </ul>

        <h3>2. 베타 운영 안내</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>현재 서비스는 베타 테스트 단계로 제공될 수 있으며, 기능이 변경/추가/중단될 수 있습니다.</li>
          <li>베타 기간에는 결제 기능이 비활성화되어 있을 수 있습니다. (유료 플랜은 추후 안내)</li>
        </ul>

        <h3>3. 회원 가입 및 계정</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>서비스 이용을 위해 회원 가입(로그인)이 필요합니다.</li>
          <li>이용자는 계정 정보의 안전한 관리를 위해 비밀번호 등 인증수단을 보호해야 합니다.</li>
        </ul>

        <h3>4. 서비스 제공 및 변경</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>서비스 제공자는 운영상/기술상 필요에 따라 서비스의 전부 또는 일부를 변경할 수 있습니다.</li>
          <li>서비스 개선, 점검, 장애 대응을 위해 일시적으로 서비스가 중단될 수 있습니다.</li>
        </ul>

        <h3>5. 이용자의 의무</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>이용자는 관계 법령 및 본 약관을 준수해야 합니다.</li>
          <li>타인의 정보를 도용하거나, 서비스 운영을 방해하는 행위를 해서는 안 됩니다.</li>
        </ul>

        <h3>6. 데이터 및 백업</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>이용자가 입력한 데이터의 정확성/적법성에 대한 책임은 이용자에게 있습니다.</li>
          <li>서비스 제공자는 안정적인 제공을 위해 노력하나, 이용자는 필요 시 백업 기능 등을 통해 자체 보관을 권장합니다.</li>
        </ul>

        <h3>7. 유료 서비스(예정) / 결제 / 해지 / 환불</h3>
        <p style={{ color: "#374151", lineHeight: 1.7 }}>
          현재 베타 기간에는 유료 결제가 비활성화될 수 있습니다. 유료 플랜이 출시되는 경우, 아래 원칙을 따릅니다.
        </p>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>유료 플랜의 가격/결제 주기/제공 범위는 <Link to="/pricing">가격 안내</Link> 페이지에 공지합니다.</li>
          <li>구독 해지는 서비스 내 안내되는 방법 또는 이메일({contactEmail})을 통해 요청할 수 있습니다.</li>
          <li>환불 정책은 결제 수단/정책(Paddle 등 결제대행사 정책) 및 관련 법령을 준수하며, 상세 기준은 유료 플랜 공개 시 고지합니다.</li>
          <li>디지털 서비스 특성상 이용 개시 후 환불 범위는 제한될 수 있으며, 법령상 소비자 보호 기준을 우선합니다.</li>
        </ul>

        <h3>8. 책임의 제한</h3>
        <ul style={{ color: "#374151", lineHeight: 1.7 }}>
          <li>서비스 제공자는 천재지변, 불가항력, 이용자 귀책 사유로 인한 손해에 대해 책임을 지지 않습니다.</li>
          <li>서비스는 재고/제작 관리 지원 도구이며, 실제 판매/생산/정산 결과에 대한 최종 책임은 이용자에게 있습니다.</li>
        </ul>

        <h3>9. 문의</h3>
        <p style={{ color: "#374151", lineHeight: 1.7 }}>
          이용 관련 문의: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
        </p>

        <div style={{ marginTop: 18, fontSize: 13, color: "#6b7280" }}>
          개인정보 처리에 관한 내용은{" "}
          <Link to="/privacy" style={{ textDecoration: "underline" }}>
            개인정보처리방침
          </Link>
          에서 확인할 수 있습니다.
        </div>
      </div>
    </div>
  );
}
