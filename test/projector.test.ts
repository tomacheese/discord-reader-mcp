import { describe, it, expect } from "vitest";
import { project, JmespathError } from "../src/projector.js";

describe("project", () => {
  const body = { messages: [{ id: "1", content: "hi", author: { id: "9", username: "bob" } }] };

  it("returns body unchanged when no expression given", () => {
    expect(project(body, undefined)).toBe(body);
  });

  it("applies a projection expression", () => {
    const result = project(body, "messages[].{id:id,author:author.username}");
    expect(result).toEqual([{ id: "1", author: "bob" }]);
  });

  it("supports non-object results (string/number/array/null)", () => {
    expect(project(body, "messages[0].id")).toBe("1");
    expect(project({ n: 5 }, "n")).toBe(5);
    expect(project({ x: null }, "x")).toBeNull();
  });

  it("throws JmespathError on invalid expression", () => {
    expect(() => project(body, "messages[")).toThrow(JmespathError);
  });
});
