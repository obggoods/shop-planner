import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleUpdatePassword() {
    setLoading(true);

    const { error } = await supabase.auth.updateUser({
      password,
    });

    if (error) {
      alert("변경 실패: " + error.message);
    } else {
      alert("비밀번호가 변경되었습니다!");
      window.location.href = "/";
    }

    setLoading(false);
  }

  return (
    <div style={{ padding: 40 }}>
      <h2>새 비밀번호 설정</h2>
      <input
        type="password"
        placeholder="새 비밀번호"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button onClick={handleUpdatePassword} disabled={loading}>
        변경하기
      </button>
    </div>
  );
}
