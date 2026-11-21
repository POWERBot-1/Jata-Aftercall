import { describe, expect, it } from "vitest";
import {
  BankStatementCsvError,
  parseCanonicalBankStatementCsv,
} from "@/lib/payments/bank-statement-csv";

const header = "statement_line_id,booking_date,reference,currency,credit_minor";

describe("parseCanonicalBankStatementCsv", () => {
  it("parses canonical credit rows and normalizes currency/date", () => {
    const result = parseCanonicalBankStatementCsv(
      `\uFEFF${header}\r\nline-1,2026-11-20,STL-001,kes,98500\r\nline-2,2026-11-21T08:30:00+03:00,"Ref, with comma",KES,10000\r\n`,
    );

    expect(result.rejectedRows).toBe(0);
    expect(result.rows).toEqual([
      {
        statementLineId: "line-1",
        bookingDate: "2026-11-20T00:00:00.000Z",
        reference: "STL-001",
        currency: "KES",
        creditMinor: 98_500,
      },
      {
        statementLineId: "line-2",
        bookingDate: "2026-11-21T05:30:00.000Z",
        reference: "Ref, with comma",
        currency: "KES",
        creditMinor: 10_000,
      },
    ]);
    expect(result.sourceBytes).toBeGreaterThan(0);
  });

  it("supports escaped quotes in a reference without exposing other columns", () => {
    const result = parseCanonicalBankStatementCsv(
      `${header}\nline-1,2026-11-20,"Ref ""A""",KES,500\n`,
    );
    expect(result.rows[0].reference).toBe('Ref "A"');
  });

  it("rejects any invalid row as a whole-file failure", () => {
    const cases = [
      ["line-1,2026-11-20,REF,KES,10,EXTRA", "INVALID_ROW_WIDTH"],
      ["line-1,2026-02-30,REF,KES,10", "INVALID_BOOKING_DATE"],
      ["line-1,2026-11-20,,KES,10", "INVALID_REFERENCE"],
      ["line-1,2026-11-20,REF,KE,10", "INVALID_CURRENCY"],
      ["line-1,2026-11-20,REF,KES,-10", "INVALID_CREDIT_AMOUNT"],
      ["line-1,2026-11-20,REF,KES,9007199254740992", "INVALID_CREDIT_AMOUNT"],
    ] as const;

    for (const [row, code] of cases) {
      try {
        parseCanonicalBankStatementCsv(`${header}\n${row}\n`);
        throw new Error("Expected bank statement parser to reject row");
      } catch (error) {
        expect(error).toBeInstanceOf(BankStatementCsvError);
        expect((error as BankStatementCsvError).code).toBe(code);
      }
    }
  });

  it("rejects duplicate statement line IDs", () => {
    expect(() => parseCanonicalBankStatementCsv(
      `${header}\nline-1,2026-11-20,REF-1,KES,10\nline-1,2026-11-21,REF-2,KES,20\n`,
    )).toThrowError(expect.objectContaining({ code: "DUPLICATE_STATEMENT_LINE_ID" }));
  });

  it("rejects malformed quoting, wrong headers and empty files", () => {
    expect(() => parseCanonicalBankStatementCsv("")).toThrowError(
      expect.objectContaining({ code: "EMPTY_FILE" }),
    );
    expect(() => parseCanonicalBankStatementCsv("id,date,ref,currency,amount\na,b,c,d,e"))
      .toThrowError(expect.objectContaining({ code: "INVALID_HEADER" }));
    expect(() => parseCanonicalBankStatementCsv(
      `${header}\nline-1,2026-11-20,"unterminated,KES,10`,
    )).toThrowError(expect.objectContaining({ code: "INVALID_CSV" }));
    expect(() => parseCanonicalBankStatementCsv(
      `${header}\nline-1,2026-11-20,bad"quote,KES,10\n`,
    )).toThrowError(expect.objectContaining({ code: "INVALID_CSV" }));
  });

  it("rejects a file that exceeds the byte limit", () => {
    expect(() => parseCanonicalBankStatementCsv("x".repeat(5 * 1024 * 1024 + 1)))
      .toThrowError(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  });

  it("rejects duplicate/missing data rather than skipping malformed financial rows", () => {
    expect(() => parseCanonicalBankStatementCsv(
      `${header}\nline-1,2026-11-20,REF-1,KES,10\n\nline-1,2026-11-21,REF-2,KES,20\n`,
    )).toThrowError(expect.objectContaining({ code: "DUPLICATE_STATEMENT_LINE_ID" }));
  });
});
