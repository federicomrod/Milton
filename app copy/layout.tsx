import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import './chart-capture.css'
import { AppNavigation } from '@/components/layout/app-navigation'
import { ClientProviders } from '@/components/layout/client-providers'
import { ToastProvider } from '@/components/ui/toast-context'


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CFO Platform - Financial Insights",
  description: "Comprehensive financial analytics and reporting platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ClientProviders>
          <ToastProvider>
            <div className="min-h-screen bg-gray-50">
              <AppNavigation />
              <main>{children}</main>
            </div>
          </ToastProvider>
        </ClientProviders>
      </body>
    </html>
  );
}
