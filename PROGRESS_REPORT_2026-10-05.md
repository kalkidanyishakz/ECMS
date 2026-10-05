# ECMS Progress Report
## Engineering & Construction Management System

**Reporting period:** 5 September 2026 to 5 October 2026

**Prepared for:** Contractor client, commercial and project controls leadership

**Date of issue:** 5 October 2026

**Prepared by:** ECMS delivery team

---

## 1. Executive Summary

This reporting period closes the single largest gap in the system to date: the commercial control loop that runs from measured work through to payment is now complete and usable on screen.

The previous period delivered the in-app AI project assistant (a streaming chat that can read project data but not change it, within the permissions of the person asking). That assistant remained advisory only. What was missing was the spine of the commercial process itself.

During September and early October we delivered that spine. A quantity surveyor can now assemble an Interim Payment Certificate (IPC) from verified measurement lines, apply contract deductions, certify the certificate, and record the payment. A measurement team can capture field quantities and have them independently verified and accepted. Registers for procurement, variations, and stock are no longer read-only: records can be created, moved through their lifecycle, and audited back to source.

Supporting modules that were previously missing from the field and quality side of the system (RFIs, inspections, attendance, daywork, and transmittals) now have both the application programming interfaces (APIs, the system's back-end connections that let the different screens talk to the database) and the forms to go with them.

The release is substantial but controlled. It changes 110 files, adds 7,384 lines of code, and introduces 41 new files with none deleted. All four automated test suites run green, with 69 of 69 tests passing. Those tests cover the core money calculations and the assistant's behaviour, which is our evidence that the arithmetic behind certificates is correct and repeatable.

The work is demonstrated on a realistic contract: the Jigjiga Bypass Road, a 6.93 km FIDIC unit-price road, with a priced Bill of Quantities (BOQ) of 31 line items across six work sections and a contract value of approximately ETB 327,628,500.

In plain terms: the office can now do on screen what the commercial team has always done on paper, with the added benefit of an audit trail, enforced approval steps, and separation of duties.

---

## 2. Where We Were at the Start of the Period

At the baseline date of 4 September 2026, the in-app AI project assistant had just been handed over. It offered a streaming chat experience and a set of permission-gated, read-only tools. In other words, it could answer questions about project data but could not alter any commercial value.

Everything that follows should be read as the delivery of the transactional core that the assistant was always meant to sit on top of.

---

## 3. Scale of Work

| Measure | This period |
|---|---|
| Files changed | 110 |
| Lines of code added | 7,384 |
| New files | 41 |
| Files deleted | 0 |
| Automated test suites | 4 |
| Tests passing | 69 of 69 |

The test count is not a technical vanity number. It is the evidence that the certificate calculations and the assistant behave as specified. Every commercial figure the system produces depends on that arithmetic being right.

---

## 4. What Was Delivered

### 4.1 Interim Payment Certificate (IPC) workflow, end to end

The IPC is now fully usable on screen, from assembly to payment. The steps are:

1. **Assemble the certificate.** Select the verified measurement lines to be paid.
2. **Calculate the certificate.** The system computes the certificate from the selected lines.
3. **Add typed adjustments.** Each adjustment is a named type and is linked to a contract clause. The types are retention, advance recovery, VAT split, price adjustment, withholding tax, and other.
4. **Record materials on site.**
5. **Certify the certificate.**
6. **Record the payment.**

The status flow is enforced by the system, not left to convention:

| Stage | Meaning |
|---|---|
| draft | Being assembled, not yet issued |
| submitted | Issued to the engineer |
| under review | Being examined by the engineer |
| recommended | Recommended for certification |
| certified | Certified for payment |
| paid | Payment recorded |

Once a certificate reaches **certified**, it is locked. No silent edits are possible afterwards. If something must change, the change is visible as a new, traceable action rather than an overwrite of history.

### 4.2 Field measurements: the re-measurement loop

The system now supports the full re-measurement cycle, which is the discipline that keeps unit-price contracts honest.

- The **entry screen** records quantities against each BOQ item, with the date, location, chainage, and attachments.
- The line is then **submitted for review**.
- An **independent verifier** reviews the submitted quantities and records the **accepted** quantities through a "Verify & Accept" step.

This preserves the separation that matters commercially: the quantity that is *measured* and the quantity that is *accepted and payable* are two separate, independently controlled acts performed by different people. Neither person can quietly become the other.

### 4.3 Registers made actionable

The registers are the system's log books. They are no longer report-only. Records can now be created and progressed through their lifecycle:

- **Procurement chain:** requisitions, then purchase orders, then goods received notes (a new API was added), then supplier invoices.
- **Variations register.**
- **Stock counts register.**

This turns the procurement chain into a traceable sequence rather than a set of disconnected documents.

### 4.4 Field, quality, and workforce modules completed

The following modules, previously missing or incomplete, now have create APIs and matching forms:

- RFIs (requests for information)
- Inspections
- Attendance
- Daywork
- Transmittals

Taken together, these are the everyday records that a site produces and that feed claims, valuations, and disputes.

### 4.5 Documents

- Local file upload storage is in place.
- Document revision history is recorded.
- Superseded-revision control is enforced, so an old revision cannot be mistaken for the current one.

### 4.6 BOQ import pipeline

Approved BOQs rarely arrive in a convenient format. The import pipeline handles that:

- Accepts Excel (.xlsx) or CSV uploads.
- Maps the columns automatically, with a manual override when the automatic guess is wrong.
- Validates the rows before anything is committed.
- Commits the import in a staged manner with row-level lineage, so every imported line can be traced back to its source row.

The import uses "savepoints", a database safety mechanism. In practice this means a failed import will not corrupt data that was already committed. The import is safe to retry rather than a one-shot gamble.

### 4.7 Supplier quotes

Supplier quote capture is supported, and quotes can be compared side by side.

### 4.8 Reporting and export

Four reporting views can be exported to CSV:

| View | What it shows |
|---|---|
| Contract commercial position | Where the contract stands commercially |
| Three money streams | The three streams of money movement |
| Open exceptions | Items still unresolved or flagged |
| Labour cost by work package | Labour cost split across work packages |

Note on formats: Excel is only an import and export format. The system of record is the database.

### 4.9 Global search

Search across the system is available from a single place.

### 4.10 Notifications

A notification bell is in place, with read and unread APIs. Notifications are driven by a reliable outbox mechanism, meaning the system records what must be sent and delivers from that record rather than relying on a fragile live call.

### 4.11 Administration, roles, and separation of duties

Administrators can invite users, assign roles, and manage organizations.

Roles are **project assignments**, not global labels. A person can be the consultant quantity surveyor on one project and a viewer on another. The same person carries different authority in different contexts, which mirrors how real project teams are staffed.

Segregation of duties is enforced in the system:

- A contractor cannot certify its own IPC.
- A requester cannot approve their own request.
- A certifier cannot record the corresponding payment.

These are controls, not guidelines. The system will not let a single person complete both sides of a control point.

---

## 5. Problems Found and Fixed

Engineering quality this period was largely about finding and closing integrity gaps before they could affect commercial data:

- Fixed database **search_path** handling used by the automated rules (triggers). Triggers are the database's automatic rules that fire when data changes; pointing them at the wrong location could break that behaviour. This is now corrected.
- Fixed **IPC locking**, so a certificate is genuinely locked once certified.
- Fixed **large-number (BigInt) data serialisation**, so very large figures are transmitted and displayed correctly rather than being corrupted in passage.
- Made **BOQ imports safe to retry** by using savepoints.

Each of these is the kind of problem that, left alone, produces a wrong number at the wrong time. They were found and closed within the period.

---

## 6. Demonstration Project

The capabilities above are demonstrated on a concrete contract rather than described in the abstract.

- **Project:** "Jigjiga Bypass Road"
- **Description:** a 6.93 km FIDIC unit-price road contract
- **Employer:** ERA
- **Contractor:** Yirgalem Construction
- **Engineer:** ELDA/DAMRA

**Priced BOQ:** 31 line items across six work sections, total contract value approximately ETB 327,628,500.

| Work section |
|---|
| General Earthworks |
| Pavement Works |
| Drainage Structures |
| Structures |
| Road Furniture and Traffic |
| Environmental and Miscellaneous |

**Seeded supporting data:** 3 work packages, 2 site sections/locations, 2 warehouses, a worker roster, a sample measurement, and a draft IPC #1.

**Demonstration logins:**

| Role | Name |
|---|---|
| Project Manager | Amina Yusuf |
| Site Supervisor | Dawit Bekele |
| Storekeeper | Hanna Girma |
| Finance Officer | Yonas Tesfaye |

The deployment is packaged so it can run via Docker (with a Dockerfile, docker-compose configuration, and a startup entrypoint), which means the demonstration is reproducible rather than dependent on a particular machine.

---

## 7. How This Maps to the Contract Loop

The value of this period is best understood as one complete commercial-control loop that now runs end to end:

**project and contract setup** -> **import approved BOQ** -> **record measured work** -> **independently accept quantities** -> **assemble IPC** -> **apply contract deductions** -> **certify** -> **record payment**

Each step hands off to the next with a record of who did what and when, and every commercial figure can be traced back to its source data. The separation of duties described earlier sits across the whole loop, so no single person can both create and approve a value.

This is the point at which the system moves from a reporting tool to a system of record for the commercial process.

---

## 8. What's Next / Open Items

We are stating these honestly rather than overclaiming:

- In the demonstration, **draft IPC #1 is a shell**. It is intended to be populated by running the calculate step from real measurement data. The workflow is complete; the demonstration data simply has not been run through the full calculate step yet.
- The following items are **explicitly deferred to a later phase**:
  - Full scheduling (Primavera / MS Project)
  - Full general ledger and accounting
  - Tendering marketplace
  - Fleet telematics
  - Plant maintenance
  - BIM / IFC authoring
  - Native mobile and offline applications
  - No-code workflow design
  - AI acting as an autonomous contractual decision-maker

On that last point, and to be clear: the AI remains **advisory only**. A human approves every contractual value. The assistant can read and advise, but it cannot commit a commercial figure on its own.

---

## 9. Glossary of Technical Terms

Plain-language definitions of the terms used in this report.

- **API (application programming interface):** the back-end connection that lets one part of the system talk to another, or lets a screen fetch and save data. Think of it as the service counter between the screen and the database.
- **Audit trail:** an automatic record of who did what and when. It lets you reconstruct any commercial figure back to its origin.
- **BigInt (large-number) serialisation:** the correct handling of very large numbers when they are passed between parts of the system. Getting this wrong silently corrupts big figures.
- **BOQ (Bill of Quantities):** the priced schedule of measured items that forms the commercial basis of a unit-price contract.
- **Chainage:** distance measured along the road alignment, used to locate work.
- **CSV:** a plain spreadsheet-style text file used for import and export.
- **Docker:** a packaging method that lets the system run on any suitable machine in a repeatable way.
- **IPC (Interim Payment Certificate):** the periodic certificate of work done, used to claim and record payment.
- **Outbox:** a reliable delivery mechanism. The system first saves the notification it intends to send, then sends from that saved record, so nothing is lost if a live call fails.
- **Register:** the system's log book for a class of records, such as variations, purchases, or stock.
- **Retention:** money withheld from each payment and released later, per the contract.
- **Advance recovery:** repayment of a mobilisation advance deducted from certificates.
- **RFI (request for information):** a formal question raised on site, usually seeking clarification.
- **Savepoint:** a database safety marker. Work done after a savepoint can be rolled back on failure without damaging data committed before it, which makes imports safe to retry.
- **search_path:** a database setting that controls where the automatic rules (triggers) look for the objects they depend on. Pointing it at the wrong place can break those rules.
- **Segregation of duties:** the control principle that the person who creates a value should not be the person who approves or pays it.
- **Trigger:** an automatic database rule that runs when certain data changes.
- **VAT split:** separating the value-added tax component from the base amount on a certificate.
- **Withholding tax:** tax deducted at source from a payment as required by the contract or law.

---

## 10. Appendix: Release Reference

The single release during the reporting period is:

| Item | Detail |
|---|---|
| Release reference | commit d8006ab |
| Release date | 5 October 2026 |
| Release title | feat: complete ECMS demo — IPC/measurement workflows, registers, imports, search, admin |
| Files changed | 110 |
| Lines of code added | 7,384 |
| New files | 41 |
| Files deleted | 0 |
| Automated test suites | 4 |
| Tests passing | 69 of 69 |

**Baseline:** as of 4 September 2026, the in-app AI project assistant had just been delivered (streaming chat with permission-gated read-only tools).

This is the only release in the window, and it is the source of every capability described in Sections 4 through 7.

---

*End of report.*
