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
      className="relative grid min-h-dvh place-items-center overflow-hidden bg-[#87f0dc] bg-cover bg-center px-5 py-10 sm:px-6"
      id="main-content"
      style={{ backgroundImage: "url('/images/auth-green-bg.png')" }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(220,255,246,0.18),rgba(35,181,156,0.08)_42%,rgba(12,130,111,0.22)_100%)]" />
      <section className="relative z-10 flex w-full max-w-[32rem] flex-col items-center gap-6">
        <div className="grid h-16 w-56 place-items-center">
          <Image
            className="h-auto w-full"
            src="/images/vocalmap-logo.svg"
            alt={common("appName")}
            width={351}
            height={102}
            priority
          />
        </div>

        <div className="w-full rounded-[1.5rem] bg-white p-6 text-center shadow-[0_30px_90px_rgba(0,104,83,0.26)] ring-1 ring-emerald-950/5 sm:p-8">
          <h1 className="text-2xl font-bold leading-tight text-stone-950 sm:text-[1.7rem]">{t("title")}</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-stone-500">{t("subtitle")}</p>
          <Suspense>
            <EmailCodeForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
