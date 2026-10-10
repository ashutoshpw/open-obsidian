/// Outcome of a conservative byte-preserving three-way merge.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MergeStatus {
    /// The local and current versions already agree, or one side has no edits.
    Unchanged,
    /// Disjoint line edits were combined.
    Merged,
    /// The inputs cannot be combined without guessing.
    Conflict,
}

/// One line where both versions changed differently from the editor base.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MergeConflict {
    /// One-based line number, or 1 when the inputs are structurally incompatible.
    pub line: usize,
    pub base: Vec<u8>,
    pub local: Vec<u8>,
    pub current: Vec<u8>,
}

/// Result of comparing the editor base, local edit and current disk contents.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThreeWayMergeResult {
    pub status: MergeStatus,
    pub bytes: Option<Vec<u8>>,
    pub conflicts: Vec<MergeConflict>,
}

impl ThreeWayMergeResult {
    /// Build a non-mergeable result while retaining the complete three inputs for review.
    pub fn conflict(base: &[u8], local: &[u8], current: &[u8]) -> Self {
        Self {
            status: MergeStatus::Conflict,
            bytes: None,
            conflicts: vec![MergeConflict {
                line: 1,
                base: base.to_vec(),
                local: local.to_vec(),
                current: current.to_vec(),
            }],
        }
    }
}

/// Combine line edits only when each changed line has one unambiguous owner.
///
/// Line terminators remain attached to their source lines, so a successful merge
/// preserves each edited line's original LF, CRLF or CR bytes. Invalid UTF-8,
/// NUL-containing data, insertions/deletions and overlapping edits fail closed.
pub fn three_way_merge_bytes(base: &[u8], local: &[u8], current: &[u8]) -> ThreeWayMergeResult {
    if local == current {
        return ThreeWayMergeResult {
            status: MergeStatus::Unchanged,
            bytes: Some(local.to_vec()),
            conflicts: Vec::new(),
        };
    }
    if base == local {
        return ThreeWayMergeResult {
            status: MergeStatus::Unchanged,
            bytes: Some(current.to_vec()),
            conflicts: Vec::new(),
        };
    }
    if base == current {
        return ThreeWayMergeResult {
            status: MergeStatus::Unchanged,
            bytes: Some(local.to_vec()),
            conflicts: Vec::new(),
        };
    }
    if !is_text(base) || !is_text(local) || !is_text(current) {
        return ThreeWayMergeResult::conflict(base, local, current);
    }

    let base_lines = lines(base);
    let local_lines = lines(local);
    let current_lines = lines(current);
    if base_lines.len() != local_lines.len() || base_lines.len() != current_lines.len() {
        return ThreeWayMergeResult::conflict(base, local, current);
    }

    let mut merged = Vec::with_capacity(base.len().max(local.len()).max(current.len()));
    let mut conflicts = Vec::new();
    for (index, ((base_line, local_line), current_line)) in base_lines
        .iter()
        .zip(&local_lines)
        .zip(&current_lines)
        .enumerate()
    {
        if local_line == current_line {
            merged.extend_from_slice(local_line);
        } else if local_line == base_line {
            merged.extend_from_slice(current_line);
        } else if current_line == base_line {
            merged.extend_from_slice(local_line);
        } else {
            conflicts.push(MergeConflict {
                line: index + 1,
                base: base_line.to_vec(),
                local: local_line.to_vec(),
                current: current_line.to_vec(),
            });
        }
    }

    if conflicts.is_empty() {
        ThreeWayMergeResult {
            status: MergeStatus::Merged,
            bytes: Some(merged),
            conflicts,
        }
    } else {
        ThreeWayMergeResult {
            status: MergeStatus::Conflict,
            bytes: None,
            conflicts,
        }
    }
}

fn is_text(bytes: &[u8]) -> bool {
    !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok()
}

fn lines(bytes: &[u8]) -> Vec<&[u8]> {
    let mut result = Vec::new();
    let mut start = 0;

    while start < bytes.len() {
        let Some(offset) = bytes[start..]
            .iter()
            .position(|byte| matches!(*byte, b'\r' | b'\n'))
        else {
            result.push(&bytes[start..]);
            break;
        };
        let break_start = start + offset;
        let break_width =
            if bytes[break_start] == b'\r' && bytes.get(break_start + 1) == Some(&b'\n') {
                2
            } else {
                1
            };
        let end = break_start + break_width;
        result.push(&bytes[start..end]);
        start = end;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::{MergeStatus, three_way_merge_bytes};

    #[test]
    fn combines_disjoint_edits_and_preserves_each_line_ending() {
        let result = three_way_merge_bytes(
            b"\xef\xbb\xbfone\r\ntwo\nthree\r",
            b"\xef\xbb\xbfONE\r\ntwo\nthree\r",
            b"\xef\xbb\xbfone\r\ntwo\nTHREE\r",
        );

        assert_eq!(result.status, MergeStatus::Merged);
        assert_eq!(
            result.bytes.as_deref(),
            Some(&b"\xef\xbb\xbfONE\r\ntwo\nTHREE\r"[..])
        );
        assert!(result.conflicts.is_empty());
    }

    #[test]
    fn reports_overlapping_and_structural_edits_without_guessing() {
        let overlap = three_way_merge_bytes(b"one\ntwo\n", b"ONE\ntwo\n", b"CURRENT\ntwo\n");
        assert_eq!(overlap.status, MergeStatus::Conflict);
        assert_eq!(overlap.conflicts[0].line, 1);
        assert_eq!(overlap.conflicts[0].base.as_slice(), b"one\n");
        assert_eq!(overlap.conflicts[0].local.as_slice(), b"ONE\n");
        assert_eq!(overlap.conflicts[0].current.as_slice(), b"CURRENT\n");

        let insertion =
            three_way_merge_bytes(b"one\ntwo\n", b"one\ninserted\ntwo\n", b"one\nTWO\n");
        assert_eq!(insertion.status, MergeStatus::Conflict);
        assert!(insertion.bytes.is_none());
    }

    #[test]
    fn rejects_binary_and_invalid_utf8_when_versions_diverge() {
        for (base, local, current) in [
            (&b"\0base"[..], &b"\0local"[..], &b"\0current"[..]),
            (&[0xff, b'b'][..], &[0xff, b'l'][..], &[0xff, b'c'][..]),
        ] {
            let result = three_way_merge_bytes(base, local, current);
            assert_eq!(result.status, MergeStatus::Conflict);
            assert!(result.bytes.is_none());
            assert_eq!(result.conflicts[0].base.as_slice(), base);
            assert_eq!(result.conflicts[0].local.as_slice(), local);
            assert_eq!(result.conflicts[0].current.as_slice(), current);
        }
    }

    #[test]
    fn recognizes_unchanged_sides_without_normalizing_bytes() {
        let current = b"\xef\xbb\xbfcurrent\r\n";
        let result = three_way_merge_bytes(b"base\n", b"base\n", current);
        assert_eq!(result.status, MergeStatus::Unchanged);
        assert_eq!(result.bytes.as_deref(), Some(&current[..]));
    }
}
