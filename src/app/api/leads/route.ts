import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    {
      success: false,
      message: 'Phone verification is required before a site visit can be scheduled.',
    },
    { status: 410 }
  );
}
