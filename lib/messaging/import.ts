/**
 * CSV contact import
 *
 * A spreadsheet is the most common way a small business gets its customer list wrong. This parser
 * therefore does the boring work in the open: it handles quoted fields and commas, guesses columns,
 * normalises and validates Kenyan phone numbers, finds duplicates inside the file and against the
 * tenant's existing contacts, and returns a preview with reasons. Consent is imported only when it
 * is explicitly present in the file and names its source; a phone number on its own is never
 * treated as permission to market.
 */

import { normalizeKePhone } from "../phone";

export type CsvRow = string[];
export type ParsedCsv = { headers: string[]; rows: CsvRow[]; errors: string[] };

export function parseCsv(text: string): ParsedCsv {
  const errors: string[] = [];
  const input = String(text ?? "").replace(/^\uFEFF/, "");
  const rows: CsvRow[] = [];
  let field = "";
  let row: CsvRow = [];
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (inQuotes) errors.push("The file ends inside a quoted field. Check the last row.");
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  if (rows.length === 0) return { headers: [], rows: [], errors: [...errors, "The file is empty."] };

  const headers = rows[0].map((header) => header.trim());
  if (headers.length > 30) errors.push("That file has too many columns.");
  const width = headers.length;
  const body = rows.slice(1).filter((values) => {
    if (values.length > width && values.slice(width).some((value) => value.trim() !== "")) {
      errors.push(`A row has more values than the header (${values.length} vs ${width}).`);
      return false;
    }
    return true;
  });
  return { headers, rows: body, errors };
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "customer", "customer name", "full name", "fullname", "contact", "client"],
  phone: ["phone", "mobile", "phone number", "msisdn", "tel", "telephone", "number", "contact phone"],
  email: ["email", "e-mail", "email address"],
  tags: ["tags", "tag", "group", "segment", "category"],
  consent: ["consent", "marketing consent", "opt in", "opt-in", "opted in", "subscribed"],
  consentSource: ["consent source", "source", "how did they consent", "opt in source"],
  location: ["location", "town", "city", "area"],
};

export function guessMapping(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  const normalized = headers.map((header) => header.trim().toLowerCase().replace(/[_-]+/g, " "));
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

export type ImportCandidate = {
  rowNumber: number;
  name: string | null;
  phone: string | null;
  phoneRaw: string;
  email: string | null;
  tags: string[];
  consent: boolean;
  consentSource: string | null;
};

export type ImportIssue = { rowNumber: number; phoneRaw: string; code: string; message: string };

export type ImportPreview = {
  headers: string[];
  mapping: Record<string, number>;
  candidates: ImportCandidate[];
  issues: ImportIssue[];
  duplicatesInFile: ImportIssue[];
  duplicatesExisting: ImportIssue[];
  consentGranted: number;
  totalRows: number;
  mapperWarnings: string[];
};

export function validateImportRows(input: {
  headers: string[];
  rows: CsvRow[];
  mapping: Record<string, number>;
  existingPhones: string[];
}): ImportPreview {
  const issues: ImportIssue[] = [];
  const duplicatesInFile: ImportIssue[] = [];
  const duplicatesExisting: ImportIssue[] = [];
  const candidates: ImportCandidate[] = [];
  const mapperWarnings: string[] = [];
  const existing = new Set(input.existingPhones.map(String));
  const seen = new Set<string>();

  if (input.mapping.phone === undefined) {
    mapperWarnings.push("We couldn't find a phone column. Choose which column holds the phone number.");
  }
  if (input.mapping.name === undefined) mapperWarnings.push("No name column found. Contacts will be saved as “Customer”.");
  if (input.mapping.consent === undefined) {
    mapperWarnings.push("No consent column found, so nobody will be marked as consented to marketing. You can add consent later.");
  }

  input.rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1
    const value = (field: string): string => {
      const column = input.mapping[field];
      return column === undefined ? "" : String(row[column] ?? "").trim();
    };
    const phoneRaw = value("phone");
    if (!phoneRaw && row.every((cell) => !String(cell).trim())) return;
    const phone = normalizeKePhone(phoneRaw);
    if (!phone) {
      issues.push({ rowNumber, phoneRaw, code: "INVALID_PHONE", message: "That phone number is not a valid Kenyan mobile number." });
      return;
    }
    if (seen.has(phone)) {
      duplicatesInFile.push({ rowNumber, phoneRaw, code: "DUPLICATE_IN_FILE", message: "The same phone number appears more than once in this file." });
      return;
    }
    if (existing.has(phone)) {
      duplicatesExisting.push({ rowNumber, phoneRaw, code: "EXISTS", message: "This phone number is already a contact. It will be skipped." });
      return;
    }
    seen.add(phone);

    const consentRaw = value("consent").toLowerCase();
    const consent = ["yes", "y", "true", "1", "opted in", "granted", "consented"].includes(consentRaw);
    const consentSource = value("consentSource") || (consent ? "CSV import" : null);
    if (consent && !consentSource) {
      issues.push({ rowNumber, phoneRaw, code: "CONSENT_SOURCE_MISSING", message: "Consent was marked but no source was given, so it was not recorded." });
    }

    candidates.push({
      rowNumber,
      name: value("name") || null,
      phone,
      phoneRaw,
      email: value("email") || null,
      tags: value("tags").split(/[;|]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 10),
      consent: consent && Boolean(consentSource),
      consentSource,
    });
  });

  return {
    headers: input.headers,
    mapping: input.mapping,
    candidates,
    issues,
    duplicatesInFile,
    duplicatesExisting,
    consentGranted: candidates.filter((candidate) => candidate.consent).length,
    totalRows: input.rows.length,
    mapperWarnings,
  };
}

export type ImportResult = {
  imported: number;
  skipped: number;
  rejected: number;
  consentRecorded: number;
  issues: ImportIssue[];
};

/**
 * Persist a preview. The tenant id is applied to every row; the unique (business, phone) index is
 * the final guard against a race with another import.
 */
export async function commitImport(
  client: any,
  input: { businessId: string; preview: ImportPreview; actorId?: string | null; source?: string },
): Promise<ImportResult> {
  let imported = 0;
  let skipped = 0;
  let rejected = 0;
  let consentRecorded = 0;
  const issues: ImportIssue[] = [...input.preview.issues, ...input.preview.duplicatesInFile, ...input.preview.duplicatesExisting];

  for (const candidate of input.preview.candidates) {
    try {
      const existing = await client.msgContact.findUnique({
        where: { businessId_phoneNormalized: { businessId: input.businessId, phoneNormalized: candidate.phone! } },
      }).catch(() => null);
      if (existing) {
        skipped += 1;
        continue;
      }
      const contact = await client.msgContact.create({
        data: {
          businessId: input.businessId,
          phoneNormalized: candidate.phone,
          name: candidate.name,
          email: candidate.email,
          tagsJson: JSON.stringify(candidate.tags),
          source: input.source ?? "CSV_IMPORT",
          status: "ACTIVE",
        },
      });
      imported += 1;
      if (candidate.consent && candidate.consentSource) {
        await client.msgConsentRecord.create({
          data: {
            businessId: input.businessId,
            contactId: contact.id,
            channel: "SMS",
            purpose: "MARKETING",
            granted: true,
            source: "IMPORT",
            wordingVersion: candidate.consentSource,
            evidenceJson: JSON.stringify({ rowNumber: candidate.rowNumber, importedFrom: input.source ?? "CSV_IMPORT" }),
            capturedById: input.actorId ?? null,
          },
        });
        consentRecorded += 1;
      }
    } catch (error: any) {
      if (error?.code === "P2002") {
        skipped += 1;
      } else {
        rejected += 1;
        issues.push({ rowNumber: candidate.rowNumber, phoneRaw: candidate.phoneRaw, code: "SAVE_FAILED", message: "This row could not be saved." });
      }
    }
  }

  return { imported, skipped, rejected, consentRecorded, issues };
}

/** The downloadable template. Includes an explicit consent column and its source. */
export const IMPORT_TEMPLATE_CSV = [
  "name,phone,email,tags,consent,consent source",
  "Jane Wanjiku,0712345678,jane@example.com,VIP;Nairobi,yes,In-store sign-up form v2 (12 Oct 2026)",
  "Peter Otieno,0723456789,,Wholesale,no,",
].join("\n");
