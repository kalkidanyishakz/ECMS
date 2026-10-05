import { Card } from '@/components/ui/Card';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/Table';
import { StatusPill } from '@/components/ui/StatusPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconClipboardList, IconPlus } from '@tabler/icons-react';
import { db } from '@/lib/db';
import { requireAppUser, hasPermission } from '@/lib/server/session';
import { getProjectContext } from '@/lib/server/context';
import { money, num, date } from '@/lib/format';

export const dynamic = 'force-dynamic';

type ActionTone = 'amber' | 'success' | 'danger';

function QuoteAction({
  quoteId,
  status,
  label,
  tone = 'amber',
}: {
  quoteId: string;
  status: string;
  label: string;
  tone?: ActionTone;
}) {
  const toneClass =
    tone === 'success'
      ? 'bg-ecms-success/90 text-white hover:bg-ecms-success'
      : tone === 'danger'
        ? 'bg-ecms-danger/90 text-white hover:bg-ecms-danger'
        : 'bg-ecms-amber/90 text-ecms-navy hover:bg-ecms-amber';
  return (
    <form method="POST" action={`/api/v1/supplier-quotes/${quoteId}`} className="inline">
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="redirect_to" value="/procurement/quotes" />
      <button type="submit" className={`rounded-md px-2.5 py-1 text-xs font-semibold ${toneClass}`}>
        {label}
      </button>
    </form>
  );
}

export default async function SupplierQuotesPage() {
  await requireAppUser();
  const { tenantId, projectId } = await getProjectContext();

  const [quotes, requisitions, suppliers, canOrder, canApprove] = await Promise.all([
    db.supplier_quotes.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      orderBy: { created_at: 'desc' },
      include: {
        suppliers: {
          select: {
            supplier_code: true,
            organizations: { select: { legal_name: true, short_name: true } },
          },
        },
        app_users: { select: { display_name: true } },
        supplier_quote_lines: { orderBy: { line_number: 'asc' } },
      },
    }),
    db.purchase_requisitions.findMany({
      where: projectId ? { project_id: projectId } : { projects: { tenant_id: tenantId } },
      orderBy: { created_at: 'desc' },
      include: {
        purchase_requisition_lines: { orderBy: { line_number: 'asc' } },
      },
    }),
    db.suppliers.findMany({
      where: { status: 'approved', tenant_id: tenantId },
      orderBy: { supplier_code: 'asc' },
      include: { organizations: { select: { legal_name: true } } },
    }),
    hasPermission('procurement.order', { projectId }),
    hasPermission('procurement.approve', { projectId }),
  ]);

  const creatableReqs = requisitions.filter(
    (r) => r.status === 'approved' && r.purchase_requisition_lines.length > 0
  );

  const quotesByReq = new Map<string, typeof quotes>();
  for (const q of quotes) {
    const list = quotesByReq.get(q.requisition_id) ?? [];
    list.push(q);
    quotesByReq.set(q.requisition_id, list);
  }

  const reqById = new Map(requisitions.map((r) => [r.id, r]));
  const comparisonGroups: Array<{
    requisition: (typeof requisitions)[number];
    quotes: typeof quotes;
  }> = [];
  for (const [reqId, groupQuotes] of quotesByReq) {
    const requisition = reqById.get(reqId);
    if (requisition) comparisonGroups.push({ requisition, quotes: groupQuotes });
  }

  const nextQuoteNumber = `Q-${String(quotes.length + 1).padStart(4, '0')}`;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader title="Supplier Quotes & Comparison" />

      {canOrder && (
        <Card title="New Supplier Quote" icon={<IconClipboardList size={18} />}>
          <form
            method="POST"
            action="/api/v1/supplier-quotes"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <input type="hidden" name="redirect_to" value="/procurement/quotes" />
            <select
              name="requisition_id"
              required
              className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
            >
              <option value="">Approved requisition…</option>
              {creatableReqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.requisition_number} — {r.purpose}
                </option>
              ))}
            </select>
            <select
              name="supplier_id"
              required
              className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
            >
              <option value="">Supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.supplier_code} — {s.organizations.legal_name}
                </option>
              ))}
            </select>
            <input
              name="quote_number"
              required
              defaultValue={nextQuoteNumber}
              className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
              placeholder="Quote number"
            />
            <input
              name="quote_date"
              type="date"
              required
              defaultValue={today}
              className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
            />
            <input
              name="valid_until"
              type="date"
              className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
            />
            <input
              name="delivery_days"
              type="number"
              min="0"
              className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
              placeholder="Delivery days"
            />
            <input
              name="payment_terms"
              className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
              placeholder="Payment terms"
            />
            <input
              name="tax_amount"
              type="number"
              step="0.01"
              min="0"
              className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
              placeholder="Tax amount"
            />
            <div className="sm:col-span-2 lg:col-span-1 flex items-end">
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90"
              >
                <IconPlus size={16} /> Capture Quote
              </button>
            </div>
          </form>
          {creatableReqs.length === 0 && (
            <p className="mt-2 text-xs text-ecms-muted">
              Approve a requisition with lines before capturing supplier quotes.
            </p>
          )}
        </Card>
      )}

      {comparisonGroups.length === 0 ? (
        <Card>
          <EmptyState
            title="No supplier quotes"
            message="Capture quotes against approved requisitions to compare supplier pricing here."
          />
        </Card>
      ) : (
        comparisonGroups.map(({ requisition, quotes: groupQuotes }) => {
          const totals = groupQuotes.map((q) => Number(q.total_amount));
          const lowestTotal = Math.min(...totals);

          return (
            <Card
              key={requisition.id}
              title={`${requisition.requisition_number} — ${requisition.purpose}`}
              subtitle={`${requisition.purchase_requisition_lines.length} item(s) · ${groupQuotes.length} quote(s)`}
              icon={<IconClipboardList size={18} />}
              bodyClassName="flex flex-col gap-5"
            >
              <Table>
                <THead>
                  <TH>Supplier</TH>
                  <TH>Quote #</TH>
                  <TH>Date</TH>
                  <TH>Delivery</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Tax</TH>
                  <TH className="text-right">Total</TH>
                  {(canOrder || canApprove) && <TH className="text-right">Actions</TH>}
                </THead>
                <TBody>
                  {groupQuotes.map((q) => {
                    const isLowest = Number(q.total_amount) === lowestTotal;
                    return (
                      <TR key={q.id} className="hover:bg-ecms-elevated/40">
                        <TD className="font-medium">
                          {q.suppliers.organizations.short_name ||
                            q.suppliers.organizations.legal_name}
                        </TD>
                        <TD className="text-ecms-muted">{q.quote_number}</TD>
                        <TD>{date(q.quote_date)}</TD>
                        <TD className="text-ecms-muted">
                          {q.delivery_days == null ? '—' : `${q.delivery_days} days`}
                        </TD>
                        <TD>
                          <StatusPill status={q.status} />
                        </TD>
                        <TD className="text-right text-ecms-muted">
                          {money(Number(q.tax_amount), q.currency)}
                        </TD>
                        <TD
                          className={`text-right font-medium ${
                            isLowest && groupQuotes.length > 1 ? 'text-ecms-amber' : ''
                          }`}
                        >
                          {money(Number(q.total_amount), q.currency)}
                          {isLowest && groupQuotes.length > 1 && (
                            <span className="ml-1 text-xs">(lowest)</span>
                          )}
                        </TD>
                        {(canOrder || canApprove) && (
                          <TD className="text-right">
                            <span className="inline-flex flex-wrap justify-end gap-1.5">
                              {q.status === 'received' && canOrder && (
                                <QuoteAction quoteId={q.id} status="evaluated" label="Evaluate" />
                              )}
                              {q.status === 'received' && canOrder && (
                                <QuoteAction
                                  quoteId={q.id}
                                  status="clarification"
                                  label="Clarify"
                                />
                              )}
                              {(q.status === 'received' || q.status === 'clarification') &&
                                canOrder && (
                                  <QuoteAction
                                    quoteId={q.id}
                                    status="withdrawn"
                                    label="Withdraw"
                                    tone="danger"
                                  />
                                )}
                              {q.status === 'evaluated' && canApprove && (
                                <QuoteAction
                                  quoteId={q.id}
                                  status="selected"
                                  label="Select"
                                  tone="success"
                                />
                              )}
                              {q.status === 'evaluated' && canApprove && (
                                <QuoteAction
                                  quoteId={q.id}
                                  status="not_selected"
                                  label="Not selected"
                                  tone="danger"
                                />
                              )}
                            </span>
                          </TD>
                        )}
                      </TR>
                    );
                  })}
                </TBody>
              </Table>

              {requisition.purchase_requisition_lines.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-ecms-text">Item Price Comparison</h3>
                  <Table>
                    <THead>
                      <TH>Item</TH>
                      <TH>Qty / Unit</TH>
                      {groupQuotes.map((q) => (
                        <TH key={q.id} className="text-right">
                          {q.suppliers.organizations.short_name ||
                            q.suppliers.organizations.legal_name}
                        </TH>
                      ))}
                    </THead>
                    <TBody>
                      {requisition.purchase_requisition_lines.map((line) => {
                        const prices = groupQuotes
                          .map((q) => {
                            const ql = q.supplier_quote_lines.find(
                              (l) => l.requisition_line_id === line.id
                            );
                            return ql ? Number(ql.unit_price) : null;
                          })
                          .filter((n): n is number => n !== null);
                        const lowestUnit = prices.length > 0 ? Math.min(...prices) : null;

                        return (
                          <TR key={line.id} className="hover:bg-ecms-elevated/40">
                            <TD>
                              <span className="text-ecms-muted">{line.line_number}.</span>{' '}
                              {line.description}
                            </TD>
                            <TD className="text-ecms-muted">
                              {num(Number(line.requested_quantity))} {line.unit}
                            </TD>
                            {groupQuotes.map((q) => {
                              const ql = q.supplier_quote_lines.find(
                                (l) => l.requisition_line_id === line.id
                              );
                              if (!ql) {
                                return (
                                  <TD key={q.id} className="text-right text-ecms-muted">
                                    —
                                  </TD>
                                );
                              }
                              const unitPrice = Number(ql.unit_price);
                              const isLowest =
                                lowestUnit !== null && prices.length > 1 && unitPrice === lowestUnit;
                              return (
                                <TD
                                  key={q.id}
                                  className={`text-right ${isLowest ? 'font-semibold text-ecms-amber' : ''}`}
                                >
                                  {money(unitPrice, q.currency)}
                                  <span className="block text-xs text-ecms-muted">
                                    {money(Number(ql.line_amount), q.currency)}
                                  </span>
                                </TD>
                              );
                            })}
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </div>
              )}

              {canOrder && (
                <div className="flex flex-col gap-3">
                  {groupQuotes.map((q) => {
                    const quotedLineIds = new Set(
                      q.supplier_quote_lines.map((l) => l.requisition_line_id)
                    );
                    const availableLines = requisition.purchase_requisition_lines.filter(
                      (l) => !quotedLineIds.has(l.id)
                    );
                    if (availableLines.length === 0) return null;
                    return (
                      <details key={q.id} className="rounded-lg border border-ecms-border bg-ecms-bg/40">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-ecms-text">
                          Add line to {q.suppliers.organizations.short_name ||
                            q.suppliers.organizations.legal_name}{' '}
                          ({q.quote_number})
                        </summary>
                        <form
                          method="POST"
                          action={`/api/v1/supplier-quotes/${q.id}/lines`}
                          className="grid grid-cols-1 gap-3 border-t border-ecms-border p-3 sm:grid-cols-2 lg:grid-cols-5"
                        >
                          <input
                            type="hidden"
                            name="redirect_to"
                            value="/procurement/quotes"
                          />
                          <select
                            name="requisition_line_id"
                            required
                            className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
                          >
                            <option value="">Requisition line…</option>
                            {availableLines.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.line_number}. {l.description}
                              </option>
                            ))}
                          </select>
                          <input
                            name="unit_price"
                            type="number"
                            step="0.000001"
                            min="0"
                            required
                            className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
                            placeholder="Unit price"
                          />
                          <input
                            name="tax_percent"
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            defaultValue="0"
                            className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
                            placeholder="Tax %"
                          />
                          <select
                            name="complies"
                            className="rounded-lg border border-ecms-border bg-ecms-bg px-3 py-1.5 text-sm text-ecms-text"
                          >
                            <option value="">Complies?</option>
                            <option value="yes">Complies</option>
                            <option value="no">Deviation</option>
                          </select>
                          <button
                            type="submit"
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ecms-amber px-3 py-1.5 text-sm font-semibold text-ecms-navy hover:bg-ecms-amber/90"
                          >
                            <IconPlus size={16} /> Add Line
                          </button>
                        </form>
                      </details>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
