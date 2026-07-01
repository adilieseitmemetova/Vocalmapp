"use client";

import { Check, Loader2, Mail, RefreshCw } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const codeBoxCount = 6;
const codePattern = /^\d{6}$/;
const maxCodeLength = codeBoxCount;

type AuthStep = "email" | "code";
type AuthStatus = "idle" | "sending" | "sent" | "verifying" | "redirecting" | "error";
type EmailCodeErrorMessageKey = "codeRateLimitError" | "codeUnauthorizedEmailError" | "codeSmtpError" | "codeSendError";

function getAuthErrorDetails(error: unknown) {
  const maybeError = error as { code?: string; message?: string; status?: number };

  return {
    code: maybeError.code?.toLowerCase() ?? "",
    message: maybeError.message?.toLowerCase() ?? "",
    status: maybeError.status
  };
}

function getEmailCodeErrorMessageKey(error: unknown): EmailCodeErrorMessageKey {
  const { code, message, status } = getAuthErrorDetails(error);

  if (status === 429 || code.includes("rate") || message.includes("rate limit")) {
    return "codeRateLimitError";
  }

  if (
    status === 422 ||
    code.includes("otp_disabled") ||
    code.includes("not_authorized") ||
    message.includes("not authorized") ||
    message.includes("signups not allowed")
  ) {
    return "codeUnauthorizedEmailError";
  }

  if (status === 500 || message.includes("smtp") || message.includes("email provider") || message.includes("sending")) {
    return "codeSmtpError";
  }

  return "codeSendError";
}

function logAuthError(operation: string, error: unknown, context?: Record<string, string>) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const maybeError = error as { code?: string; message?: string; name?: string; status?: number };
  // Keep email addresses and keys out of logs; Supabase Auth logs have request-level detail.
  console.warn(`Supabase ${operation} failed`, {
    code: maybeError.code,
    context,
    message: maybeError.message,
    name: maybeError.name,
    status: maybeError.status
  });
}

export function EmailCodeForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [confirmedEmail, setConfirmedEmail] = useState("");
  const [code, setCode] = useState("");
  const [isCodeFocused, setIsCodeFocused] = useState(false);
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [message, setMessage] = useState("");

  const isSending = status === "sending";
  const isVerifying = status === "verifying";
  const isRedirecting = status === "redirecting";

  async function sendCode(targetEmail: string) {
    setStatus("sending");
    setMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email: targetEmail,
      options: {
        shouldCreateUser: true
      }
    });

    if (error) {
      logAuthError("signInWithOtp", error);
      setStatus("error");
      setMessage(t(getEmailCodeErrorMessageKey(error)));
      return;
    }

    setConfirmedEmail(targetEmail);
    setCode("");
    setStep("code");
    setStatus("sent");
    setMessage(t("codeSentBody", { email: targetEmail }));
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!emailPattern.test(normalizedEmail)) {
      setStatus("error");
      setMessage(t("invalidEmail"));
      return;
    }

    await sendCode(normalizedEmail);
  }

  async function handleGoogleSignIn() {
    setStatus("redirecting");
    setMessage("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`
      }
    });

    if (error) {
      logAuthError("signInWithOAuth", error, { provider: "google" });
      setStatus("error");
      setMessage(t("googleSignInError"));
    }
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = code.trim();

    if (!confirmedEmail || !codePattern.test(normalizedCode)) {
      setStatus("error");
      setMessage(t("invalidCode"));
      return;
    }

    setStatus("verifying");
    setMessage("");

    const { error } = await supabase.auth.verifyOtp({
      email: confirmedEmail,
      token: normalizedCode,
      type: "email"
    });

    if (error) {
      logAuthError("verifyOtp", error, { type: "email" });
      setStatus("error");
      setMessage(t("codeVerifyError"));
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  function handleCodeChange(value: string) {
    setCode(value.replace(/\D/g, "").slice(0, maxCodeLength));
  }

  function changeEmail() {
    setStep("email");
    setStatus("idle");
    setMessage("");
    setCode("");
  }

  return (
    <div className="mt-6 grid gap-4">
      <button
        className="relative inline-flex h-11 items-center justify-center rounded-full border border-stone-200 bg-white px-12 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 active:scale-[0.99] disabled:opacity-60"
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isRedirecting}
      >
        {isRedirecting ? (
          <Loader2 className="spin absolute left-5 size-4" />
        ) : (
          <Image
            className="absolute left-5 size-5 object-contain"
            src="/images/google-g-logo.png"
            alt=""
            width={20}
            height={20}
            aria-hidden="true"
          />
        )}
        {isRedirecting ? t("googleRedirecting") : t("googleSubmit")}
      </button>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-[0.7rem] font-semibold text-stone-400">
        <span className="h-px bg-stone-200" />
        <span>{t("orDivider")}</span>
        <span className="h-px bg-stone-200" />
      </div>

      {step === "email" ? (
        <form className="grid gap-4 text-center" onSubmit={handleEmailSubmit}>
          <label className="grid gap-2 text-sm font-semibold text-stone-800" htmlFor="email">
            <span className="sr-only">{t("emailLabel")}</span>
            <input
              className="h-11 rounded-md border border-stone-200 bg-white px-4 text-sm font-medium text-stone-950 shadow-[inset_0_1px_0_rgba(0,0,0,0.03)] outline-none transition placeholder:text-stone-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("emailPlaceholder")}
              required
            />
          </label>
          <button
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(5,150,105,0.28)] transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
            type="submit"
            disabled={isSending}
          >
            {isSending ? <Loader2 className="spin size-4" /> : <Mail size={16} />}
            {isSending ? t("codeSending") : t("codeSubmit")}
          </button>
          <p className="mx-auto max-w-xs text-xs leading-5 text-stone-500">{t("continueNote")}</p>
        </form>
      ) : (
        <form className="grid gap-4 text-center" onSubmit={handleCodeSubmit}>
          <label className="grid gap-2 text-sm font-semibold text-stone-800" htmlFor="otp-code">
            <span className="sr-only">{t("codeLabel")}</span>
            <div className="relative">
              <div className="mx-auto grid w-full max-w-[20rem] grid-cols-6 gap-2" aria-hidden="true">
                {Array.from({ length: codeBoxCount }, (_, index) => {
                  const isActive = isCodeFocused && index === Math.min(code.length, codeBoxCount - 1);

                  return (
                    <span
                      className={`grid aspect-square min-h-0 place-items-center rounded-md border bg-white text-lg font-semibold text-stone-950 shadow-[inset_0_1px_0_rgba(0,0,0,0.03)] transition ${
                        isActive ? "border-emerald-500 ring-4 ring-emerald-100" : "border-stone-200"
                      }`}
                      key={index}
                    >
                      {code[index] ?? ""}
                    </span>
                  );
                })}
              </div>
              <input
                className="absolute inset-0 h-full w-full cursor-text opacity-0"
                id="otp-code"
                name="otp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => handleCodeChange(event.target.value)}
                onFocus={() => setIsCodeFocused(true)}
                onBlur={() => setIsCodeFocused(false)}
                placeholder={t("codePlaceholder")}
                aria-describedby="otp-code-help"
                required
              />
            </div>
            <span className="text-xs font-medium leading-5 text-stone-500" id="otp-code-help">
              {t("codeHelp", { email: confirmedEmail })}
            </span>
          </label>
          <button
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(5,150,105,0.28)] transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
            type="submit"
            disabled={isVerifying}
          >
            {isVerifying ? <Loader2 className="spin size-4" /> : <Check size={16} />}
            {isVerifying ? t("codeVerifying") : t("codeVerify")}
          </button>
          <p className="mx-auto max-w-xs text-xs leading-5 text-stone-500">{t("continueNote")}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-800 transition hover:bg-stone-50 disabled:opacity-60"
              type="button"
              onClick={() => sendCode(confirmedEmail)}
              disabled={isSending || !confirmedEmail}
            >
              {isSending ? <Loader2 className="spin size-4" /> : <RefreshCw size={15} />}
              {t("codeResend")}
            </button>
            <button
              className="inline-flex h-10 items-center justify-center rounded-full border border-stone-200 bg-white px-3 text-xs font-semibold text-stone-800 transition hover:bg-stone-50"
              type="button"
              onClick={changeEmail}
            >
              {t("changeEmail")}
            </button>
          </div>
        </form>
      )}

      {message ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm leading-6 ${
            status === "sent" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="status"
          aria-live="polite"
        >
          <strong className="block">{status === "sent" ? t("codeSentTitle") : t("errorTitle")}</strong>
          {message}
        </div>
      ) : null}
    </div>
  );
}
