"use client";

import { Check, Loader2, Mail, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { createClient } from "@/lib/supabase/client";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const codePattern = /^\d{6}$/;

type AuthStep = "email" | "code";
type AuthStatus = "idle" | "sending" | "sent" | "verifying" | "error";
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

  if (message.includes("not authorized") || code.includes("not_authorized")) {
    return "codeUnauthorizedEmailError";
  }

  if (status === 500 || message.includes("smtp") || message.includes("email provider") || message.includes("sending")) {
    return "codeSmtpError";
  }

  return "codeSendError";
}

function logAuthError(error: unknown) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }

  const maybeError = error as { code?: string; message?: string; name?: string; status?: number };
  // Keep email addresses and keys out of logs; Supabase Auth logs have request-level detail.
  console.warn("Supabase signInWithOtp failed", {
    code: maybeError.code,
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
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [message, setMessage] = useState("");

  const isSending = status === "sending";
  const isVerifying = status === "verifying";

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
      logAuthError(error);
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
      setStatus("error");
      setMessage(t("codeVerifyError"));
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  function handleCodeChange(value: string) {
    setCode(value.replace(/\D/g, "").slice(0, 6));
  }

  function changeEmail() {
    setStep("email");
    setStatus("idle");
    setMessage("");
    setCode("");
  }

  return (
    <div className="mt-7 grid gap-4">
      {step === "email" ? (
        <form className="grid gap-4" onSubmit={handleEmailSubmit}>
          <label className="grid gap-2 text-sm font-semibold text-stone-700" htmlFor="email">
            {t("emailLabel")}
            <input
              className="h-11 rounded-md border border-stone-300 bg-white px-3 text-base text-stone-950 outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
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
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 active:scale-[0.99] disabled:opacity-60"
            type="submit"
            disabled={isSending}
          >
            {isSending ? <Loader2 className="spin size-4" /> : <Mail size={16} />}
            {isSending ? t("codeSending") : t("codeSubmit")}
          </button>
        </form>
      ) : (
        <form className="grid gap-4" onSubmit={handleCodeSubmit}>
          <label className="grid gap-2 text-sm font-semibold text-stone-700" htmlFor="otp-code">
            {t("codeLabel")}
            <input
              className="h-12 rounded-md border border-stone-300 bg-white px-3 text-center text-xl font-semibold text-stone-950 outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-100"
              id="otp-code"
              name="otp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => handleCodeChange(event.target.value)}
              placeholder={t("codePlaceholder")}
              aria-describedby="otp-code-help"
              required
            />
            <span className="text-xs font-medium leading-5 text-stone-500" id="otp-code-help">
              {t("codeHelp", { email: confirmedEmail })}
            </span>
          </label>
          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 active:scale-[0.99] disabled:opacity-60"
            type="submit"
            disabled={isVerifying}
          >
            {isVerifying ? <Loader2 className="spin size-4" /> : <Check size={16} />}
            {isVerifying ? t("codeVerifying") : t("codeVerify")}
          </button>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:opacity-60"
              type="button"
              onClick={() => sendCode(confirmedEmail)}
              disabled={isSending || !confirmedEmail}
            >
              {isSending ? <Loader2 className="spin size-4" /> : <RefreshCw size={15} />}
              {t("codeResend")}
            </button>
            <button
              className="inline-flex h-10 items-center justify-center rounded-md border border-stone-300 px-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
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
          className={`rounded-md border px-4 py-3 text-sm leading-6 ${
            status === "sent" ? "border-teal-200 bg-teal-50 text-teal-900" : "border-red-200 bg-red-50 text-red-800"
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
