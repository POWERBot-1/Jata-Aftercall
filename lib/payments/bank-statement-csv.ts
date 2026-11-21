/**
 * Strict canonical CSV reader for bank-credit evidence.
 *
 * This is a parser/validator only. It does not store files, statements, bank account details or
 * financial postings. Bank-specific exports must first be mapped by an operator into this narrow
 * canonical schema; raw narration and account identifiers are intentionally excluded.
 */

export type CanonicalBankCredit = {
  statementLineId: string;
  bookingDate: string;
  reference: string;
  currency: string;
  creditMinor: number;
};

export type BankStatementCsvResult = {
  rows: CanonicalBankCredit[];
  rejectedRows: 0;
  sourceBytes: number;
};

export type BankStatementCsvErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "TOO_MANY_ROWS"
  | "INVALID_CSV"
  | "INVALID_HEADER"
  | "INVALID_ROW_WIDTH"
  | "INVALID_STATEMENT_LINE_ID"
  | "DUPLICATE_STATEMENT_LINE_ID"
  | "INVALID_BOOKING_DATE"
  | "INVALID_REFERENCE"
  | "INVALID_CURRENCY"
  | "INVALID_CREDIT_AMOUNT";

export class BankStatementCsvError extends Error {
  constructor(readonly code: BankStatementCsvErrorCode, readonly rowNumber?: number) {
    super(code);
    this.name = "BankStatementCsvError";
  }
}

const EXPECTED_HEADER = [
  "statement_line_id",
  "booking_date",
  "reference",
  "currency",
  "credit_minor",
] as const;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (closedQuote && char !== "," && char !== "\n" && char !== "\r" && char !== " " && char !== "\t") {
      throw new BankStatementCsvError("INVALID_CSV");
    }
    if (char === '"' && field.length === 0 && !closedQuote) {
      quoted = true;
    } else if (char === "," ) {
      row.push(field);
      field = "";
      closedQuote = false;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      field = "";
      closedQuote = false;
    } else {
      if (closedQuote) throw new BankStatementCsvError("INVALID_CSV");
      field += char;
    }
  }

  if (quoted) throw new BankStatementCsvError("INVALID_CSV");
  if (field.length > 0 || row.length > 0 || closedQuote) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}

function validBookingDate(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(trimmed)) {
    return null;
  }
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (trimmed.length === 10 && parsed.toISOString().slice(0, 10) !== trimmed) return null;
  return parsed.toISOString();
}

/** Parse the exact canonical credit-only CSV format. Any invalid row rejects the entire file. */
export function parseCanonicalBankStatementCsv(input: string): BankStatementCsvResult {
  if (typeof input !== "string" || input.length === 0) throw new BankStatementCsvError("EMPTY_FILE");
  const sourceBytes = new TextEncoder().encode(input).byteLength;
  if (sourceBytes > MAX_BYTES) throw new BankStatementCsvError("FILE_TOO_LARGE");

  const normalized = input.replace(/^\uFEFF/, "");
  const parsed = parseCsv(normalized);
  if (parsed.length < 2) throw new BankStatementCsvError("EMPTY_FILE");
  if (parsed.length - 1 > MAX_ROWS) throw new BankStatementCsvError("TOO_MANY_ROWS");

  const header = parsed[0].map((value) => value.trim().toLowerCase());
  if (header.length !== EXPECTED_HEADER.length || EXPECTED_HEADER.some((name, index) => header[index] !== name)) {
    throw new BankStatementCsvError("INVALID_HEADER", 1);
  }

  const seenIds = new Set<string>();
  const rows: CanonicalBankCredit[] = [];
  for (let index = 1; index < parsed.length; index += 1) {
    const values = parsed[index];
    const rowNumber = index + 1;
    if (values.length !== EXPECTED_HEADER.length) throw new BankStatementCsvError("INVALID_ROW_WIDTH", rowNumber);

    const [rawId, rawDate, rawReference, rawCurrency, rawCredit] = values.map((value) => value.trim());
    if (!rawId || rawId.length > 128 || /[\u0000-\u001f\u007f]/.test(rawId)) {
      throw new BankStatementCsvError("INVALID_STATEMENT_LINE_ID", rowNumber);
    }
    if (seenIds.has(rawId)) throw new BankStatementCsvError("DUPLICATE_STATEMENT_LINE_ID", rowNumber);
    seenIds.add(rawId);

    const bookingDate = validBookingDate(rawDate);
    if (!bookingDate) throw new BankStatementCsvError("INVALID_BOOKING_DATE", rowNumber);
    if (!rawReference || rawReference.length > 128 || /[\u0000-\u001f\u007f]/.test(rawReference)) {
      throw new BankStatementCsvError("INVALID_REFERENCE", rowNumber);
    }
    if (!/^[A-Za-z]{3}$/.test(rawCurrency)) throw new BankStatementCsvError("INVALID_CURRENCY", rowNumber);
    if (!/^\d+$/.test(rawCredit)) throw new BankStatementCsvError("INVALID_CREDIT_AMOUNT", rowNumber);
    const creditMinor = Number(rawCredit);
    if (!Number.isSafeInteger(creditMinor) || creditMinor <= 0) {
      throw new BankStatementCsvError("INVALID_CREDIT_AMOUNT", rowNumber);
    }

    rows.push({
      statementLineId: rawId,
      bookingDate,
      reference: rawReference,
      currency: rawCurrency.toUpperCase(),
      creditMinor,
    });
  }

  return { rows, rejectedRows: 0, sourceBytes };
}
