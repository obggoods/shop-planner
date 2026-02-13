import "./auth.css";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";

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
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState("");


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
        setMessage("");
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

  const sendResetEmail = async () => {
    if (!forgotEmail) {
      setForgotMsg("이메일을 입력해줘.");
      return;
    }
  
    setForgotLoading(true);
    setForgotMsg("");
  
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
  
    if (error) {
      setForgotMsg("메일 전송 실패: " + error.message);
    } else {
      setForgotMsg("재설정 메일을 보냈어. 메일함을 확인해줘!");
    }
  
    setForgotLoading(false);
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

          <div className="auth-footer">
  {/* 비밀번호 찾기: 로그인 탭에서만 활성 */}
  <button
    type="button"
    className={`link-btn ${mode !== "login" ? "link-placeholder" : ""}`}
    disabled={mode !== "login"}
    tabIndex={mode !== "login" ? -1 : 0}
    aria-hidden={mode !== "login"}
    onClick={() => {
      setForgotOpen((v) => !v);
      setForgotMsg("");
      setForgotEmail(email || ""); // 로그인 이메일 입력값을 가져와 자동 채움
    }}
  >
    비밀번호를 잊으셨나요?
  </button>

  {/* 펼쳐지는 입력 폼 */}
  {mode === "login" && forgotOpen && (
    <div className="forgot-panel">
      <div className="form-field">
        <label htmlFor="forgotEmail">이메일</label>
        <input
          id="forgotEmail"
          type="email"
          value={forgotEmail}
          onChange={(e) => setForgotEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
        />
      </div>

      <div className="forgot-actions">
        <button
          type="button"
          className="primary-btn"
          onClick={sendResetEmail}
          disabled={forgotLoading}
        >
          {forgotLoading ? "전송 중..." : "재설정 메일 보내기"}
        </button>

        <button
          type="button"
          className="ghost-btn"
          onClick={() => {
            setForgotOpen(false);
            setForgotMsg("");
          }}
        >
          닫기
        </button>
      </div>

      {forgotMsg && <div className="notice">{forgotMsg}</div>}
    </div>
  )}

  {/* 기존 message 영역(로그인/회원가입 처리 메시지) */}
  <div className={`notice ${message ? "" : "notice-placeholder"}`}>
    {message || " "}
  </div>
</div>
        </form>
      </div>
    </div>
  );
}