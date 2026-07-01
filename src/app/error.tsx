"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function ErrorPage() {
  const t = useTranslations("error");

  return (
    <main className="grid min-h-dvh place-items-center px-6" id="main-content">
      <section className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase text-stone-500">{t("title")}</p>
        <p className="mt-3 text-sm leading-6 text-stone-600">{t("body")}</p>
        <Link className="mt-5 inline-flex rounded-md bg-stone-950 px-4 py-2 text-sm font-semibold text-white" href="/dashboard">
          {t("dashboard")}
        </Link>
      </section>
    </main>
  );
}
