'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconSearch, IconLoader2 } from '@tabler/icons-react';

type SearchResult = {
  type: string;
  label: string;
  sublabel: string | null;
  href: string;
};

export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) router.push(`/reports?q=${encodeURIComponent(q)}`);
  }

  useEffect(() => {
    const q = query.trim();
    if (!q) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = await res.json();
          setResults(data.results ?? []);
          setOpen(true);
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative hidden md:block">
      <form onSubmit={handleSubmit}>
        <IconSearch
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ecms-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            const value = e.target.value;
            setQuery(value);
            if (value.trim()) {
              setLoading(true);
            } else {
              setResults([]);
              setOpen(false);
              setLoading(false);
            }
          }}
          onFocus={() => query.trim() && results.length > 0 && setOpen(true)}
          placeholder="Search…"
          className="h-8 w-48 rounded-lg border border-ecms-border bg-ecms-elevated pl-9 pr-3 text-xs text-ecms-text placeholder:text-ecms-muted/60 focus:w-64 focus:border-ecms-amber/60 focus:outline-none transition-all"
        />
        {loading && (
          <IconLoader2
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ecms-muted"
          />
        )}
      </form>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-ecms-border bg-ecms-card shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-ecms-muted">No results found.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-ecms-border overflow-auto">
              {results.map((result, index) => (
                <li key={`${result.type}-${result.href}-${index}`}>
                  <Link
                    href={result.href}
                    onClick={() => setOpen(false)}
                    className="flex flex-col gap-0.5 px-3 py-2 hover:bg-ecms-elevated"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-ecms-text">
                        {result.label}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-ecms-amber">
                        {result.type}
                      </span>
                    </span>
                    {result.sublabel && (
                      <span className="truncate text-[11px] text-ecms-muted">
                        {result.sublabel}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
