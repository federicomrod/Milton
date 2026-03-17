import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex flex-col">
      {/* Inline header — no async auth check, no flicker */}
      <header className="w-full border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image src="/Milton_Logo.png" alt="Milton" width={26} height={26} />
            <span className="text-lg font-bold text-gray-900">milton.</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/auth/login">
              <Button size="sm" variant="ghost">
                Sign in
              </Button>
            </Link>
            <Link href="/auth/signup">
              <Button size="sm">Get started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 text-center py-24">
        <div className="flex items-center gap-3 mb-8">
          <Image src="/Milton_Logo.png" alt="Milton" width={60} height={60} />
          <span className="text-5xl font-bold text-gray-900">milton.</span>
        </div>

        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 max-w-2xl mb-6 leading-tight">
          Your accountant tells you what happened. Milton tells you{" "}
          <span className="text-blue-600">what&apos;s happening</span> and{" "}
          <span className="text-blue-600">what to do next.</span>
        </h1>
        <div className="flex flex-wrap justify-center gap-2 mb-6">
          {["Real-time KPIs", "Margin analysis", "AI insights", "No setup"].map(
            (label) => (
              <span
                key={label}
                className="px-3 py-1 rounded-full bg-gray-100 text-gray-600 text-sm font-medium"
              >
                {label}
              </span>
            )
          )}
        </div>

        <p className="text-lg text-gray-500 max-w-xl mb-10 leading-relaxed">
          Upload a spreadsheet. Get your KPIs, margin analysis, and AI-powered
          insights in under an hour. No setup. No analysts. No waiting.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/auth/signup">
            <Button size="lg" className="text-base px-8">
              Get started — it&apos;s free
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link href="/auth/login">
            <Button size="lg" variant="outline" className="text-base px-8">
              Sign in
            </Button>
          </Link>
        </div>

        <p className="mt-6 text-sm text-gray-400">
          No credit card required · Setup in &lt;1 hour
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <Image
                src="/Milton_Logo.png"
                alt="Milton"
                width={20}
                height={20}
              />
              <span className="text-sm font-bold text-gray-900">milton.</span>
            </div>
            <div className="flex gap-6">
              <Link
                href="/auth/login"
                className="text-sm text-gray-400 hover:text-gray-900 transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/auth/signup"
                className="text-sm text-gray-400 hover:text-gray-900 transition-colors"
              >
                Sign up
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
