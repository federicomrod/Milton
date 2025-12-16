Milton

This is a Next.js project bootstrapped with create-next-app, designed to help startup CEOs, CFOs, and business developers manage performance, improve finances, and facilitate investor reporting. The app allows users to upload financial files (e.g., bank transactions, CRM data, financial plans) and provides instant dashboards via OpenAI-powered data interpretation. Future enhancements will include AI-driven live insights on KPIs and a side-window AI agent for creating visualizations, analyses, and exporting reports.

## Project Overview

Milton aims to simplify financial management for startups by leveraging a minimal tech stack. Users can upload data files, view real-time dashboards, and eventually interact with an AI agent for advanced insights. The focus is on client-side simplicity, avoiding complex server dependencies where possible, aligning with the principle of keeping the tech stack manageable.

## Getting Started

### Prerequisites

- Node.js (v24.x)
- npm, yarn, pnpm, or bun (package manager)
- A code editor (e.g., VS Code)

### Installation

Clone the repository:
git clone https://github.com/your-username/milton.git
cd milton


Install dependencies:
npm install
# or
pnpm install


Set up environment variables:

Create a `.env.local` file in the root directory.

Add your OpenAI API key:
```
OPENAI_API_KEY=your-api-key-here
```

Configure Supabase credentials if using database features:
```
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Where to find these keys:**
- Go to your Supabase Dashboard → Settings → API
- `NEXT_PUBLIC_SUPABASE_URL`: Found at the top of the API settings page
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Found under "Project API keys" (anon/public key)
- `SUPABASE_SERVICE_ROLE_KEY`: Found under "Service Role" section (⚠️ Keep this secret - server-side only!)

**Important:** The service role key is required for user signup (creates profile and company). It bypasses Row Level Security and should never be exposed in client-side code.




Run the development server:
npm run dev
# or
pnpm dev


Open http://localhost:3000 in your browser to see the app.

## Features

- **File Upload**: Upload bank transactions, CRM data, and financial plans.
- **Instant Dashboards**: Real-time visualization powered by OpenAI.
- **AI Insights**: Future feature for live KPI analysis (pending client base growth).
- **AI Agent**: Side-window interface for creating visualizations, analyses, and reports.

- `app/`: Contains pages and components for the Next.js app.
- `supabase/`: Houses client and server-side Supabase configurations.
- `components/ui/`: UI components managed by shadcn.
- `lib/`: Custom utilities and helpers.

## Tech Stack

- **Language**: TypeScript (type-safe JavaScript)
- **Client**: HTML, CSS, JavaScript (core web basics), React (UI library), TailwindCSS/Shadcn (ready-made React kits).
- **Server**: Next.js (full-stack React framework for API handling).
- **Database & Tooling**: Supabase (database and authentication), OpenAI API (AI insights), Expo (mobile app builder), Astro (blogs & content sites).

The tech stack is kept simple to minimize complexity and reduce the likelihood of AI-related issues, focusing on client-side rendering and local storage where feasible.
## Development Guidelines

- Use client-side logic for data processing where possible to avoid server dependencies.
- Integrate OpenAI API calls for data interpretation and dashboard generation.
- Ensure compatibility with Supabase for authentication and file storage.
- Plan for future AI agent implementation in the side window using WebSocket or similar lightweight technology.

## Deployment
For now, the app runs locally. Future deployment will leverage Vercel for simplicity:

Push your code to a Git repository.
Connect the repository to Vercel.
Deploy with one click, following Next.js deployment docs.

## Contributing

Contributions are welcome! Please fork the repository, create a feature branch, and submit a pull request. Ensure code adheres to the simple tech stack philosophy and includes relevant tests.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [OpenAI API Docs](https://platform.openai.com/docs)
- [TailwindCSS](https://tailwindcss.com/docs)
- [Shadcn UI](https://ui.shadcn.com)
