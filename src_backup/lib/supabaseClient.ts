import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anon);

// ✅ 유저별 기본 목표 재고 설정 (profiles)
export type Profile = {
  user_id: string;
  default_target_qty: number;
  low_stock_threshold: number;
  is_invited?: boolean; // ✅ 초대 통과 여부(InviteGate 통과에 필요)
};

export async function getOrCreateMyProfile() {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = authData.user;
  if (!user) throw new Error("No authenticated user");

  // 1) 먼저 내 profile 조회
  const { data: profile, error: selErr } = await supabase
    .from("profiles")
    .select("user_id, default_target_qty, low_stock_threshold, is_invited") // ✅ is_invited 포함
    .eq("user_id", user.id)
    .maybeSingle();

  if (selErr) throw selErr;

  // 2) 없으면 생성
  if (!profile) {
    const { data: created, error: insErr } = await supabase
      .from("profiles")
      .insert({ user_id: user.id })
      .select("user_id, default_target_qty, low_stock_threshold, is_invited") // ✅ is_invited 포함
      .single();

    if (insErr) throw insErr;
    return created as Profile;
  }

  return profile as Profile;
}

export async function updateMyDefaultTargetQty(value: number) {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = authData.user;
  if (!user) throw new Error("No authenticated user");

  const safe = Math.max(0, Math.min(9999, Math.floor(value)));

  const { data, error } = await supabase
    .from("profiles")
    .update({ default_target_qty: safe })
    .eq("user_id", user.id)
    .select("user_id, default_target_qty, low_stock_threshold, is_invited") // ✅ is_invited 포함
    .single();

  if (error) throw error;
  return data as Profile;
}

export async function updateMyLowStockThreshold(value: number) {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = authData.user;
  if (!user) throw new Error("No authenticated user");

  const safe = Math.max(0, Math.min(9999, Math.floor(value)));

  const { data, error } = await supabase
    .from("profiles")
    .update({ low_stock_threshold: safe })
    .eq("user_id", user.id)
    .select("user_id, default_target_qty, low_stock_threshold, is_invited") // ✅ is_invited 포함
    .single();

  if (error) throw error;
  return data as Profile;
}
