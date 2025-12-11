// app/api/kpi/generate/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { generateUserKpiSnapshots } from '@/lib/kpi-snapshot-generator';

export async function POST(request: Request) {
  try {
    const supabase = await createClient(await cookies());
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[kpi/generate] Starting generator for user:', user.id);
    const result = await generateUserKpiSnapshots(supabase, user.id);
    console.log('[kpi/generate] Generator finished successfully', result);

    // If you prefer immediate redirect, you can swap this JSON for a redirect.
    return NextResponse.json({ ok: true, result });
    // return NextResponse.redirect(new URL('/dashboard', request.url));
  } catch (error: any) {
    console.error('[kpi/generate] Error:', error);
    return NextResponse.json({ ok: false, error: String(error?.message ?? error) }, { status: 500 });
  }
}