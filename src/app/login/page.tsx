import { AudioLines } from "lucide-react";
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
        <div className="flex items-center gap-3 text-white drop-shadow-[0_4px_18px_rgba(0,122,98,0.35)]">
          <span className="grid size-10 place-items-center rounded-[0.8rem] bg-white/20 text-white ring-1 ring-white/35 backdrop-blur-md">
            <AudioLines size={21} strokeWidth={2.5} />
          </span>
          <span className="text-4xl font-bold leading-none tracking-[0.02em] sm:text-5xl">{common("appName")}</span>
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
