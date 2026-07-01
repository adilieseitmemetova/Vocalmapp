import { redirect } from "next/navigation";

import { signOutAction } from "@/app/actions";
import { VocalMapApp } from "@/components/VocalMapApp";
import { createClient } from "@/lib/supabase/server";
import { getInitialVocalMapData } from "@/lib/vocalmap/data";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect("/login");
  }

  const initialData = await getInitialVocalMapData(supabase, data.user.id);

  return (
    <main id="main-content">
      <VocalMapApp
        initialData={initialData}
        userEmail={data.user.email ?? ""}
        userId={data.user.id}
        signOutAction={signOutAction}
      />
    </main>
  );
}
