import "./auth.css";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";

async function handleForgotPassword() {
  const email = prompt("가입한 이메일을 입력하세요");

  if (!email) return;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });

  if (error) {
    alert("메일 전송 실패: " + error.message);
  } else {
    alert("비밀번호 재설정 메일을 확인하세요!");
  }
}

export default function Login() {
  const nav = useNavigate();

useEffect(() => {
  const check = async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) nav("/", { replace: true });
  };
  check();

  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    if (session) nav("/", { replace: true });
  });

  return () => {
    sub.subscription.unsubscribe();
  };
}, [nav]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    setMessage("");
  }, [mode]);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage("회원가입 요청 완료! 이메일 인증이 켜져있으면 메일함을 확인해줘.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        setMessage("로그인 성공!");
      }
    } catch (err: any) {
      setMessage(err?.message ?? "에러가 발생했어.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-header">
          <h2>스톡앤메이크 | 재고·제작 관리</h2>
          <p>Supabase 이메일 로그인</p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
          >
            로그인
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`auth-tab ${mode === "signup" ? "active" : ""}`}
          >
            회원가입
          </button>
        </div>

        <form onSubmit={onSubmit} className="auth-form">
          <div className="form-field">
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-field">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="비밀번호"
              required
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </div>

          <button type="submit" disabled={loading} className="primary-btn">
            {loading ? "처리 중..." : mode === "signup" ? "회원가입" : "로그인"}
          </button>

          {/* ✅ 고정 높이 footer 슬롯: 탭 바뀌어도 카드 높이 고정 */}
          <div className="auth-footer">
            <button
              type="button"
              onClick={handleForgotPassword}
              className={`link-btn ${mode !== "login" ? "link-placeholder" : ""}`}
              disabled={mode !== "login"}
              tabIndex={mode !== "login" ? -1 : 0}
              aria-hidden={mode !== "login"}
            >
              비밀번호를 잊으셨나요?
            </button>

            {/* ✅ message도 항상 자리 확보 */}
            <div className={`notice ${message ? "" : "notice-placeholder"}`}>
              {message || " "}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}