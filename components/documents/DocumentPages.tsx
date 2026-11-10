'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconFileText, IconSearch, IconX } from '@tabler/icons-react';
import type { DocumentPageRow } from '@/lib/documents/pages';

type Props = {
  documentId: string;
  initialPages: DocumentPageRow[];
};

const inputCls =
  'rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text w-48';

function PageText({ page }: { page: DocumentPageRow }) {
  if (!page.text) {
    return <span className="text-xs italic text-ecms-muted">No extracted text</span>;
  }
  const isTruncated = page.text.length > page.snippet.length;
  if (!isTruncated) {
    return <span className="text-xs text-ecms-text">{page.snippet}</span>;
  }
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-ecms-text">{page.snippet}</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ecms-bg p-3 text-ecms-muted">
        {page.text}
      </pre>
    </details>
  );
}

export function DocumentPages({ documentId, initialPages }: Props) {
  const [pages, setPages] = useState<DocumentPageRow[]>(initialPages);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(term: string) {
    setLoading(true);
    setError(null);
    try {
      const suffix = term.trim() ? `?q=${encodeURIComponent(term.trim())}` : '';
      const res = await fetch(`/api/v1/documents/${documentId}/pages${suffix}`);
      const data = (await res.json().catch(() => ({}))) as {
        pages?: DocumentPageRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
      setPages(data.pages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    void search(query);
  }

  function handleClear() {
    setQuery('');
    void search('');
  }

  return (
    <Card
      title="Pages"
      subtitle={`${pages.length} page${pages.length === 1 ? '' : 's'}`}
      icon={<IconFileText size={18} />}
      actions={
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search page text…"
            className={inputCls}
            aria-label="Search page text"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg bg-ecms-elevated px-3 py-1.5 text-sm font-semibold text-ecms-text hover:bg-ecms-elevated/70 disabled:opacity-50"
          >
            <IconSearch size={15} />
            {loading ? 'Searching…' : 'Search'}
          </button>
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex items-center gap-1 rounded-lg border border-ecms-border px-2 py-1.5 text-xs text-ecms-muted hover:text-ecms-text"
            >
              <IconX size={14} />
              Clear
            </button>
          )}
        </form>
      }
    >
      {error && <p className="mb-3 text-xs text-ecms-danger">{error}</p>}

      {pages.length === 0 ? (
        <EmptyState
          title="No pages"
          message={
            query
              ? 'No pages matched this search.'
              : 'Extracted pages appear here once OCR has processed a revision.'
          }
        />
      ) : (
        <Table>
          <THead>
            <TH>Revision</TH>
            <TH className="text-right">Page</TH>
            <TH>Extracted text</TH>
            <TH>Preview</TH>
          </THead>
          <TBody>
            {pages.map((page) => (
              <TR key={page.id} className="hover:bg-ecms-elevated/40">
                <TD className="font-medium">{page.revisionNumber || '—'}</TD>
                <TD className="text-right text-ecms-muted">{page.pageNumber}</TD>
                <TD className="max-w-[520px]">
                  <PageText page={page} />
                </TD>
                <TD>
                  {page.previewUrl ? (
                    <a
                      href={page.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-ecms-amber hover:underline"
                    >
                      Preview
                    </a>
                  ) : (
                    <span className="text-xs text-ecms-muted">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}
