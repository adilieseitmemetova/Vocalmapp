import { Music2 } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function Loading() {
  const common = await getTranslations("common");

  return (
    <main className="grid min-h-dvh place-items-center px-6" id="main-content">
      <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white/80 px-4 py-3 text-sm font-semibold text-stone-700 shadow-sm">
        <Music2 className="spin size-4" />
        {common("loading")}
      </div>
    </main>
  );
}
