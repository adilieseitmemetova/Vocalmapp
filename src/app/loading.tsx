import { getTranslations } from "next-intl/server";

import { AppLoadingScreen } from "@/components/AppLoadingScreen";

export default async function Loading() {
  const common = await getTranslations("common");

  return <AppLoadingScreen label={common("loading")} showLabel={false} />;
}
