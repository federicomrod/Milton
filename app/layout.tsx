import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./chart-capture.css";
import { ClientProviders } from "@/components/layout/client-providers";
import { Suspense } from "react";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
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
      </body>
    </html>
  );
}
