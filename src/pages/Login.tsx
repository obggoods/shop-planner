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
    <div style={{ maxWidth: 420, margin: "60px auto", padding: 16 }}>
      <h2 style={{ marginBottom: 8 }}>스톡앤메이크 | 재고·제작 관리</h2>
      <p style={{ marginTop: 0, opacity: 0.7 }}>Supabase 이메일 로그인</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setMode("login")}
          disabled={mode === "login"}
        >
          로그인
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          disabled={mode === "signup"}
        >
          회원가입
        </button>
      </div>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <label>
          이메일
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="you@example.com"
            required
            style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
          />
        </label>

        <label>
          비밀번호
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            placeholder="비밀번호"
            required
            style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
          />
        </label>

        <button type="submit" disabled={loading}>
          {loading ? "처리 중..." : mode === "signup" ? "회원가입" : "로그인"}
        </button>

        {message && (
          <div style={{ padding: 10, background: "#f3f4f6" }}>{message}</div>
        )}
      </form>
    </div>
  );
}
