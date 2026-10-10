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
    let Some(&first) = bytes.first() else {
        return None;
    };
    let reserved_indicator = matches!(
        first,
        b'!' | b'&' | b'*' | b'[' | b']' | b'{' | b'}' | b',' | b'#' | b'|' | b'>'
            | b'\'' | b'"' | b'%' | b'@' | b'`'
    ) || (matches!(first, b'-' | b'?' | b':')
        && bytes
            .get(1)
            .is_none_or(|byte| byte.is_ascii_whitespace()));
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

fn split_flow_parts(value: &str) -> Option<Vec<&str>> {
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
                parts.push(value[start..index].trim());
                start = index + 1;
            }
            _ => {}
        }
        index += 1;
    }

    if quote.is_some() || !delimiters.is_empty() {
        return None;
    }
    parts.push(value[start..].trim());
    Some(parts)
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
