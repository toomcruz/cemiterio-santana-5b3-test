import { NextRequest, NextResponse } from 'next/server';
import { mediaReference, recoverMediaReference, downloadMedia, imageBytes, pdfBytes } from '@/lib/sana-media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const EDGE = 'https://sfoygvjtnwqvudrbgoom.supabase.co/functions/v1/sana-panel-preview-login';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function POST(request: NextRequest) {
  if (!['preview', 'production'].includes(process.env.VERCEL_ENV ?? '')) return json('NOT_FOUND', 404);
  const authorization = request.headers.get('authorization') ?? '';
  if (!/^Bearer [^\s]+$/.test(authorization)) return json('USER_SESSION_REQUIRED', 401);
  const input = await request.json().catch(() => null);
  if (!input || !UUID.test(input.conversation_id ?? '') || typeof input.message_key !== 'string'
    || input.message_key.length > 100 || typeof input.artifact_id !== 'string' || !input.artifact_id || input.artifact_id.length > 512
    || Object.keys(input).some(key => !['conversation_id', 'message_key', 'artifact_id'].includes(key))) return json('INVALID_ATTACHMENT', 400);
  const caller = process.env.SANA_PROD_CALLER_TOKEN?.trim();
  const token = process.env.WAPI_TOKEN?.trim(); const instance = process.env.WAPI_INSTANCE_ID?.trim();
  if (!caller || caller.length < 32 || !token || !instance) return json('MEDIA_PROVIDER_UNAVAILABLE', 503);
  try {
    // No provider call, reference or bytes are returned before current operator
    // authorization and the exact conversation/message/artifact scope check.
    const response = await fetch(EDGE, { method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000),
      headers: { Authorization: authorization, 'X-Sana-Prod-Token': caller, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'operator_attachment_read', ...input }) });
    if (!response.ok) return json('ATTACHMENT_NOT_AVAILABLE', [401, 403, 404].includes(response.status) ? response.status : 502);
    const scope = await response.json();
    if (!['image', 'document', 'application/pdf'].includes(scope.type) || typeof scope.phone !== 'string' || typeof scope.external_message_id !== 'string') return json('ATTACHMENT_NOT_AVAILABLE', 404);
    const reference = mediaReference(scope.provider) ?? await recoverMediaReference(instance, token, scope.external_message_id, scope.phone);
    const pdf = scope.type !== 'image';
    if (!reference || (pdf ? reference.type !== 'document' || reference.mimetype.toLowerCase() !== 'application/pdf' : reference.type !== 'image')) {
      console.warn('SANA_MEDIA', { stage: 'reference', status: 'UNAVAILABLE' }); return json('ATTACHMENT_REFERENCE_UNAVAILABLE', 404);
    }
    const url = await downloadMedia(reference, instance, token);
    if (!url) return json('IMAGE_EXPIRED_OR_UNAVAILABLE', 404);
    const file = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000) });
    const content = pdf ? await pdfBytes(file) : await imageBytes(file);
    return new Response(content.bytes, { headers: { 'Content-Type': content.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      ...(pdf ? { 'Content-Disposition': 'attachment; filename="documento.pdf"' } : {}) } });
  } catch (error) {
    if (error instanceof Error && error.message === 'PDF_TOO_LARGE') return json('PDF_TOO_LARGE', 413);
    console.warn('SANA_MEDIA', { stage: 'proxy', status: 'UNAVAILABLE' }); return json('IMAGE_UNAVAILABLE', 502);
  }
}

