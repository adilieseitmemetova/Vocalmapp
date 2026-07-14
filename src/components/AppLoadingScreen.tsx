import Image from "next/image";

type AppLoadingScreenProps = {
  label: string;
  description?: string;
  showLabel?: boolean;
};

export function AppLoadingScreen({ label, description, showLabel = true }: AppLoadingScreenProps) {
  return (
    <main className="app-loading-screen" id="main-content">
      <section className="app-loading-card" role="status" aria-live="polite" aria-label={label}>
        <Image className="h-auto w-44" src="/images/vocalmapp-sidebar-logo.svg" alt="" width={286} height={36} priority />
        <div className="app-loading-wave" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        {showLabel || description ? (
          <div className="grid gap-1 text-center">
            {showLabel ? <p className="text-base font-semibold text-stone-950">{label}</p> : null}
            {description ? <p className="max-w-[17rem] text-sm leading-6 text-stone-500">{description}</p> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
