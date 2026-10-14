// Deterministic, one-hot protocol-shaped fixtures; never used by the running app.
// Nontrivial distributions/draws are exercised separately in sampling.test.mjs.
export function decisionReplies(record, selections = {}) {
  const index = record.eligible.findIndex(c => c.id === selections.action);
  const candidate = record.eligible[index];
  return replies(record.requests, index < 0 ? null : index, { ...selections,
    action: candidate ? candidate.optionId ?? candidate.id : selections.action });
}

export function replies(requests, selectedIndex = null, selections = {}) {
  return requests.map((request, index) => {
    const answers = Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
      if (question.type === "noul") return [name, { type: "noul", noul: selectedIndex === null ? 0.5 + index / 100 : index === selectedIndex ? 0.9 : 0.1 }];
      const keys = Object.keys(question.criteria);
      // Fixtures keep equipment unless a test explicitly chooses something else.
      const selected = selections[name] ?? (name === "action" ? keys[selectedIndex ?? keys.length - 1] :
        name === "weapon" ? keys.find(key => question.criteria[key].endsWith(" (held)")) ?? keys[0] : keys[0]);
      return [name, { type: "choice", choice: selected, probabilities: Object.fromEntries(keys.map(key =>
        [key, key === selected ? 1 : 0])) }];
    }));
    return { model: "mock", answers,
      raw_probabilities: { [request.questions.action ? "action" : "favorable"]: [0.123456789, 0.876543211] },
      timing: { tokens: 123 }, extra: "unmodified response" };
  });
}
