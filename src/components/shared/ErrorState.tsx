// src/components/shared/ErrorState.tsx
import { AppButton } from "@/components/app/AppButton";
import { AppCard } from "@/components/app/AppCard";

export function ErrorState(props: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <AppCard
      title={props.title ?? "문제가 발생했어요"}
      description={props.message ?? "잠시 후 다시 시도해 주세요."}
      action={
        props.onRetry ? (
          <AppButton variant="outline" onClick={props.onRetry}>
            다시 시도
          </AppButton>
        ) : null
      }
    />
  );
}
