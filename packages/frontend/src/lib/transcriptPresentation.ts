interface TranscriptLike {
  transport?: string | null;
  kind?: string | null;
  entryKind?: string | null;
  summary?: string | null;
  vendorEventType?: string | null;
}

const IGNORED_CODEX_VENDOR_EVENT_TYPES = new Set(['item.completed', 'item.started']);
const IGNORED_CODEX_STATUS_SUMMARIES = new Set(['item completed', 'item started']);

export function filterVisibleTranscriptEntries<T extends TranscriptLike>(entries: T[]): T[] {
  return entries.filter((entry) => isVisibleTranscriptEntry(entry));
}

export function isVisibleTranscriptEntry(entry: TranscriptLike): boolean {
  if (normalizedTransport(entry.transport) !== 'codex') {
    return true;
  }

  if (normalizedEntryKind(entry) !== 'status') {
    return true;
  }

  const vendorEventType = normalizedVendorEventType(entry.vendorEventType);
  if (vendorEventType && IGNORED_CODEX_VENDOR_EVENT_TYPES.has(vendorEventType)) {
    return false;
  }

  const summary = normalizedSummary(entry.summary);
  return !IGNORED_CODEX_STATUS_SUMMARIES.has(summary);
}

export function shouldShowTranscriptVendorEventType(entry: TranscriptLike): boolean {
  const vendorEventType = normalizedVendorEventType(entry.vendorEventType);
  if (!vendorEventType) {
    return false;
  }

  if (
    normalizedTransport(entry.transport) === 'codex' &&
    IGNORED_CODEX_VENDOR_EVENT_TYPES.has(vendorEventType)
  ) {
    return false;
  }

  return true;
}

function normalizedTransport(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function normalizedEntryKind(entry: TranscriptLike) {
  return (entry.kind ?? entry.entryKind)?.trim().toLowerCase() ?? '';
}

function normalizedVendorEventType(value: string | null | undefined) {
  return value?.trim().toLowerCase().replaceAll('/', '.') ?? '';
}

function normalizedSummary(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}
