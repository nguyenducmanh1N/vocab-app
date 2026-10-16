import { describe, expect, it } from "@jest/globals";
import {
  MAX_MEANING_LENGTH,
  MAX_TERM_LENGTH,
  parseLine,
  parseQuickImport,
} from "../parseQuickImport";

describe("parseLine", () => {
  it.each([
    ["deadline - hạn chót", "deadline", "hạn chót"],
    ["deadline – hạn chót", "deadline", "hạn chót"],
    ["deadline — hạn chót", "deadline", "hạn chót"],
    ["deadline: hạn chót", "deadline", "hạn chót"],
    ["deadline :hạn chót", "deadline", "hạn chót"],
    ["look up - tra cứu", "look up", "tra cứu"],
  ])("tách %s", (raw, term, meaning) => {
    expect(parseLine(raw)).toEqual({ term, meaning });
  });

  it("chỉ có từ thì nghĩa là null", () => {
    expect(parseLine("deadline")).toEqual({ term: "deadline", meaning: null });
    expect(parseLine("deadline - ")).toEqual({ term: "deadline", meaning: null });
    expect(parseLine("deadline —")).toEqual({ term: "deadline", meaning: null });
    expect(parseLine("deadline:")).toEqual({ term: "deadline", meaning: null });
  });

  it("gạch nối không có khoảng trắng hai bên là một phần của từ", () => {
    expect(parseLine("well-known")).toEqual({ term: "well-known", meaning: null });
    expect(parseLine("well-known - nổi tiếng")).toEqual({ term: "well-known", meaning: "nổi tiếng" });
  });

  it.each(["• deadline - hạn chót", "* deadline - hạn chót", "- deadline - hạn chót", "1. deadline - hạn chót", "12) deadline - hạn chót"])(
    "bỏ ký hiệu đầu dòng: %s",
    (raw) => {
      expect(parseLine(raw)).toEqual({ term: "deadline", meaning: "hạn chót" });
    },
  );

  it("gộp khoảng trắng thừa", () => {
    expect(parseLine("  look    up   -   tra   cứu  ")).toEqual({ term: "look up", meaning: "tra cứu" });
  });

  it("dòng trống hoặc chỉ có ký hiệu thì bỏ", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("   ")).toBeNull();
    expect(parseLine("•")).toBeNull();
    expect(parseLine(": chỉ có nghĩa")).toBeNull();
  });

  it("cắt theo độ dài tối đa", () => {
    const parsed = parseLine(`${"a".repeat(150)} - ${"b".repeat(600)}`)!;
    expect(parsed.term).toHaveLength(MAX_TERM_LENGTH);
    expect(parsed.meaning).toHaveLength(MAX_MEANING_LENGTH);
  });
});

describe("parseQuickImport", () => {
  it("mỗi dòng một từ, bỏ dòng trống, nhận cả \\r\\n", () => {
    expect(parseQuickImport("deadline - hạn chót\r\n\r\nmeeting\n  \nbudget: ngân sách\n")).toEqual([
      { term: "deadline", meaning: "hạn chót" },
      { term: "meeting", meaning: null },
      { term: "budget", meaning: "ngân sách" },
    ]);
  });

  it("gộp từ trùng (không phân biệt hoa thường), lấy nghĩa của dòng sau nếu dòng đầu chưa có", () => {
    expect(
      parseQuickImport("Deadline\nmeeting - cuộc họp\ndeadline - hạn chót\nMEETING - buổi gặp"),
    ).toEqual([
      { term: "Deadline", meaning: "hạn chót" },
      { term: "meeting", meaning: "cuộc họp" },
    ]);
  });

  it("văn bản rỗng → danh sách rỗng", () => {
    expect(parseQuickImport("")).toEqual([]);
  });
});
