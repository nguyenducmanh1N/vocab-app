import { describe, expect, it } from "@jest/globals";
import { grade, gradeAnswer, levenshtein, normalize } from "../grading";

describe("normalize", () => {
  it("cắt khoảng trắng, viết thường, gộp khoảng trắng, đổi nháy cong", () => {
    expect(normalize("  Look   UP\t")).toBe("look up");
    expect(normalize("Don’t ‘quote’")).toBe("don't 'quote'");
  });
});

describe("levenshtein", () => {
  it.each([
    ["", "", 0],
    ["abc", "", 3],
    ["kitten", "sitting", 3],
    ["beautiful", "beautifull", 1],
    ["same", "same", 0],
  ])("%s → %s = %d", (a, b, distance) => {
    expect(levenshtein(a, b)).toBe(distance);
  });
});

describe("grade", () => {
  it("đúng khi khớp sau normalize", () => {
    expect(grade("deadline", "deadline")).toBe("correct");
    expect(grade("  Deadline ", "deadline")).toBe("correct");
    expect(grade("look   up", "look up")).toBe("correct");
  });

  it("dấu nháy cong và nháy thẳng là như nhau", () => {
    expect(grade("don't", "don’t")).toBe("correct");
    expect(grade("don’t", "don't")).toBe("correct");
    expect(grade("rock ‘n’ roll", "rock 'n' roll")).toBe("correct");
  });

  it.each([
    ["beautifull", "thừa 1 ký tự"],
    ["beatiful", "thiếu 1 ký tự"],
    ["beautifel", "sai 1 ký tự"],
  ])("gần đúng với đáp án từ 7 ký tự: %s (%s)", (input) => {
    expect(grade(input, "beautiful")).toBe("near");
  });

  it("gần đúng tính ở mốc đúng 7 ký tự", () => {
    expect(grade("problen", "problem")).toBe("near"); // 7 ký tự
    expect(grade("markat", "market")).toBe("wrong"); // 6 ký tự: sai 1 ký tự vẫn là sai
  });

  it("sai từ 2 ký tự trở lên là sai", () => {
    expect(grade("beautifel!", "beautiful")).toBe("wrong");
    expect(grade("something", "beautiful")).toBe("wrong");
  });

  it("ô trống là sai", () => {
    expect(grade("", "deadline")).toBe("wrong");
    expect(grade("   ", "deadline")).toBe("wrong");
  });
});

describe("gradeAnswer: đáp án tương đương", () => {
  it.each([
    ["color", "colour"],
    ["colour", "color"],
    ["favorite", "favourite"],
    ["center", "centre"],
    ["meter", "metre"],
    ["organize", "organise"],
    ["realization", "realisation"],
    ["analyze", "analyse"],
    ["traveled", "travelled"],
    ["canceling", "cancelling"],
    ["catalog", "catalogue"],
    ["dialog box", "dialogue box"],
  ])("chính tả Anh–Mỹ %s ~ %s → gần đúng", (input, answer) => {
    expect(gradeAnswer(input, answer)).toEqual({ grade: "near", reason: "spelling" });
  });

  it.each([
    ["for", "four"],
    ["tor", "tour"],
    ["promize", "promise"],
    ["praize", "praise"],
    ["exercize", "exercise"],
    ["instaled", "installed"],
    ["colleag", "colleague"],
  ])("không coi %s là chính tả khác của %s", (input, answer) => {
    expect(gradeAnswer(input, answer).reason).not.toBe("spelling");
  });

  it("gõ từ đồng nghĩa (không phân biệt hoa thường) → gần đúng", () => {
    expect(gradeAnswer("Due Date", "deadline", { synonyms: ["due date", "time limit"] })).toEqual({
      grade: "near",
      reason: "synonym",
    });
  });

  it("đúng hẳn vẫn là đúng; sai 1 ký tự vẫn là gần đúng do gõ nhầm; sai hẳn là sai", () => {
    expect(gradeAnswer("Colour", "colour")).toEqual({ grade: "correct" });
    expect(gradeAnswer("beautifull", "beautiful")).toEqual({ grade: "near", reason: "typo" });
    expect(gradeAnswer("cat", "deadline", { synonyms: ["due date"] })).toEqual({ grade: "wrong" });
    expect(gradeAnswer("  ", "deadline")).toEqual({ grade: "wrong" });
  });
});
