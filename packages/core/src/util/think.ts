const DETECT_RE = /<\/?(?:think|thinking)>/i
const TAG_RE = /<(\/?)(think|thinking)>/gi
const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/

export type ThinkBlocks = {
  reasoning: string
  text: string
}

export function splitThinkBlocks(input: string | undefined | null): ThinkBlocks {
  const source = input ?? ""
  if (!source || !DETECT_RE.test(source)) return { reasoning: "", text: source }

  const reasoning: string[] = []
  const text: string[] = []
  let depth = 0
  let fence: string | null = null
  let sawOpen = false
  let hoisted = false

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

    TAG_RE.lastIndex = 0
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = TAG_RE.exec(line))) {
      emit(line.slice(cursor, match.index))
      cursor = match.index + match[0].length
      if (match[1] === "/") {
        if (depth > 0) {
          depth--
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
      depth++
    }
    emit(line.slice(cursor))
  }

  return { reasoning: reasoning.join("").trim(), text: text.join("").trim() }
}

export function stripThinkTags(input: string | undefined | null): string {
  return splitThinkBlocks(input).text
}
