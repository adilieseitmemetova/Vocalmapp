import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { EmailCodeForm } from "@/components/EmailCodeForm";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const [t, common, supabase] = await Promise.all([
    getTranslations("auth"),
    getTranslations("common"),
    createClient()
  ]);
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main
      className="relative isolate flex min-h-dvh items-start justify-center overflow-hidden bg-primary bg-cover bg-center px-4 py-[max(1rem,env(safe-area-inset-top))] sm:items-center sm:p-6 lg:p-8"
      id="main-content"
      style={{ backgroundImage: "url('/images/auth-green-bg.png')" }}
    >
      <div className="absolute inset-0 bg-primary/30" />
      <div className="absolute -left-28 top-12 size-80 rounded-full bg-primary/10 blur-3xl" />
      <div className="absolute -right-32 bottom-0 size-96 rounded-full bg-chart-1/15 blur-3xl" />

      <section className="relative z-10 grid w-full max-w-[34rem] overflow-hidden rounded-[1.5rem] border border-white/50 bg-card/95 shadow-[0_32px_100px_var(--vm-accent-shadow-strong)] backdrop-blur-md lg:max-w-[72rem] lg:min-h-[42rem] lg:grid-cols-[0.85fr_1fr] lg:rounded-4xl lg:bg-card">
        <aside className="relative hidden overflow-hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col">
          <div className="absolute -right-24 -top-32 size-96 rounded-full border-[40px] border-primary-foreground/10" />
          <div className="absolute -bottom-40 -left-32 size-[30rem] rounded-full border-[52px] border-primary-foreground/10" />
          <Image
            className="relative h-auto w-52"
            src="/images/vocalmapp-logo-white.svg"
            alt={common("appName")}
            width={286}
            height={40}
            priority
            unoptimized
          />
          <div className="relative mt-auto max-w-sm">
            <p className="text-xs font-semibold tracking-[0.16em] text-primary-foreground/70 uppercase">{t("eyebrow")}</p>
            <p className="mt-4 text-3xl font-semibold leading-tight tracking-tight">{t("subtitle")}</p>
            <div className="mt-8 flex gap-2" aria-hidden="true">
              <span className="h-1.5 w-16 rounded-full bg-primary-foreground" />
              <span className="h-1.5 w-6 rounded-full bg-primary-foreground/45" />
              <span className="h-1.5 w-10 rounded-full bg-primary-foreground/25" />
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col justify-center px-5 py-7 sm:px-10 sm:py-10 lg:px-16">
          <Image
            className="mx-auto mb-7 h-auto w-40 lg:hidden"
            src="/images/vocalmapp-logo-green.svg"
            alt={common("appName")}
            width={286}
            height={40}
            priority
            unoptimized
          />
          <div className="mx-auto w-full max-w-md text-center lg:mx-0 lg:text-left">
            <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">{t("eyebrow")}</p>
            <h1 className="mt-3 text-[1.75rem] font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">{t("title")}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("subtitle")}</p>
            <Suspense>
              <EmailCodeForm />
            </Suspense>
          </div>
        </div>
      </section>
    </main>
  );
}
