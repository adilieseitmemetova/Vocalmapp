"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
        router.refresh();
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
      router.refresh();
    }

    void completeSignIn();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams, supabase, t]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#87f0dc] px-6">
      <div className="grid w-full max-w-sm justify-items-center gap-4 rounded-[1.5rem] bg-white p-8 text-center shadow-[0_30px_90px_rgba(0,104,83,0.24)]">
        {errorMessage ? (
          <>
            <p className="text-lg font-bold text-stone-950">{t("callbackErrorTitle")}</p>
            <p className="text-sm leading-6 text-stone-500">{errorMessage}</p>
            <button className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white" type="button" onClick={() => router.replace("/login")}>
              {t("callbackBackToLogin")}
            </button>
          </>
        ) : (
          <>
            <Loader2 className="spin size-6 text-emerald-700" />
            <p className="text-lg font-bold text-stone-950">{t("callbackTitle")}</p>
            <p className="text-sm leading-6 text-stone-500">{t("callbackBody")}</p>
          </>
        )}
      </div>
    </main>
  );
}
