"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { AppLoadingScreen } from "@/components/AppLoadingScreen";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const authNextStorageKey = "vocalmapp:auth-next";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}

export function AuthCallbackClient() {
  const t = useTranslations("auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function completeSignIn() {
      const code = searchParams.get("code");
      const providerError = searchParams.get("error_description") ?? searchParams.get("error");
      const next = safeNextPath(searchParams.get("next") ?? sessionStorage.getItem(authNextStorageKey));

      async function redirectIfSessionExists() {
        let hasSession = false;
        try {
          const { data } = await supabase.auth.getSession();
          hasSession = Boolean(data.session);
        } catch {
          return false;
        }

        if (!hasSession) {
          return false;
        }

        sessionStorage.removeItem(authNextStorageKey);
        router.replace(next);
        return true;
      }

      if (providerError) {
        setErrorMessage(t("callbackProviderError", { message: providerError }));
        return;
      }

      if (!code) {
        const redirected = await redirectIfSessionExists();

        if (cancelled) {
          return;
        }

        if (redirected) {
          return;
        }

        setErrorMessage(t("callbackMissingCode"));
        return;
      }

      let error: unknown = null;
      try {
        ({ error } = await supabase.auth.exchangeCodeForSession(code));
      } catch (authError) {
        error = authError;
      }
      if (cancelled) {
        return;
      }

      if (error) {
        const redirected = await redirectIfSessionExists();

        if (cancelled || redirected) {
          return;
        }

        setErrorMessage(t("callbackExchangeError"));
        return;
      }

      sessionStorage.removeItem(authNextStorageKey);
      router.replace(next);
    }

    void completeSignIn();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams, supabase, t]);

  if (!errorMessage) {
    return <AppLoadingScreen label={t("callbackTitle")} description={t("callbackBody")} />;
  }

  return (
    <main className="app-loading-screen" id="main-content">
      <div className="grid w-full max-w-sm justify-items-center gap-4 rounded-4xl border border-border bg-card p-8 text-center shadow-[0_30px_90px_var(--vm-accent-shadow-soft)]">
        <Alert className="text-left" variant="destructive">
          <AlertTitle>{t("callbackErrorTitle")}</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
        <Button className="mt-2" size="lg" type="button" onClick={() => router.replace("/login")}>
          {t("callbackBackToLogin")}
        </Button>
      </div>
    </main>
  );
}
