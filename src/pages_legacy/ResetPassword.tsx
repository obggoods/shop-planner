import "./auth.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

export default function ResetPassword() {
  const nav = useNavigate();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const onUpdate = async () => {
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMessage("Failed: " + error.message);
    } else {
      setMessage("Password updated successfully!");
      setTimeout(() => nav("/login"), 800);
    }

    setLoading(false);
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-header">
          <h2>새 비밀번호 설정</h2>
          <p>보안을 위해 8자 이상으로 설정해 주세요.</p>
        </div>

        <div className="auth-form">
          <div className="form-field">
            <label htmlFor="pw">새 비밀번호</label>
            <input
              id="pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              autoComplete="new-password"
            />
          </div>

          <button className="primary-btn" onClick={onUpdate} disabled={loading}>
            {loading ? "Updating..." : "비밀번호 변경"}
          </button>

          {message && <div className="notice">{message}</div>}
        </div>
      </div>
    </div>
  );
}