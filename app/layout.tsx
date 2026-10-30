import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./chart-capture.css";
import { ClientProviders } from "@/components/layout/client-providers";
import { Suspense } from "react";
import { I18nProvider } from "@/lib/i18n/client";
import { requestLanguage } from "@/lib/restaurant/request-lang";
import { ConfirmedNotice } from "@/components/auth/confirmed-notice";
import { ToastProvider } from "@/components/ui/toast-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Milton",
  description: "AI-native analytics for SMBs",
  icons: {
    icon: "/milton-icon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = await requestLanguage();
  return (
    <html lang={lang}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <I18nProvider lang={lang}>
          <ClientProviders>
            <ToastProvider>
              <div className="min-h-screen bg-background">
                <Suspense fallback={null}>
                  <ConfirmedNotice />
                </Suspense>
                <main>{children}</main>
              </div>
            </ToastProvider>
          </ClientProviders>
        </I18nProvider>
      </body>
    </html>
  );
}
