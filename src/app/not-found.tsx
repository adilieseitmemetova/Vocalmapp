import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <main className="grid min-h-dvh place-items-center px-6" id="main-content">
      <section className="w-full max-w-md rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-stone-950">{t("title")}</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">{t("body")}</p>
        <Link className="mt-5 inline-flex rounded-md bg-stone-950 px-4 py-2 text-sm font-semibold text-white" href="/dashboard">
          {t("back")}
        </Link>
      </section>
    </main>
  );
}
