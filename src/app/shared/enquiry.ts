/*
 * Copyright (c) 2026 AMSIDEL Technologies. All rights reserved.
 * Designed and developed by AMSIDEL Technologies.
 */
import { SITE } from '../data/site.config';

/** A website enquiry: the quote form, the site-visit form or the AMI chat. */
export interface Enquiry {
  kind: 'QUOTE' | 'SITE_VISIT' | 'CHAT';
  /** What it is about, shown as the mail's heading (e.g. the product, or the visit date and place). */
  headline?: string;
  name: string;
  phone: string;
  email?: string;
  /** Label and value rows, in order. Empty values are left out. */
  details: { label: string; value: string }[];
  message?: string;
  transcript?: { visitor: boolean; text: string }[];
  /** Hidden form field: people leave it empty, bots fill it in. */
  honey?: string;
}

/** Why an enquiry did not go: 'busy' = too many from this visitor just now; 'failed' = anything else. */
export class EnquiryError extends Error {
  constructor(readonly reason: 'busy' | 'failed') {
    super(reason);
  }
}

const EMAILJS_URL = 'https://api.emailjs.com/api/v1.0/email/send';
const TIMEOUT_MS = 20000;
/** After this long the forms say the mail is still on its way. */
export const SLOW_AFTER_MS = 6000;

/** At most this many enquiries per visitor in RATE_WINDOW_MS (kept in this browser), to spare the email quota. */
const RATE_LIMIT = 4;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_KEY = 'amsidel.enquiries';

const KIND_LABEL: Record<Enquiry['kind'], string> = {
  QUOTE: 'Quote request',
  SITE_VISIT: 'Site-visit booking',
  CHAT: 'AMI chat enquiry',
};

/** True once the EmailJS keys are filled in (data/site.config.ts). */
export function enquiriesConfigured(): boolean {
  const c = SITE.emailjs as { serviceId: string; templateId: string; publicKey: string };
  return !!(c.serviceId && c.templateId && c.publicKey);
}

/**
 * Emails the enquiry to the team directly from the browser through EmailJS (no backend).
 * The EmailJS template receives the variables listed in README.md > "Enquiry emails". Throws EnquiryError.
 */
export async function sendEnquiry(enquiry: Enquiry): Promise<void> {
  // a bot filled in the hidden field: pretend it went, send nothing
  if (enquiry.honey) return;
  if (!enquiriesConfigured()) {
    console.error('Enquiry email is not set up: fill in SITE.emailjs in src/app/data/site.config.ts');
    throw new EnquiryError('failed');
  }
  const recent = recentSends();
  if (recent.length >= RATE_LIMIT) throw new EnquiryError('busy');

  const c = SITE.emailjs as { serviceId: string; templateId: string; publicKey: string };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(EMAILJS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: c.serviceId,
        template_id: c.templateId,
        user_id: c.publicKey,
        template_params: templateParams(enquiry),
      }),
      signal: abort.signal,
    });
  } catch {
    throw new EnquiryError('failed');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) throw new EnquiryError('busy');
  if (!res.ok) {
    console.error('EmailJS refused the enquiry:', res.status, await res.text().catch(() => ''));
    throw new EnquiryError('failed');
  }
  rememberSend(recent);
}

/** The variables the EmailJS template can use. */
function templateParams(e: Enquiry): Record<string, string> {
  const kind = KIND_LABEL[e.kind];
  const email = e.email?.trim() ?? '';
  const rows: [string, string][] = [
    ['Name', e.name],
    ['Phone', e.phone],
    ...(email ? [['Email', email] as [string, string]] : []),
    ...e.details.filter((d) => d.value?.trim()).map((d) => [d.label, d.value.trim()] as [string, string]),
  ];
  const sentAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const page = typeof window === 'undefined' ? '' : window.location.href;
  const message = e.message?.trim() ?? '';
  const transcript = (e.transcript ?? []).map((t) => `${t.visitor ? e.name || 'Visitor' : 'AMI'}: ${t.text}`).join('\n');

  const text = [
    `${kind}${e.headline ? ' – ' + e.headline : ''}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(message ? ['', 'Message:', message] : []),
    ...(transcript ? ['', 'Chat transcript:', transcript] : []),
    '',
    `Sent ${sentAt} from ${page}`,
  ].join('\n');

  return {
    subject: `${kind}: ${e.name}${e.headline ? ' – ' + e.headline : ''}`,
    kind,
    headline: e.headline ?? '',
    from_name: e.name,
    phone: e.phone,
    reply_to: email,
    details_text: rows.map(([k, v]) => `${k}: ${v}`).join('\n'),
    message,
    transcript,
    page,
    sent_at: sentAt,
    content_text: text,
    content_html: html(kind, e.headline ?? '', rows, message, e.transcript ?? [], e.name, sentAt, page),
  };
}

function html(
  kind: string,
  headline: string,
  rows: [string, string][],
  message: string,
  transcript: { visitor: boolean; text: string }[],
  name: string,
  sentAt: string,
  page: string,
): string {
  const td = 'padding:8px 12px;border-bottom:1px solid #eee;vertical-align:top;font:14px/1.5 Arial,sans-serif';
  const block = (title: string, body: string) =>
    `<h3 style="margin:24px 0 8px;font:600 15px Arial,sans-serif;color:#111">${title}</h3>${body}`;
  return [
    `<div style="max-width:640px;font:14px/1.5 Arial,sans-serif;color:#222">`,
    `<p style="margin:0;font:600 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#8f6d38">${esc(kind)}</p>`,
    headline ? `<h2 style="margin:4px 0 16px;font:600 20px Arial,sans-serif;color:#111">${esc(headline)}</h2>` : '',
    `<table style="border-collapse:collapse;width:100%">`,
    ...rows.map(
      ([k, v]) => `<tr><td style="${td};width:150px;color:#666">${esc(k)}</td><td style="${td};color:#111"><b>${esc(v)}</b></td></tr>`,
    ),
    `</table>`,
    message ? block('Message', `<p style="margin:0;white-space:pre-line">${esc(message)}</p>`) : '',
    transcript.length
      ? block(
          'Chat transcript',
          transcript
            .map(
              (t) =>
                `<p style="margin:0 0 6px"><b style="color:${t.visitor ? '#111' : '#8f6d38'}">${esc(t.visitor ? name || 'Visitor' : 'AMI')}:</b> <span style="white-space:pre-line">${esc(t.text)}</span></p>`,
            )
            .join(''),
        )
      : '',
    `<p style="margin:24px 0 0;color:#888;font-size:12px">Sent ${esc(sentAt)} from ${esc(page)}</p>`,
    `</div>`,
  ].join('');
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function recentSends(): number[] {
  try {
    const list = JSON.parse(localStorage.getItem(RATE_KEY) ?? '[]') as number[];
    const since = Date.now() - RATE_WINDOW_MS;
    return Array.isArray(list) ? list.filter((t) => typeof t === 'number' && t > since) : [];
  } catch {
    return [];
  }
}

function rememberSend(recent: number[]): void {
  try {
    localStorage.setItem(RATE_KEY, JSON.stringify([...recent, Date.now()]));
  } catch {
    /* private mode: no limit kept, nothing else lost */
  }
}
