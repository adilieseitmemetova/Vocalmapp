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
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,display_name,vocal_goal,onboarding_completed")
    .eq("id", data.user.id)
    .maybeSingle();
  const { data: legacyProfile } = profileError
    ? await supabase.from("profiles").select("id,email,display_name").eq("id", data.user.id).maybeSingle()
    : { data: null };

  const initialProfile = profile
    ? {
        id: profile.id,
        email: profile.email,
        displayName: profile.display_name,
        vocalGoal: profile.vocal_goal,
        onboardingCompleted: profile.onboarding_completed
      }
    : legacyProfile
      ? {
          id: legacyProfile.id,
          email: legacyProfile.email,
          displayName: legacyProfile.display_name,
          vocalGoal: null,
          onboardingCompleted: false
        }
    : {
        id: data.user.id,
        email: data.user.email ?? "",
        displayName: null,
        vocalGoal: null,
        onboardingCompleted: false
      };

  return (
    <main id="main-content">
      <VocalMapApp
        initialData={initialData}
        initialProfile={initialProfile}
        userEmail={data.user.email ?? ""}
        userId={data.user.id}
        signOutAction={signOutAction}
      />
    </main>
  );
}
