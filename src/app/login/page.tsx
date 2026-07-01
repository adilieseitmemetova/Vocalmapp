import { Mail } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { EmailCodeForm } from "@/components/EmailCodeForm";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const [t, common, supabase] = await Promise.all([
    getTranslations("auth"),
    getTranslations("common"),
    createClient()
  ]);
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) {
    redirect("/dashboard");
  }

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-10" id="main-content">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm md:grid-cols-[0.95fr_1.05fr]">
        <div className="hidden bg-stone-950 p-8 text-white md:grid">
          <div className="flex h-full flex-col justify-between">
            <div className="inline-flex size-11 items-center justify-center rounded-lg bg-white text-stone-950">
              <Mail size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-stone-300">{t("eyebrow")}</p>
              <h1 className="mt-3 max-w-sm text-4xl font-bold leading-tight">{common("appName")}</h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-stone-300">{t("subtitle")}</p>
            </div>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <p className="text-sm font-semibold text-teal-700">{t("eyebrow")}</p>
          <h2 className="mt-3 text-3xl font-bold text-stone-950">{t("title")}</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-stone-600">{t("subtitle")}</p>
          <EmailCodeForm />
          <p className="mt-6 text-xs leading-5 text-stone-500">{t("productionNote")}</p>
        </div>
      </section>
    </main>
  );
}
