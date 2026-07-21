import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import "./globals.css";
import { Inter } from "next/font/google";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});


export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");

  return {
    title: t("title"),
    description: t("description"),
    referrer: "strict-origin-when-cross-origin",
    icons: {
      icon: "/favicon.svg"
    },
    openGraph: {
      title: t("title"),
      description: t("description"),
      type: "website"
    }
  };
}

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const common = await getTranslations("common");

  return (
    <html lang={locale} data-scroll-behavior="smooth" suppressHydrationWarning className={cn("font-sans", inter.variable)}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <a className="skip-link" href="#main-content">
            {common("skipToContent")}
          </a>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
