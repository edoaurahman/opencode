const DETECT_RE = /<\/?(?:think|thinking)>/i
const TAG_RE = /<(\/?)(think|thinking)>/gi
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/

export type ThinkBlocks = {
  reasoning: string
  text: string
}

export function splitThinkBlocks(input: string | undefined | null, options?: { done?: boolean }): ThinkBlocks {
  const source = input ?? ""
  if (!source || !DETECT_RE.test(source)) return { reasoning: "", text: source }

  const reasoning: string[] = []
  const text: string[] = []
  let depth = 0
  let fence: string | null = null
  let sawOpen = false
  let hoisted = false
  // Where the outermost still-open block started in `reasoning`, so a block the
  // provider never closed can be handed back as text once the stream is done.
  let openAt = -1

  const emit = (chunk: string) => {
    if (!chunk) return
    if (depth > 0) reasoning.push(chunk)
    else text.push(chunk)
  }

  const lines = source.split("\n")
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ""
    if (index > 0) emit("\n")

    if (fence) {
      if (line.trimStart().startsWith(fence)) fence = null
      emit(line)
      continue
    }

    const opening = FENCE_RE.exec(line)
    if (opening) {
      fence = opening[1]!
      emit(line)
      continue
    }

    const spans = line.includes("`") ? codeSpans(line) : []

    TAG_RE.lastIndex = 0
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = TAG_RE.exec(line))) {
      const tag = match
      // Leave the tag in the pending slice so it is emitted as literal text.
      if (spans.some((span) => tag.index >= span.start && tag.index < span.end)) continue
      emit(line.slice(cursor, tag.index))
      cursor = tag.index + tag[0].length
      if (tag[1] === "/") {
        if (depth > 0) {
          depth--
          if (depth === 0) openAt = -1
          continue
        }
        if (!sawOpen && !hoisted) {
          // Provider dropped the opening tag: everything so far was reasoning.
          hoisted = true
          reasoning.push(...text.splice(0, text.length))
        }
        continue
      }
      sawOpen = true
      if (depth === 0) openAt = reasoning.length
      depth++
    }
    emit(line.slice(cursor))
  }

  // A finished turn with an unclosed block means the provider dropped the
  // closing tag, so the answer is trapped inside it. Hand that tail back as
  // text - merged with the reasoning, since nothing marks where one ends -
  // rather than rendering an empty message.
  if (options?.done && depth > 0 && openAt >= 0) {
    for (const chunk of reasoning.splice(openAt, reasoning.length - openAt)) text.push(chunk)
  }

  return { reasoning: reasoning.join("").trim(), text: text.join("").trim() }
}

export function stripThinkTags(input: string | undefined | null): string {
  return splitThinkBlocks(input).text
}

// Inline code spans keep tags literal, so `<think>` in prose must not open a
// block. Per CommonMark a run of N backticks is closed by the next run of
// exactly N; an unmatched run is ordinary text and opens nothing.
function codeSpans(line: string) {
  const spans: { start: number; end: number }[] = []
  let index = 0

  while (index < line.length) {
    if (line[index] !== "`") {
      index++
      continue
    }

    const open = index
    while (line[index] === "`") index++
    const width = index - open

    let cursor = index
    while (cursor < line.length) {
      if (line[cursor] !== "`") {
        cursor++
        continue
      }
      const close = cursor
      while (line[cursor] === "`") cursor++
      if (cursor - close === width) {
        spans.push({ start: open, end: cursor })
        index = cursor
        break
      }
    }
    if (cursor >= line.length) return spans
  }

  return spans
}
