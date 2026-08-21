import { describe, expect, test } from "bun:test"
import { splitThinkBlocks, stripThinkTags } from "@opencode-ai/core/util/think"

describe("splitThinkBlocks", () => {
  test("returns text untouched when no tags present", () => {
    const input = "hello world"
    expect(splitThinkBlocks(input)).toEqual({ reasoning: "", text: "hello world" })
  })

  test("handles empty and nullish input", () => {
    expect(splitThinkBlocks("")).toEqual({ reasoning: "", text: "" })
    expect(splitThinkBlocks(undefined)).toEqual({ reasoning: "", text: "" })
    expect(splitThinkBlocks(null)).toEqual({ reasoning: "", text: "" })
  })

  test("extracts a think block", () => {
    const result = splitThinkBlocks("<think>reason here</think>answer")
    expect(result.reasoning).toBe("reason here")
    expect(result.text).toBe("answer")
  })

  test("extracts a thinking block", () => {
    const result = splitThinkBlocks("<thinking>reason</thinking>\n\nanswer")
    expect(result.reasoning).toBe("reason")
    expect(result.text).toBe("answer")
  })

  test("is case insensitive", () => {
    const result = splitThinkBlocks("<THINK>reason</Think>answer")
    expect(result.reasoning).toBe("reason")
    expect(result.text).toBe("answer")
  })

  test("joins multiple blocks", () => {
    const result = splitThinkBlocks("<think>a</think>one<think>b</think>two")
    expect(result.reasoning).toBe("ab")
    expect(result.text).toBe("onetwo")
  })

  test("treats unterminated block as reasoning while streaming", () => {
    const result = splitThinkBlocks("<think>still thinking")
    expect(result.reasoning).toBe("still thinking")
    expect(result.text).toBe("")
  })

  test("hoists leading text when the opening tag was dropped", () => {
    const result = splitThinkBlocks("reason only</think>answer")
    expect(result.reasoning).toBe("reason only")
    expect(result.text).toBe("answer")
  })

  test("keeps tags inside fenced code blocks", () => {
    const input = ["before", "```html", "<think>literal</think>", "```", "after"].join("\n")
    const result = splitThinkBlocks(input)
    expect(result.reasoning).toBe("")
    expect(result.text).toBe(input)
  })

  test("keeps tags inside tilde fences", () => {
    const input = ["~~~", "<think>literal</think>", "~~~"].join("\n")
    expect(splitThinkBlocks(input).text).toBe(input)
  })

  test("keeps tags inside inline code spans", () => {
    const input = "7 fix, tak satupun soal `<think>` tag:\nsisa kalimat"
    const result = splitThinkBlocks(input)
    expect(result.reasoning).toBe("")
    expect(result.text).toBe(input)
  })

  test("keeps tags inside multi-backtick spans", () => {
    const input = "pakai ``<think>`` di sini"
    expect(splitThinkBlocks(input).text).toBe(input)
  })

  test("keeps a whole block literal when wrapped in one span", () => {
    const input = "`<think>a</think>` tetap literal"
    const result = splitThinkBlocks(input)
    expect(result.reasoning).toBe("")
    expect(result.text).toBe(input)
  })

  test("still splits real tags on a line that also has code spans", () => {
    const result = splitThinkBlocks("`code` <think>reason</think> answer")
    expect(result.reasoning).toBe("reason")
    expect(result.text).toBe("`code`  answer")
  })

  test("treats an unmatched backtick as ordinary text", () => {
    const result = splitThinkBlocks("ini ` lalu <think>real</think>after")
    expect(result.reasoning).toBe("real")
    expect(result.text).toBe("ini ` lalu after")
  })

  test("handles nested tags", () => {
    const result = splitThinkBlocks("<think>outer<think>inner</think>tail</think>answer")
    expect(result.reasoning).toBe("outerinnertail")
    expect(result.text).toBe("answer")
  })

  test("preserves newlines within reasoning and text", () => {
    const result = splitThinkBlocks("<think>line1\nline2</think>\nfinal\nanswer")
    expect(result.reasoning).toBe("line1\nline2")
    expect(result.text).toBe("final\nanswer")
  })

  test("drops a stray closing tag after content was already emitted", () => {
    const result = splitThinkBlocks("<think>a</think>body</think>tail")
    expect(result.reasoning).toBe("a")
    expect(result.text).toBe("bodytail")
  })
})

describe("stripThinkTags", () => {
  test("returns only the display text", () => {
    expect(stripThinkTags("<think>hidden</think>shown")).toBe("shown")
  })

  test("passes through plain text", () => {
    expect(stripThinkTags("plain")).toBe("plain")
  })
})
