//! Bounded, read-only YAML mapping projection for Markdown frontmatter.
//!
//! The source Markdown remains authoritative. Unsupported aliases, tags,
//! block scalars, malformed collection entries, and excessive nesting are
//! returned as opaque values with issues instead of being normalized.

const MAX_NESTING_DEPTH: usize = 64;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct YamlMappingEntry {
    pub key: String,
    pub value: YamlValue,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum YamlValue {
    Null,
    Boolean(bool),
    Number(String),
    String(String),
    Sequence(Vec<YamlValue>),
    Mapping(Vec<YamlMappingEntry>),
    Unsupported(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct YamlParseResult {
    pub entries: Vec<YamlMappingEntry>,
    pub issues: Vec<String>,
}

impl YamlParseResult {
    pub(crate) fn empty() -> Self {
        Self {
            entries: Vec::new(),
            issues: Vec::new(),
        }
    }
}

#[derive(Clone, Debug)]
struct YamlLine {
    indent: usize,
    content: String,
    line: usize,
}

struct YamlPair {
    key: String,
    value: String,
}

pub(crate) struct YamlPairSource {
    pub key: String,
    pub key_start: usize,
    pub key_end: usize,
    pub value_start: usize,
    pub value_end: usize,
}

struct ParsedBlock {
    value: YamlValue,
    index: usize,
}

fn line_ranges(source: &str) -> Vec<(usize, usize)> {
    let bytes = source.as_bytes();
    let mut ranges = Vec::new();
    let mut start = 0;

    while start < bytes.len() {
        let mut end = start;
        while end < bytes.len() && !matches!(bytes[end], b'\r' | b'\n') {
            end += 1;
        }
        ranges.push((start, end));

        if end == bytes.len() {
            break;
        }
        start = if bytes[end] == b'\r' && bytes.get(end + 1) == Some(&b'\n') {
            end + 2
        } else {
            end + 1
        };
    }

    ranges
}

fn quote_starts(bytes: &[u8], index: usize) -> bool {
    index == 0
        || bytes.get(index - 1).is_some_and(|byte| {
            byte.is_ascii_whitespace() || matches!(*byte, b'[' | b'{' | b',' | b':')
        })
}

fn scan_top_level(value: &str, delimiter: u8) -> Option<usize> {
    let bytes = value.as_bytes();
    let mut quote = None;
    let mut escaped = false;
    let mut depth = 0usize;

    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if let Some(quote_byte) = quote {
            if quote_byte == b'\'' {
                if byte == b'\'' {
                    if bytes.get(index + 1) == Some(&b'\'') {
                        index += 2;
                        continue;
                    }
                    quote = None;
                }
                index += 1;
                continue;
            }

            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == quote_byte {
                quote = None;
            }
            index += 1;
            continue;
        }

        match byte {
            b'"' | b'\'' if quote_starts(bytes, index) => quote = Some(byte),
            b'[' | b'{' | b'(' => depth = depth.saturating_add(1),
            b']' | b'}' | b')' => depth = depth.saturating_sub(1),
            _ if byte == delimiter && depth == 0 => return Some(index),
            _ => {}
        }
        index += 1;
    }

    None
}

fn comment_start(value: &str) -> Option<usize> {
    scan_top_level(value, b'#').filter(|index| {
        *index == 0
            || value
                .as_bytes()
                .get(*index - 1)
                .is_some_and(|byte| byte.is_ascii_whitespace())
    })
}

fn strip_comment(value: &str) -> &str {
    comment_start(value)
        .map_or(value, |index| &value[..index])
        .trim_end()
}

fn tokenize(source: &str, issues: &mut Vec<String>) -> Vec<YamlLine> {
    line_ranges(source)
        .into_iter()
        .enumerate()
        .filter_map(|(index, (start, end))| {
            let raw = &source[start..end];
            let bytes = raw.as_bytes();
            let mut indent = 0;
            let mut leading = 0;
            while let Some(byte @ (b' ' | b'\t')) = bytes.get(leading).copied() {
                if byte == b'\t' {
                    issues.push(format!(
                        "line {}: tabs are not supported for YAML indentation",
                        index + 1
                    ));
                } else {
                    indent += 1;
                }
                leading += 1;
            }

            let content = strip_comment(&raw[indent..]).trim();
            if content.is_empty() || content.starts_with('#') {
                return None;
            }

            Some(YamlLine {
                indent,
                content: content.to_owned(),
                line: index + 1,
            })
        })
        .collect()
}

fn unquote(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.len() < 2 {
        return None;
    }

    if trimmed.starts_with('"') && trimmed.ends_with('"') {
        return Some(
            serde_json::from_str::<String>(trimmed)
                .unwrap_or_else(|_| trimmed[1..trimmed.len() - 1].to_owned()),
        );
    }
    if trimmed.starts_with('\'') && trimmed.ends_with('\'') {
        return Some(trimmed[1..trimmed.len() - 1].replace("''", "'"));
    }
    None
}

fn mapping_key(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if let Some(quoted) = unquote(trimmed) {
        return (!quoted.is_empty()).then_some(quoted);
    }

    let bytes = trimmed.as_bytes();
    let &first = bytes.first()?;
    let reserved_indicator = matches!(
        first,
        b'!' | b'&'
            | b'*'
            | b'['
            | b']'
            | b'{'
            | b'}'
            | b','
            | b'#'
            | b'|'
            | b'>'
            | b'\''
            | b'"'
            | b'%'
            | b'@'
            | b'`'
    ) || (matches!(first, b'-' | b'?' | b':')
        && bytes.get(1).is_none_or(|byte| byte.is_ascii_whitespace()));
    let valid = !reserved_indicator;
    valid.then(|| trimmed.to_owned())
}

fn mapping_separator(value: &str) -> Option<usize> {
    let bytes = value.as_bytes();
    let mut search_start = 0;
    while search_start < bytes.len() {
        let relative = scan_top_level(&value[search_start..], b':')?;
        let index = search_start + relative;
        if bytes
            .get(index + 1)
            .is_none_or(|byte| byte.is_ascii_whitespace())
        {
            return Some(index);
        }
        search_start = index + 1;
    }
    None
}

fn trim_ascii_start(value: &str) -> usize {
    value
        .as_bytes()
        .iter()
        .take_while(|byte| matches!(**byte, b' ' | b'\t'))
        .count()
}

fn trim_ascii_end(value: &str) -> usize {
    value
        .as_bytes()
        .iter()
        .rposition(|byte| !matches!(*byte, b' ' | b'\t'))
        .map_or(0, |index| index + 1)
}

/// Parse one mapping pair and retain the exact byte span of its inline value.
pub(crate) fn mapping_pair_source(value: &str) -> Option<YamlPairSource> {
    let mapping_end = comment_start(value).unwrap_or(value.len());
    let mapping_source = &value[..mapping_end];
    let colon = mapping_separator(mapping_source)?;
    if colon == 0 {
        return None;
    }

    let raw_key = &value[..colon];
    let key_start = trim_ascii_start(raw_key);
    let key_end = trim_ascii_end(raw_key);
    if key_start >= key_end {
        return None;
    }
    let key = mapping_key(&raw_key[key_start..key_end])?;
    let after_colon = &value[colon + 1..];
    let without_comment_end = comment_start(after_colon).unwrap_or(after_colon.len());
    let before_comment = &after_colon[..without_comment_end];
    let value_start = trim_ascii_start(before_comment);
    let value_end = trim_ascii_end(before_comment).max(value_start);

    Some(YamlPairSource {
        key,
        key_start,
        key_end,
        value_start: colon + 1 + value_start,
        value_end: colon + 1 + value_end,
    })
}

fn pair(value: &str) -> Option<YamlPair> {
    let colon = mapping_separator(value)?;
    if colon == 0 {
        return None;
    }

    Some(YamlPair {
        key: mapping_key(&value[..colon])?,
        value: value[colon + 1..].trim().to_owned(),
    })
}

fn split_flow_ranges(value: &str) -> Option<Vec<(usize, usize)>> {
    let bytes = value.as_bytes();
    let mut quote = None;
    let mut escaped = false;
    let mut delimiters = Vec::new();
    let mut start = 0;
    let mut parts = Vec::new();

    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if let Some(quote_byte) = quote {
            if quote_byte == b'\'' {
                if byte == b'\'' {
                    if bytes.get(index + 1) == Some(&b'\'') {
                        index += 2;
                        continue;
                    }
                    quote = None;
                }
                index += 1;
                continue;
            }

            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == quote_byte {
                quote = None;
            }
            index += 1;
            continue;
        }

        match byte {
            b'"' | b'\'' if quote_starts(bytes, index) => quote = Some(byte),
            b'[' | b'{' | b'(' => delimiters.push(byte),
            b']' | b'}' | b')' => {
                let expected = match byte {
                    b']' => b'[',
                    b'}' => b'{',
                    _ => b'(',
                };
                if delimiters.pop() != Some(expected) {
                    return None;
                }
            }
            b',' if delimiters.is_empty() => {
                let part = &value[start..index];
                let leading = trim_ascii_start(part);
                let trailing = trim_ascii_end(part);
                parts.push((start + leading, start + trailing));
                start = index + 1;
            }
            _ => {}
        }
        index += 1;
    }

    if quote.is_some() || !delimiters.is_empty() {
        return None;
    }
    let part = &value[start..];
    let leading = trim_ascii_start(part);
    let trailing = trim_ascii_end(part);
    parts.push((start + leading, start + trailing));
    Some(parts)
}

fn split_flow_parts(value: &str) -> Option<Vec<&str>> {
    split_flow_ranges(value).map(|parts| {
        parts
            .into_iter()
            .map(|(start, end)| &value[start..end])
            .collect()
    })
}

/// Return source spans for every non-empty entry in an inline flow mapping.
pub(crate) fn flow_mapping_entry_sources(value: &str) -> Option<Vec<YamlPairSource>> {
    if !value.starts_with('{') || !value.ends_with('}') {
        return None;
    }

    let inner = &value[1..value.len() - 1];
    if inner.trim().is_empty() {
        return Some(Vec::new());
    }
    let ranges = split_flow_ranges(inner)?;
    let last = ranges.len().saturating_sub(1);
    let mut entries = Vec::new();
    for (index, (start, end)) in ranges.into_iter().enumerate() {
        if start == end {
            if index == last {
                continue;
            }
            return None;
        }
        let mut pair = mapping_pair_source(&inner[start..end])?;
        pair.key_start += start + 1;
        pair.key_end += start + 1;
        pair.value_start += start + 1;
        pair.value_end += start + 1;
        entries.push(pair);
    }
    Some(entries)
}

/// Return source spans for every value in an inline flow sequence.
pub(crate) fn flow_sequence_entry_sources(value: &str) -> Option<Vec<(usize, usize)>> {
    if !value.starts_with('[') || !value.ends_with(']') {
        return None;
    }

    let inner = &value[1..value.len() - 1];
    if inner.trim().is_empty() {
        return Some(Vec::new());
    }
    let ranges = split_flow_ranges(inner)?;
    let last = ranges.len().saturating_sub(1);
    let mut entries = Vec::with_capacity(ranges.len());
    for (index, (start, end)) in ranges.into_iter().enumerate() {
        if start == end {
            if index == last {
                continue;
            }
            return None;
        }
        entries.push((start + 1, end + 1));
    }
    Some(entries)
}

fn serialize_flow_value(value: &YamlValue, depth: usize) -> Option<String> {
    if depth >= MAX_NESTING_DEPTH - 1 {
        return None;
    }
    match value {
        YamlValue::Null => Some("null".to_owned()),
        YamlValue::Boolean(value) => Some(value.to_string()),
        YamlValue::Number(value) if is_yaml_number(value) => Some(value.clone()),
        YamlValue::Number(_) | YamlValue::Unsupported(_) => None,
        YamlValue::String(value) => serde_json::to_string(value).ok(),
        YamlValue::Sequence(values) => {
            let values = values
                .iter()
                .map(|value| serialize_flow_value(value, depth + 1))
                .collect::<Option<Vec<_>>>()?;
            Some(format!("[{}]", values.join(", ")))
        }
        YamlValue::Mapping(entries) => {
            let mut seen = std::collections::HashSet::new();
            let entries = entries
                .iter()
                .map(|entry| {
                    if !seen.insert(&entry.key) {
                        return None;
                    }
                    let key = if !entry.key.is_empty()
                        && entry.key.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-')
                        }) {
                        entry.key.clone()
                    } else {
                        serde_json::to_string(&entry.key).ok()?
                    };
                    Some(format!(
                        "{key}: {}",
                        serialize_flow_value(&entry.value, depth + 1)?
                    ))
                })
                .collect::<Option<Vec<_>>>()?;
            Some(format!("{{{}}}", entries.join(", ")))
        }
    }
}

pub(crate) fn serialize_flow(value: &YamlValue) -> Option<String> {
    serialize_flow_value(value, 0)
}

fn is_block_scalar_header(value: &str) -> bool {
    let Some((&style, modifiers)) = value.as_bytes().split_first() else {
        return false;
    };
    if !matches!(style, b'|' | b'>') {
        return false;
    }

    let mut chomping = false;
    let mut indentation = false;
    for modifier in modifiers {
        match *modifier {
            b'+' | b'-' if !chomping => chomping = true,
            b'1'..=b'9' if !indentation => indentation = true,
            _ => return false,
        }
    }
    true
}

fn unsupported_yaml_value(value: &str) -> bool {
    value.starts_with('!') || value.starts_with('&') || value.starts_with('*')
}

fn parse_flow(
    value: &str,
    line: usize,
    issues: &mut Vec<String>,
    depth: usize,
) -> Option<YamlValue> {
    if depth >= MAX_NESTING_DEPTH {
        issues.push(format!(
            "line {line}: YAML nesting exceeds the supported depth of {MAX_NESTING_DEPTH}"
        ));
        return Some(YamlValue::Unsupported(value.to_owned()));
    }

    if value.starts_with('[') && value.ends_with(']') {
        let inner = &value[1..value.len() - 1];
        let parts = split_flow_parts(inner)?;
        let mut values = Vec::new();
        let last_part = parts.len().saturating_sub(1);
        for (index, part) in parts.into_iter().enumerate() {
            if part.is_empty() {
                if inner.trim().is_empty() || index == last_part {
                    continue;
                }
                issues.push(format!(
                    "line {line}: empty inline YAML sequence item is not supported"
                ));
                return Some(YamlValue::Unsupported(value.to_owned()));
            }
            values.push(parse_value(part, line, issues, depth + 1));
        }
        return Some(YamlValue::Sequence(values));
    }

    if value.starts_with('{') && value.ends_with('}') {
        let inner = &value[1..value.len() - 1];
        let parts = split_flow_parts(inner)?;
        let mut entries = Vec::new();
        let last_part = parts.len().saturating_sub(1);
        for (index, part) in parts.into_iter().enumerate() {
            if part.is_empty() {
                if inner.trim().is_empty() || index == last_part {
                    continue;
                }
                issues.push(format!(
                    "line {line}: empty inline YAML map entry is not supported"
                ));
                return Some(YamlValue::Unsupported(value.to_owned()));
            }
            let Some(parsed) = pair(part) else {
                issues.push(format!(
                    "line {line}: inline YAML map entry is not supported"
                ));
                return Some(YamlValue::Unsupported(value.to_owned()));
            };
            entries.push(YamlMappingEntry {
                key: parsed.key,
                value: parse_value(&parsed.value, line, issues, depth + 1),
            });
        }
        return Some(YamlValue::Mapping(entries));
    }

    None
}

fn is_yaml_number(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = usize::from(matches!(bytes.first(), Some(&b'+') | Some(&b'-')));
    let mut digits = 0;

    while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
        digits += 1;
        index += 1;
    }
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
            digits += 1;
            index += 1;
        }
    }
    if digits == 0 {
        return false;
    }
    if bytes
        .get(index)
        .is_some_and(|byte| matches!(*byte, b'e' | b'E'))
    {
        index += 1;
        if bytes
            .get(index)
            .is_some_and(|byte| matches!(*byte, b'+' | b'-'))
        {
            index += 1;
        }
        let exponent_start = index;
        while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
            index += 1;
        }
        if index == exponent_start {
            return false;
        }
    }
    index == bytes.len()
}

fn parse_value(value: &str, line: usize, issues: &mut Vec<String>, depth: usize) -> YamlValue {
    let trimmed = strip_comment(value).trim();
    if depth >= MAX_NESTING_DEPTH {
        issues.push(format!(
            "line {line}: YAML nesting exceeds the supported depth of {MAX_NESTING_DEPTH}"
        ));
        return YamlValue::Unsupported(trimmed.to_owned());
    }
    if is_block_scalar_header(trimmed) {
        issues.push(format!(
            "line {line}: YAML block scalars remain source-only"
        ));
        return YamlValue::Unsupported(trimmed.to_owned());
    }
    if unsupported_yaml_value(trimmed) {
        issues.push(format!(
            "line {line}: YAML aliases and tags remain source-only"
        ));
        return YamlValue::Unsupported(trimmed.to_owned());
    }
    if trimmed.is_empty()
        || trimmed == "~"
        || ["null", "nil"]
            .iter()
            .any(|n| trimmed.eq_ignore_ascii_case(n))
    {
        return YamlValue::Null;
    }
    if let Some(quoted) = unquote(trimmed) {
        return YamlValue::String(quoted);
    }
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        return parse_flow(trimmed, line, issues, depth).unwrap_or_else(|| {
            issues.push(format!(
                "line {line}: malformed inline YAML collection remains source-only"
            ));
            YamlValue::Unsupported(trimmed.to_owned())
        });
    }
    if ["true", "false"]
        .iter()
        .any(|n| trimmed.eq_ignore_ascii_case(n))
    {
        return YamlValue::Boolean(trimmed.eq_ignore_ascii_case("true"));
    }
    if is_yaml_number(trimmed) {
        return YamlValue::Number(trimmed.to_owned());
    }
    YamlValue::String(trimmed.to_owned())
}

fn is_sequence_line(line: &YamlLine) -> bool {
    line.content == "-" || line.content.starts_with("- ")
}

fn has_nested_block_value(next: Option<&YamlLine>, indent: usize) -> bool {
    next.is_some_and(|line| {
        line.indent > indent || (line.indent == indent && is_sequence_line(line))
    })
}

fn skip_nested_lines(lines: &[YamlLine], start: usize, indent: usize) -> usize {
    let mut index = start;
    while lines.get(index).is_some_and(|line| line.indent > indent) {
        index += 1;
    }
    index
}

fn parse_block(
    lines: &[YamlLine],
    start: usize,
    indent: usize,
    issues: &mut Vec<String>,
    depth: usize,
) -> ParsedBlock {
    if depth >= MAX_NESTING_DEPTH {
        let index = skip_nested_lines(lines, start + 1, indent);
        let raw = lines
            .get(start)
            .map_or_else(String::new, |line| line.content.clone());
        issues.push(format!(
            "line {}: YAML nesting exceeds the supported depth of {MAX_NESTING_DEPTH}",
            lines.get(start).map_or(1, |line| line.line)
        ));
        return ParsedBlock {
            value: YamlValue::Unsupported(raw),
            index,
        };
    }

    if lines.get(start).is_some_and(is_sequence_line) {
        parse_sequence(lines, start, indent, issues, depth)
    } else {
        parse_map(lines, start, indent, issues, depth)
    }
}

fn parse_map_entry(
    lines: &[YamlLine],
    start: usize,
    indent: usize,
    issues: &mut Vec<String>,
    depth: usize,
) -> Option<(YamlMappingEntry, usize)> {
    let current = lines.get(start)?;
    let parsed = pair(&current.content).or_else(|| {
        issues.push(format!(
            "line {}: YAML mapping entry is not supported",
            current.line
        ));
        None
    })?;
    let next = lines.get(start + 1);

    if is_block_scalar_header(&parsed.value) || unsupported_yaml_value(&parsed.value) {
        let value = parse_value(&parsed.value, current.line, issues, depth + 1);
        let next_index = if has_nested_block_value(next, indent) {
            skip_nested_lines(lines, start + 1, indent)
        } else {
            start + 1
        };
        return Some((
            YamlMappingEntry {
                key: parsed.key,
                value,
            },
            next_index,
        ));
    }

    if parsed.value.is_empty() && has_nested_block_value(next, indent) {
        let child_indent = next.map_or(indent, |line| line.indent);
        let child = parse_block(lines, start + 1, child_indent, issues, depth + 1);
        return Some((
            YamlMappingEntry {
                key: parsed.key,
                value: child.value,
            },
            child.index,
        ));
    }

    Some((
        YamlMappingEntry {
            key: parsed.key,
            value: parse_value(&parsed.value, current.line, issues, depth + 1),
        },
        start + 1,
    ))
}

fn parse_map(
    lines: &[YamlLine],
    start: usize,
    indent: usize,
    issues: &mut Vec<String>,
    depth: usize,
) -> ParsedBlock {
    let mut entries = Vec::new();
    let mut index = start;
    while let Some(current) = lines.get(index) {
        if current.indent < indent || is_sequence_line(current) {
            break;
        }
        if current.indent > indent {
            issues.push(format!("line {}: unexpected indentation", current.line));
            index += 1;
            continue;
        }

        if let Some((entry, next_index)) = parse_map_entry(lines, index, indent, issues, depth) {
            entries.push(entry);
            index = next_index;
        } else {
            index += 1;
        }
    }
    ParsedBlock {
        value: YamlValue::Mapping(entries),
        index,
    }
}

fn sequence_rest(line: &YamlLine) -> &str {
    line.content.strip_prefix('-').unwrap_or_default().trim()
}

fn parse_sequence_item(
    lines: &[YamlLine],
    index: usize,
    indent: usize,
    issues: &mut Vec<String>,
    depth: usize,
) -> ParsedBlock {
    let current = &lines[index];
    let rest = sequence_rest(current);
    if is_block_scalar_header(rest) || unsupported_yaml_value(rest) {
        let value = parse_value(rest, current.line, issues, depth + 1);
        let next_index = if has_nested_block_value(lines.get(index + 1), indent) {
            skip_nested_lines(lines, index + 1, indent)
        } else {
            index + 1
        };
        return ParsedBlock {
            value,
            index: next_index,
        };
    }
    if let Some(parsed) = pair(rest) {
        let mut entries = Vec::new();
        let mut next_index = index + 1;
        let next = lines.get(next_index);
        let value = if parsed.value.is_empty() && has_nested_block_value(next, indent) {
            let child_indent = next.map_or(indent, |line| line.indent);
            let child = parse_block(lines, next_index, child_indent, issues, depth + 1);
            next_index = child.index;
            child.value
        } else {
            parse_value(&parsed.value, current.line, issues, depth + 1)
        };
        entries.push(YamlMappingEntry {
            key: parsed.key,
            value,
        });

        if lines
            .get(next_index)
            .is_some_and(|line| line.indent > indent && !is_sequence_line(line))
        {
            let continuation_indent = lines[next_index].indent;
            let continuation = parse_map(lines, next_index, continuation_indent, issues, depth + 1);
            if let YamlValue::Mapping(additional) = continuation.value {
                entries.extend(additional);
            }
            next_index = continuation.index;
        }
        return ParsedBlock {
            value: YamlValue::Mapping(entries),
            index: next_index,
        };
    }

    if rest.is_empty() && has_nested_block_value(lines.get(index + 1), indent) {
        let child_indent = lines.get(index + 1).map_or(indent, |line| line.indent);
        return parse_block(lines, index + 1, child_indent, issues, depth + 1);
    }

    ParsedBlock {
        value: parse_value(rest, current.line, issues, depth + 1),
        index: index + 1,
    }
}

fn parse_sequence(
    lines: &[YamlLine],
    start: usize,
    indent: usize,
    issues: &mut Vec<String>,
    depth: usize,
) -> ParsedBlock {
    let mut values = Vec::new();
    let mut index = start;
    while lines
        .get(index)
        .is_some_and(|line| line.indent == indent && is_sequence_line(line))
    {
        let item = parse_sequence_item(lines, index, indent, issues, depth);
        values.push(item.value);
        index = item.index;
    }
    ParsedBlock {
        value: YamlValue::Sequence(values),
        index,
    }
}

pub(crate) fn parse_mapping(source: &str) -> YamlParseResult {
    let mut issues = Vec::new();
    let lines = tokenize(source, &mut issues);
    let Some(first) = lines.first() else {
        return YamlParseResult {
            entries: Vec::new(),
            issues,
        };
    };

    let parsed = parse_block(&lines, 0, first.indent, &mut issues, 0);
    let entries = match parsed.value {
        YamlValue::Mapping(entries) => entries,
        _ => {
            issues.push(format!(
                "line {}: YAML frontmatter must be a mapping",
                first.line
            ));
            Vec::new()
        }
    };
    if parsed.index < lines.len() {
        let line = lines[parsed.index].line;
        issues.push(format!(
            "line {line}: YAML content could not be represented"
        ));
    }

    YamlParseResult { entries, issues }
}

#[derive(Clone, Copy)]
struct SourceYamlLine {
    indent: usize,
    start: usize,
    end: usize,
}

fn source_lines(
    source: &str,
    source_offset: usize,
) -> Result<Vec<SourceYamlLine>, super::MarkdownPropertyEditError> {
    let mut lines = Vec::new();
    for (start, end) in line_ranges(source) {
        let raw = &source[start..end];
        let indent = raw
            .as_bytes()
            .iter()
            .take_while(|byte| **byte == b' ')
            .count();
        if raw.as_bytes().get(indent) == Some(&b'\t') {
            return Err(super::MarkdownPropertyEditError::UnsupportedPath);
        }
        if strip_comment(&raw[indent..]).trim().is_empty() {
            continue;
        }
        lines.push(SourceYamlLine {
            indent,
            start: source_offset + start,
            end: source_offset + end,
        });
    }
    Ok(lines)
}

fn source_sequence_line(bytes: &[u8], line: SourceYamlLine) -> bool {
    bytes
        .get(line.start + line.indent..line.end)
        .is_some_and(|content| content == b"-" || content.starts_with(b"- "))
}

fn source_block_end(
    bytes: &[u8],
    lines: &[SourceYamlLine],
    start: usize,
    end: usize,
    parent_indent: usize,
) -> usize {
    let mut index = start;
    while index < end {
        let line = lines[index];
        if line.indent > parent_indent
            || (line.indent == parent_indent && source_sequence_line(bytes, line))
        {
            index += 1;
        } else {
            break;
        }
    }
    index
}

fn source_line_property(
    bytes: &[u8],
    line: SourceYamlLine,
    sequence_head: bool,
) -> Result<super::MarkdownPropertySource, super::MarkdownPropertyEditError> {
    let content_start = line.start + line.indent;
    super::source_property(
        &bytes[content_start..line.end],
        content_start,
        sequence_head,
    )
    .ok_or(super::MarkdownPropertyEditError::UnsupportedPath)
}

fn source_value<'a>(
    bytes: &'a [u8],
    span: super::SourceSpan,
) -> Result<&'a str, super::MarkdownPropertyEditError> {
    std::str::from_utf8(
        bytes
            .get(span.start..span.end)
            .ok_or(super::MarkdownPropertyEditError::UnsupportedPath)?,
    )
    .map_err(|_| super::MarkdownPropertyEditError::UnsupportedPath)
}

fn validate_leaf_span(
    bytes: &[u8],
    span: super::SourceSpan,
) -> Result<super::SourceSpan, super::MarkdownPropertyEditError> {
    let value = source_value(bytes, span)?;
    if value.is_empty() || is_block_scalar_header(value) {
        return Err(super::MarkdownPropertyEditError::StructuredValue);
    }
    if (value.starts_with('{') && flow_mapping_entry_sources(value).is_none())
        || (value.starts_with('[') && flow_sequence_entry_sources(value).is_none())
    {
        return Err(super::MarkdownPropertyEditError::UnsupportedPath);
    }
    Ok(span)
}

fn next_block_child(
    bytes: &[u8],
    lines: &[SourceYamlLine],
    index: usize,
    end: usize,
    parent_indent: usize,
) -> Result<(usize, usize), super::MarkdownPropertyEditError> {
    let child = index + 1;
    let Some(line) = lines.get(child).copied().filter(|_| child < end) else {
        return Err(super::MarkdownPropertyEditError::PropertyNotRepresented);
    };
    if line.indent < parent_indent
        || (line.indent == parent_indent && !source_sequence_line(bytes, line))
    {
        return Err(super::MarkdownPropertyEditError::PropertyNotRepresented);
    }
    let child_end = source_block_end(bytes, lines, child, end, parent_indent);
    Ok((child, child_end))
}

fn resolve_property_value(
    bytes: &[u8],
    lines: &[SourceYamlLine],
    index: usize,
    end: usize,
    parent_indent: usize,
    property: &super::MarkdownPropertySource,
    path: &[super::MarkdownPropertyPathSegment],
    path_index: usize,
) -> Result<super::SourceSpan, super::MarkdownPropertyEditError> {
    if path_index + 1 == path.len() {
        return validate_leaf_span(bytes, property.value_span);
    }

    let raw_value = source_value(bytes, property.value_span)?;
    if raw_value.is_empty() {
        let (child, child_end) = next_block_child(bytes, lines, index, end, parent_indent)?;
        let child_line = lines[child];
        return match path.get(path_index + 1) {
            Some(super::MarkdownPropertyPathSegment::Index(_))
                if source_sequence_line(bytes, child_line) =>
            {
                resolve_block_sequence(
                    bytes,
                    lines,
                    child,
                    child_end,
                    child_line.indent,
                    path,
                    path_index + 1,
                )
            }
            Some(super::MarkdownPropertyPathSegment::Key(_))
                if !source_sequence_line(bytes, child_line) =>
            {
                resolve_block_mapping(
                    bytes,
                    lines,
                    child,
                    child_end,
                    child_line.indent,
                    path,
                    path_index + 1,
                )
            }
            _ => Err(super::MarkdownPropertyEditError::UnsupportedPath),
        };
    }

    resolve_inline_value(bytes, property.value_span, path, path_index + 1)
}

fn resolve_inline_value(
    bytes: &[u8],
    value_span: super::SourceSpan,
    path: &[super::MarkdownPropertyPathSegment],
    path_index: usize,
) -> Result<super::SourceSpan, super::MarkdownPropertyEditError> {
    let value = source_value(bytes, value_span)?;
    match path.get(path_index) {
        Some(super::MarkdownPropertyPathSegment::Key(wanted)) if value.starts_with('{') => {
            let entries = flow_mapping_entry_sources(value)
                .ok_or(super::MarkdownPropertyEditError::UnsupportedPath)?;
            let mut found = None;
            for entry in entries.into_iter().filter(|entry| entry.key == *wanted) {
                if found.is_some() {
                    return Err(super::MarkdownPropertyEditError::UnsupportedPath);
                }
                found = Some(entry);
            }
            let entry = found.ok_or(super::MarkdownPropertyEditError::PropertyNotRepresented)?;
            let span = super::SourceSpan {
                start: value_span.start + entry.value_start,
                end: value_span.start + entry.value_end,
            };
            if path_index + 1 == path.len() {
                validate_leaf_span(bytes, span)
            } else {
                resolve_inline_value(bytes, span, path, path_index + 1)
            }
        }
        Some(super::MarkdownPropertyPathSegment::Index(wanted)) if value.starts_with('[') => {
            let entries = flow_sequence_entry_sources(value)
                .ok_or(super::MarkdownPropertyEditError::UnsupportedPath)?;
            let (start, end) = entries
                .get(*wanted)
                .copied()
                .ok_or(super::MarkdownPropertyEditError::PropertyNotRepresented)?;
            let span = super::SourceSpan {
                start: value_span.start + start,
                end: value_span.start + end,
            };
            if path_index + 1 == path.len() {
                validate_leaf_span(bytes, span)
            } else {
                resolve_inline_value(bytes, span, path, path_index + 1)
            }
        }
        Some(_) => Err(super::MarkdownPropertyEditError::UnsupportedPath),
        None => validate_leaf_span(bytes, value_span),
    }
}

fn resolve_block_mapping(
    bytes: &[u8],
    lines: &[SourceYamlLine],
    start: usize,
    end: usize,
    indent: usize,
    path: &[super::MarkdownPropertyPathSegment],
    path_index: usize,
) -> Result<super::SourceSpan, super::MarkdownPropertyEditError> {
    let Some(super::MarkdownPropertyPathSegment::Key(wanted)) = path.get(path_index) else {
        return Err(super::MarkdownPropertyEditError::UnsupportedPath);
    };
    if wanted.trim().is_empty() {
        return Err(super::MarkdownPropertyEditError::InvalidPath);
    }

    let mut found = None;
    let mut previous_mapping_value_is_empty = false;
    let mut index = start;
    while index < end {
        let line = lines[index];
        if line.indent < indent {
            break;
        }
        if line.indent != indent {
            previous_mapping_value_is_empty = false;
            index += 1;
            continue;
        }
        if source_sequence_line(bytes, line) {
            if !previous_mapping_value_is_empty {
                return Err(super::MarkdownPropertyEditError::UnsupportedPath);
            }
            index = source_block_end(bytes, lines, index, end, indent);
            previous_mapping_value_is_empty = false;
            continue;
        }
        let property = source_line_property(bytes, line, false)?;
        previous_mapping_value_is_empty = property.value_span.start == property.value_span.end;
        if property.key == *wanted {
            if found.is_some() {
                return Err(super::MarkdownPropertyEditError::UnsupportedPath);
            }
            found = Some((index, property));
        }
        index += 1;
    }
    let (index, property) =
        found.ok_or(super::MarkdownPropertyEditError::PropertyNotRepresented)?;
    resolve_property_value(
        bytes, lines, index, end, indent, &property, path, path_index,
    )
}

fn source_sequence_item_end(
    lines: &[SourceYamlLine],
    start: usize,
    end: usize,
    indent: usize,
) -> usize {
    let mut item_end = start + 1;
    while item_end < end && lines[item_end].indent > indent {
        item_end += 1;
    }
    item_end
}

fn sequence_continuation_has_key(
    bytes: &[u8],
    lines: &[SourceYamlLine],
    start: usize,
    item_end: usize,
    mapping_indent: usize,
    wanted: &str,
) -> Result<bool, super::MarkdownPropertyEditError> {
    for index in start + 1..item_end {
        let line = lines[index];
        if line.indent < mapping_indent {
            break;
        }
        if line.indent != mapping_indent {
            continue;
        }
        if source_sequence_line(bytes, line) {
            return Err(super::MarkdownPropertyEditError::UnsupportedPath);
        }
        if source_line_property(bytes, line, false)?.key == wanted {
            return Ok(true);
        }
    }
    Ok(false)
}

fn resolve_block_sequence_item(
    bytes: &[u8],
    lines: &[SourceYamlLine],
    start: usize,
    item_end: usize,
    indent: usize,
    path: &[super::MarkdownPropertyPathSegment],
    path_index: usize,
) -> Result<super::SourceSpan, super::MarkdownPropertyEditError> {
    let Some(super::MarkdownPropertyPathSegment::Key(wanted)) = path.get(path_index + 1) else {
        return Err(super::MarkdownPropertyEditError::InvalidPath);
    };
    let head = source_line_property(bytes, lines[start], true);
    if let Ok(head) = &head {
        if head.key == *wanted {
            let mapping_indent = head.key_span.start - lines[start].start;
            if sequence_continuation_has_key(bytes, lines, start, item_end, mapping_indent, wanted)?
            {
                return Err(super::MarkdownPropertyEditError::UnsupportedPath);
            }
            return resolve_property_value(
                bytes,
                lines,
                start,
                item_end,
                indent,
                &head,
                path,
                path_index + 1,
            );
        }
        if head.value_span.start == head.value_span.end {
            return Err(super::MarkdownPropertyEditError::UnsupportedPath);
        }
    } else {
        let content = &bytes[lines[start].start + indent..lines[start].end];
        let is_bare_item =
            std::str::from_utf8(content).is_ok_and(|content| strip_comment(content).trim() == "-");
        if !is_bare_item {
            return Err(super::MarkdownPropertyEditError::UnsupportedPath);
        }
    }

    let continuation = start + 1;
    let Some(line) = lines
        .get(continuation)
        .copied()
        .filter(|_| continuation < item_end && lines[continuation].indent > indent)
    else {
        return Err(super::MarkdownPropertyEditError::PropertyNotRepresented);
    };
    if source_sequence_line(bytes, line) {
        return Err(super::MarkdownPropertyEditError::UnsupportedPath);
    }
    resolve_block_mapping(
        bytes,
        lines,
        continuation,
        item_end,
        line.indent,
        path,
        path_index + 1,
    )
}

fn resolve_block_sequence(
    bytes: &[u8],
    lines: &[SourceYamlLine],
    start: usize,
    end: usize,
    indent: usize,
    path: &[super::MarkdownPropertyPathSegment],
    path_index: usize,
) -> Result<super::SourceSpan, super::MarkdownPropertyEditError> {
    let Some(super::MarkdownPropertyPathSegment::Index(wanted)) = path.get(path_index) else {
        return Err(super::MarkdownPropertyEditError::UnsupportedPath);
    };
    let mut item_number = 0;
    let mut index = start;
    while index < end {
        let line = lines[index];
        if line.indent < indent {
            break;
        }
        if line.indent != indent || !source_sequence_line(bytes, line) {
            break;
        }
        let item_end = source_sequence_item_end(lines, index, end, indent);
        if item_number == *wanted {
            return resolve_block_sequence_item(
                bytes, lines, index, item_end, indent, path, path_index,
            );
        }
        item_number += 1;
        index = item_end;
    }
    Err(super::MarkdownPropertyEditError::PropertyNotRepresented)
}

/// Resolve an explicit nested property path to the exact original value bytes.
pub(crate) fn nested_property_value_span(
    source: &str,
    source_offset: usize,
    source_bytes: &[u8],
    path: &[super::MarkdownPropertyPathSegment],
) -> Result<super::SourceSpan, super::MarkdownPropertyEditError> {
    if path.is_empty() || path.len() > MAX_NESTING_DEPTH {
        return Err(super::MarkdownPropertyEditError::InvalidPath);
    }
    let Some(super::MarkdownPropertyPathSegment::Key(root_key)) = path.first() else {
        return Err(super::MarkdownPropertyEditError::InvalidPath);
    };
    if root_key.trim().is_empty() {
        return Err(super::MarkdownPropertyEditError::InvalidPath);
    }

    let lines = source_lines(source, source_offset)?;
    let end = lines.len();
    let Some(first) = lines.first() else {
        return Err(super::MarkdownPropertyEditError::PropertyNotRepresented);
    };
    resolve_block_mapping(source_bytes, &lines, 0, end, first.indent, path, 0)
}
