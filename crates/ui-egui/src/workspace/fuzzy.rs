//! Small, dependency-free fuzzy matching shared by the quick switcher, the command palette and
//! the in-memory backend.
//!
//! Scores are only meaningful relative to each other: an exact match beats a prefix match, which
//! beats a substring match at a word boundary, which beats any other substring match, which beats
//! an in-order subsequence match. `None` means the query does not match at all.

const EXACT_SCORE: u32 = 4_000;
const PREFIX_SCORE: u32 = 3_000;
const BOUNDARY_SCORE: u32 = 2_500;
const SUBSTRING_SCORE: u32 = 2_000;
const SUBSEQUENCE_SCORE: u32 = 1_000;
const MAX_PENALTY: u32 = 499;

/// Scores `candidate` against `query`, case-insensitively.
///
/// An empty (or whitespace-only) query matches everything with score `0`.
pub fn fuzzy_score(query: &str, candidate: &str) -> Option<u32> {
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Some(0);
    }
    let candidate = candidate.to_lowercase();
    if candidate == query {
        return Some(EXACT_SCORE);
    }
    if let Some(position) = candidate.find(&query) {
        let base = if position == 0 {
            PREFIX_SCORE
        } else if is_word_boundary(&candidate, position) {
            BOUNDARY_SCORE
        } else {
            SUBSTRING_SCORE
        };
        let extra = candidate
            .chars()
            .count()
            .saturating_sub(query.chars().count());
        return Some(base - penalty(position.saturating_add(extra)));
    }
    subsequence_gaps(&query, &candidate).map(|gaps| SUBSEQUENCE_SCORE - penalty(gaps))
}

/// Ranks `candidates` against `query`, best first, ties broken alphabetically (case-insensitive,
/// then byte order), and keeps at most `limit` entries.
pub fn rank_strings<S: AsRef<str>>(query: &str, candidates: &[S], limit: usize) -> Vec<String> {
    let mut scored: Vec<(u32, &str)> = candidates
        .iter()
        .filter_map(|candidate| {
            let candidate = candidate.as_ref();
            fuzzy_score(query, candidate).map(|score| (score, candidate))
        })
        .collect();
    scored.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| compare_names(left.1, right.1))
    });
    scored
        .into_iter()
        .take(limit)
        .map(|(_, candidate)| candidate.to_owned())
        .collect()
}

/// Case-insensitive ordering with a byte-order tie-break so the result is total and stable.
pub fn compare_names(left: &str, right: &str) -> std::cmp::Ordering {
    left.to_lowercase()
        .cmp(&right.to_lowercase())
        .then_with(|| left.cmp(right))
}

fn penalty(amount: usize) -> u32 {
    u32::try_from(amount).map_or(MAX_PENALTY, |amount| amount.min(MAX_PENALTY))
}

fn is_word_boundary(candidate: &str, position: usize) -> bool {
    candidate[..position]
        .chars()
        .next_back()
        .is_some_and(|previous| matches!(previous, '/' | ' ' | '-' | '_' | '.' | ':'))
}

/// Returns the number of skipped candidate characters when every query character can be found
/// in order, or `None` when the query is not a subsequence of the candidate.
fn subsequence_gaps(query: &str, candidate: &str) -> Option<usize> {
    let mut candidate_chars = candidate.chars();
    let mut gaps = 0_usize;
    for wanted in query.chars() {
        loop {
            let next = candidate_chars.next()?;
            if next == wanted {
                break;
            }
            gaps += 1;
        }
    }
    Some(gaps)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_query_matches_everything_equally() {
        assert_eq!(fuzzy_score("", "anything"), Some(0));
        assert_eq!(fuzzy_score("   ", "anything"), Some(0));
    }

    #[test]
    fn exact_beats_prefix_beats_boundary_beats_substring_beats_subsequence() {
        let exact = fuzzy_score("note", "note").unwrap_or_default();
        let prefix = fuzzy_score("note", "notebook").unwrap_or_default();
        let boundary = fuzzy_score("note", "daily/note").unwrap_or_default();
        let substring = fuzzy_score("note", "footnote").unwrap_or_default();
        let subsequence = fuzzy_score("note", "n-o-t-e").unwrap_or_default();
        assert!(exact > prefix, "{exact} > {prefix}");
        assert!(prefix > boundary, "{prefix} > {boundary}");
        assert!(boundary > substring, "{boundary} > {substring}");
        assert!(substring > subsequence, "{substring} > {subsequence}");
        assert!(subsequence > 0);
    }

    #[test]
    fn matching_is_case_insensitive_and_rejects_out_of_order_queries() {
        assert!(fuzzy_score("NOTE", "my note").is_some());
        assert!(fuzzy_score("qs", "Quick Switcher").is_some());
        assert_eq!(fuzzy_score("zq", "Quick Switcher"), None);
        assert_eq!(fuzzy_score("x", ""), None);
    }

    #[test]
    fn rank_strings_orders_by_score_then_name_and_applies_limit() {
        let candidates = [
            "b/Alpha.md",
            "alpha.md",
            "Beta.md",
            "gamma.md",
            "a/alphabet.md",
        ];
        let ranked = rank_strings("alpha", &candidates, 3);
        assert_eq!(ranked, ["alpha.md", "b/Alpha.md", "a/alphabet.md"]);

        let all = rank_strings("", &candidates, 10);
        assert_eq!(
            all,
            [
                "a/alphabet.md",
                "alpha.md",
                "b/Alpha.md",
                "Beta.md",
                "gamma.md"
            ]
        );
    }

    #[test]
    fn multibyte_candidates_do_not_panic() {
        assert!(fuzzy_score("é", "café/thé.md").is_some());
        assert!(fuzzy_score("ü", "🧪/über.md").is_some());
        assert_eq!(fuzzy_score("ß", "🧪"), None);
    }
}
