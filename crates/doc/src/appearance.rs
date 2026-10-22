//! Pure, bounded projection of theme/snippet CSS into appearance tokens.
//!
//! The stylesheet is untrusted data. A tolerant, hand-written scanner extracts
//! CSS custom properties from a frozen set of scopes (`:root`, `html`, `body`,
//! `.theme-light`, `.theme-dark`, and `@media (prefers-color-scheme: ...)`),
//! resolves `var()` references with depth, cycle and expansion limits, parses
//! colors and lengths, and fills [`AppearanceTokens`] per light/dark mode.
//! Everything else that was parsed but not projected is listed in an
//! [`UnsupportedReport`]; nothing is dropped silently and no CSS is executed.
//!
//! Supported subset (extend only through fixtures):
//! - selectors made solely of `html`, `body`, `:root`, `.theme-light`,
//!   `.theme-dark` compounds, comma separated;
//! - `@media (prefers-color-scheme: light|dark)` (optionally after `screen and`),
//!   nested up to [`MAX_AT_RULE_NESTING`] levels;
//! - custom property declarations (`--name: value`) in those scopes;
//! - values: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()`,
//!   `hsl()/hsla()` (comma or space syntax), a small named set, `px/rem/em/pt`
//!   lengths, and font family lists as opaque text.
//!
//! Cascade approximation: the winning declaration per variable is chosen by
//! `!important`, then simple specificity (class/pseudo-class count, then type
//! selectors), then source order.

use std::collections::HashMap;

use crate::yaml::{self, YamlMappingEntry, YamlValue};

/// Maximum number of stylesheet bytes analysed; the remainder is reported as truncated.
pub const MAX_CSS_BYTES: usize = 2 * 1024 * 1024;
/// Maximum number of rules (qualified and at-rules) visited.
pub const MAX_RULES: usize = 20_000;
/// Maximum number of declarations visited.
pub const MAX_DECLARATIONS: usize = 50_000;
/// Maximum `var()` indirection depth.
pub const MAX_VARIABLE_DEPTH: usize = 16;
/// Maximum number of `var()` substitutions while resolving one value.
pub const MAX_VARIABLE_SUBSTITUTIONS: usize = 256;
/// Maximum `@media` nesting depth.
pub const MAX_AT_RULE_NESTING: usize = 4;
/// Maximum length in bytes of a single (resolved) value.
pub const MAX_VALUE_BYTES: usize = 4096;
/// Maximum number of entries stored in an [`UnsupportedReport`].
pub const MAX_REPORT_ENTRIES: usize = 1000;
const MAX_REPORT_TEXT_CHARS: usize = 120;
/// Maximum number of `@settings` blocks read.
pub const MAX_SETTINGS_BLOCKS: usize = 16;
/// Maximum number of settings read per `@settings` block.
pub const MAX_SETTINGS_PER_BLOCK: usize = 512;
/// Maximum bytes of one `@settings` YAML body.
pub const MAX_SETTINGS_YAML_BYTES: usize = 256 * 1024;

const MODE_LIGHT: u8 = 1;
const MODE_DARK: u8 = 2;
const MODE_ANY: u8 = MODE_LIGHT | MODE_DARK;

/// An 8-bit sRGB color with straight alpha.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }
}

/// Color scheme a token set is resolved for.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ThemeMode {
    Light,
    Dark,
}

impl ThemeMode {
    fn bit(self) -> u8 {
        match self {
            Self::Light => MODE_LIGHT,
            Self::Dark => MODE_DARK,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

/// Documented token set resolved for one mode. `None` means the stylesheet
/// did not define the token (or it was reported as unresolved/unparseable).
///
/// CSS variable names: `--background-primary`, `--background-secondary`,
/// `--text-normal`, `--text-muted`, `--interactive-accent`, `--text-accent`,
/// `--font-text`, `--font-monospace`, `--font-text-size`, `--font-ui-small`,
/// `--font-ui-medium`, `--radius-s`, `--radius-m`, `--radius-l`.
/// Sizes are CSS pixels (`rem`/`em` use 16px, `pt` uses 4/3).
#[derive(Clone, Debug, PartialEq)]
pub struct AppearanceTokens {
    pub mode: ThemeMode,
    pub background_primary: Option<Rgba>,
    pub background_secondary: Option<Rgba>,
    pub text_normal: Option<Rgba>,
    pub text_muted: Option<Rgba>,
    pub interactive_accent: Option<Rgba>,
    pub text_accent: Option<Rgba>,
    pub font_text: Option<String>,
    pub font_monospace: Option<String>,
    pub font_text_size_px: Option<f32>,
    pub font_ui_small_px: Option<f32>,
    pub font_ui_medium_px: Option<f32>,
    pub radius_s_px: Option<f32>,
    pub radius_m_px: Option<f32>,
    pub radius_l_px: Option<f32>,
}

impl AppearanceTokens {
    pub fn empty(mode: ThemeMode) -> Self {
        Self {
            mode,
            background_primary: None,
            background_secondary: None,
            text_normal: None,
            text_muted: None,
            interactive_accent: None,
            text_accent: None,
            font_text: None,
            font_monospace: None,
            font_text_size_px: None,
            font_ui_small_px: None,
            font_ui_medium_px: None,
            radius_s_px: None,
            radius_m_px: None,
            radius_l_px: None,
        }
    }
}

/// Category of a construct that was parsed but not projected.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UnsupportedKind {
    /// Rule whose selector is outside the supported scope set.
    Selector,
    /// Non-custom-property declaration inside a supported scope.
    Declaration,
    /// Rule nested inside another rule.
    NestedRule,
    /// At-rule other than a supported `@media`.
    AtRule,
    /// `@media` query other than `prefers-color-scheme`.
    MediaQuery,
    /// Scope that can never apply (for example `.theme-dark` in a light media query).
    ContradictoryScope,
    /// Token variable whose value could not be parsed as the expected type.
    UnparseableValue,
    /// Token variable whose `var()` chain could not be resolved.
    UnresolvedVariable,
    /// Malformed or unterminated syntax.
    MalformedSyntax,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnsupportedEntry {
    pub kind: UnsupportedKind,
    /// Clipped source text of the construct.
    pub text: String,
    pub detail: String,
    /// Byte offset into the analysed (possibly truncated) stylesheet.
    pub offset: Option<usize>,
}

/// Every construct that was parsed but not projected into tokens.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct UnsupportedReport {
    pub entries: Vec<UnsupportedEntry>,
    /// Entries beyond [`MAX_REPORT_ENTRIES`] that were counted but not stored.
    pub omitted: usize,
}

impl UnsupportedReport {
    fn add(
        &mut self,
        kind: UnsupportedKind,
        text: &str,
        detail: impl Into<String>,
        offset: Option<usize>,
    ) {
        if self.entries.len() >= MAX_REPORT_ENTRIES {
            self.omitted += 1;
            return;
        }
        self.entries.push(UnsupportedEntry {
            kind,
            text: clip(text, MAX_REPORT_TEXT_CHARS),
            detail: detail.into(),
            offset,
        });
    }

    pub fn count(&self, kind: UnsupportedKind) -> usize {
        self.entries
            .iter()
            .filter(|entry| entry.kind == kind)
            .count()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty() && self.omitted == 0
    }
}

/// A cap that was hit while analysing; the analysis is partial.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppearanceTruncation {
    InputBytes { original: usize, kept: usize },
    RuleLimit,
    DeclarationLimit,
    NestingDepth,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AppearanceAnalysis {
    pub light: AppearanceTokens,
    pub dark: AppearanceTokens,
    pub report: UnsupportedReport,
    pub truncations: Vec<AppearanceTruncation>,
    pub rule_count: usize,
    pub declaration_count: usize,
    pub custom_property_count: usize,
}

impl AppearanceAnalysis {
    pub fn tokens(&self, mode: ThemeMode) -> &AppearanceTokens {
        match mode {
            ThemeMode::Light => &self.light,
            ThemeMode::Dark => &self.dark,
        }
    }

    pub fn is_truncated(&self) -> bool {
        !self.truncations.is_empty()
    }
}

/// Analyse a stylesheet and project tokens for both modes.
pub fn analyze_appearance_css(css: &str) -> AppearanceAnalysis {
    analyze_appearance_css_with_overrides(css, &[])
}

/// Like [`analyze_appearance_css`], with user overrides (for example Style
/// Settings values) applied above the stylesheet. Names may omit the `--` prefix.
pub fn analyze_appearance_css_with_overrides(
    css: &str,
    overrides: &[(String, String)],
) -> AppearanceAnalysis {
    let mut truncations = Vec::new();
    let text = bounded_input(css, &mut truncations);
    let (ranges, unterminated) = comment_ranges(text.as_bytes());
    let cleaned = strip_ranges(text, &ranges);

    let mut parser = Parser {
        text: &cleaned,
        decls: Vec::new(),
        report: UnsupportedReport::default(),
        truncations,
        rules: 0,
        declarations: 0,
        order: 0,
        stopped: false,
    };
    if unterminated {
        let start = ranges.last().map_or(0, |range| range.0);
        parser.report.add(
            UnsupportedKind::MalformedSyntax,
            "/*",
            "unterminated comment; remainder ignored",
            Some(start),
        );
    }
    parser.parse_items(0, cleaned.len(), MODE_ANY, 0);

    let custom_property_count = parser.decls.len();
    let mut report = std::mem::take(&mut parser.report);
    let light = project_mode(&parser.decls, ThemeMode::Light, overrides, &mut report);
    let dark = project_mode(&parser.decls, ThemeMode::Dark, overrides, &mut report);
    AppearanceAnalysis {
        light,
        dark,
        report,
        truncations: parser.truncations,
        rule_count: parser.rules,
        declaration_count: parser.declarations,
        custom_property_count,
    }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

fn clip(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    let mut out = String::new();
    for (count, ch) in trimmed.chars().enumerate() {
        if count >= max_chars {
            out.push_str("...");
            break;
        }
        out.push(if ch.is_control() { ' ' } else { ch });
    }
    out
}

fn bounded_input<'a>(css: &'a str, truncations: &mut Vec<AppearanceTruncation>) -> &'a str {
    if css.len() <= MAX_CSS_BYTES {
        return css;
    }
    let mut cut = MAX_CSS_BYTES;
    while cut > 0 && !css.is_char_boundary(cut) {
        cut -= 1;
    }
    truncations.push(AppearanceTruncation::InputBytes {
        original: css.len(),
        kept: cut,
    });
    css.get(..cut).unwrap_or("")
}

fn skip_string(bytes: &[u8], start: usize) -> usize {
    let quote = bytes[start];
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'\n' => return i,
            byte if byte == quote => return i + 1,
            _ => i += 1,
        }
    }
    bytes.len()
}

/// Comment byte ranges (`/* ... */`, end exclusive) outside strings, plus
/// whether the final comment was unterminated.
fn comment_ranges(bytes: &[u8]) -> (Vec<(usize, usize)>, bool) {
    let mut ranges = Vec::new();
    let mut unterminated = false;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' | b'\'' => i = skip_string(bytes, i),
            b'\\' => i += 2,
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                let mut j = i + 2;
                let mut end = None;
                while j + 1 < bytes.len() {
                    if bytes[j] == b'*' && bytes[j + 1] == b'/' {
                        end = Some(j + 2);
                        break;
                    }
                    j += 1;
                }
                let end = end.unwrap_or_else(|| {
                    unterminated = true;
                    bytes.len()
                });
                ranges.push((i, end));
                i = end;
            }
            _ => i += 1,
        }
    }
    (ranges, unterminated)
}

/// Replace comment ranges with spaces, preserving byte offsets.
fn strip_ranges(text: &str, ranges: &[(usize, usize)]) -> String {
    let mut bytes = text.as_bytes().to_vec();
    for &(start, end) in ranges {
        for byte in bytes.iter_mut().take(end).skip(start) {
            *byte = b' ';
        }
    }
    String::from_utf8(bytes).unwrap_or_default()
}

fn skip_ws(bytes: &[u8], mut i: usize, end: usize) -> usize {
    while i < end && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    i
}

/// Scan to the next top-level `{`, `;` or `}` (terminator byte) or `end` (0).
fn scan_prelude(bytes: &[u8], start: usize, end: usize) -> (usize, u8) {
    let mut depth = 0usize;
    let mut i = start;
    while i < end {
        match bytes[i] {
            b'"' | b'\'' => {
                i = skip_string(bytes, i);
                continue;
            }
            b'\\' => {
                i += 2;
                continue;
            }
            b'(' | b'[' => depth += 1,
            b')' | b']' => depth = depth.saturating_sub(1),
            b'{' if depth == 0 => return (i, b'{'),
            b';' if depth == 0 => return (i, b';'),
            b'}' if depth == 0 => return (i, b'}'),
            _ => {}
        }
        i += 1;
    }
    (end.min(bytes.len()), 0)
}

/// Index of the `}` matching the `{` at `open`, if any before `end`.
fn matching_brace(bytes: &[u8], open: usize, end: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut i = open;
    while i < end {
        match bytes[i] {
            b'"' | b'\'' => {
                i = skip_string(bytes, i);
                continue;
            }
            b'\\' => {
                i += 2;
                continue;
            }
            b'{' => depth += 1,
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn split_top_level(text: &str, delimiter: u8) -> Vec<&str> {
    let bytes = text.as_bytes();
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' | b'\'' => {
                i = skip_string(bytes, i);
                continue;
            }
            b'\\' => {
                i += 2;
                continue;
            }
            b'(' | b'[' => depth += 1,
            b')' | b']' => depth = depth.saturating_sub(1),
            byte if byte == delimiter && depth == 0 => {
                if let Some(part) = text.get(start..i) {
                    parts.push(part);
                }
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    if let Some(part) = text.get(start..) {
        parts.push(part);
    }
    parts
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

struct VarDecl {
    name: String,
    value: String,
    modes: u8,
    specificity: u32,
    important: bool,
    order: usize,
    offset: usize,
}

struct Parser<'a> {
    text: &'a str,
    decls: Vec<VarDecl>,
    report: UnsupportedReport,
    truncations: Vec<AppearanceTruncation>,
    rules: usize,
    declarations: usize,
    order: usize,
    stopped: bool,
}

impl Parser<'_> {
    fn slice(&self, start: usize, end: usize) -> &str {
        self.text.get(start..end).unwrap_or("")
    }

    fn truncate(&mut self, truncation: AppearanceTruncation) {
        if !self.truncations.contains(&truncation) {
            self.truncations.push(truncation);
        }
    }

    fn parse_items(&mut self, start: usize, end: usize, mode_bits: u8, depth: usize) {
        let text: &str = self.text;
        let bytes = text.as_bytes();
        let mut i = start;
        while !self.stopped {
            i = skip_ws(bytes, i, end);
            if i >= end {
                return;
            }
            if bytes[i] == b'}' {
                self.report.add(
                    UnsupportedKind::MalformedSyntax,
                    "}",
                    "unmatched closing brace",
                    Some(i),
                );
                i += 1;
            } else if bytes[i] == b'@' {
                i = self.at_rule(i, end, mode_bits, depth);
            } else {
                i = self.qualified_rule(i, end, mode_bits);
            }
        }
    }

    fn count_rule(&mut self) -> bool {
        self.rules += 1;
        if self.rules > MAX_RULES {
            self.truncate(AppearanceTruncation::RuleLimit);
            self.stopped = true;
            return false;
        }
        true
    }

    fn at_rule(&mut self, start: usize, end: usize, mode_bits: u8, depth: usize) -> usize {
        if !self.count_rule() {
            return end;
        }
        let text: &str = self.text;
        let bytes = text.as_bytes();
        let (pos, term) = scan_prelude(bytes, start, end);
        let head = self.slice(start, pos).trim().to_string();
        if term != b'{' {
            self.report.add(
                UnsupportedKind::AtRule,
                &head,
                "at-rule statement is not projected",
                Some(start),
            );
            return if term == b';' {
                pos + 1
            } else {
                pos.max(start + 1)
            };
        }
        let close = matching_brace(bytes, pos, end);
        let inner_end = close.unwrap_or(end);
        let next = close.map_or(end, |index| index + 1);
        if close.is_none() {
            self.report.add(
                UnsupportedKind::MalformedSyntax,
                &head,
                "unterminated block",
                Some(start),
            );
        }
        let name: String = head
            .chars()
            .skip(1)
            .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '-')
            .collect::<String>()
            .to_ascii_lowercase();
        if name != "media" {
            self.report.add(
                UnsupportedKind::AtRule,
                &head,
                "at-rule block is not projected",
                Some(start),
            );
            return next;
        }
        let Some(media_bits) = media_mode_bits(head.get(1 + name.len()..).unwrap_or("")) else {
            self.report.add(
                UnsupportedKind::MediaQuery,
                &head,
                "only prefers-color-scheme media queries are projected",
                Some(start),
            );
            return next;
        };
        if depth + 1 > MAX_AT_RULE_NESTING {
            self.truncate(AppearanceTruncation::NestingDepth);
            self.report.add(
                UnsupportedKind::AtRule,
                &head,
                "@media nesting too deep",
                Some(start),
            );
            return next;
        }
        let combined = mode_bits & media_bits;
        if combined == 0 {
            self.report.add(
                UnsupportedKind::ContradictoryScope,
                &head,
                "media query can never apply inside the enclosing scope",
                Some(start),
            );
            return next;
        }
        self.parse_items(pos + 1, inner_end, combined, depth + 1);
        next
    }

    fn qualified_rule(&mut self, start: usize, end: usize, mode_bits: u8) -> usize {
        let text: &str = self.text;
        let bytes = text.as_bytes();
        let (pos, term) = scan_prelude(bytes, start, end);
        if term != b'{' {
            let text = self.slice(start, pos).to_string();
            self.report.add(
                UnsupportedKind::MalformedSyntax,
                &text,
                "rule without a block",
                Some(start),
            );
            return if term == b';' {
                pos + 1
            } else {
                pos.max(start + 1)
            };
        }
        if !self.count_rule() {
            return end;
        }
        let close = matching_brace(bytes, pos, end);
        let inner_end = close.unwrap_or(end);
        let next = close.map_or(end, |index| index + 1);
        let selector = self.slice(start, pos).trim().to_string();
        if close.is_none() {
            self.report.add(
                UnsupportedKind::MalformedSyntax,
                &selector,
                "unterminated block",
                Some(start),
            );
        }

        let mut accepted: Vec<(u8, u32)> = Vec::new();
        for part in split_top_level(&selector, b',') {
            match classify_selector(part) {
                None => self.report.add(
                    UnsupportedKind::Selector,
                    part,
                    "selector is outside the supported scope set; rule not projected",
                    Some(start),
                ),
                Some((bits, specificity)) => {
                    let effective = bits & mode_bits;
                    if effective == 0 {
                        self.report.add(
                            UnsupportedKind::ContradictoryScope,
                            part,
                            "scope can never apply under the enclosing media query",
                            Some(start),
                        );
                    } else {
                        accepted.push((effective, specificity));
                    }
                }
            }
        }
        if !accepted.is_empty() {
            self.parse_declarations(pos + 1, inner_end, &accepted, &selector);
        }
        next
    }

    fn parse_declarations(
        &mut self,
        start: usize,
        end: usize,
        accepted: &[(u8, u32)],
        selector: &str,
    ) {
        let text: &str = self.text;
        let bytes = text.as_bytes();
        let mut i = start;
        while !self.stopped {
            i = skip_ws(bytes, i, end);
            if i >= end {
                return;
            }
            let (pos, term) = scan_prelude(bytes, i, end);
            if term == b'{' {
                let nested = self.slice(i, pos).to_string();
                self.report.add(
                    UnsupportedKind::NestedRule,
                    &nested,
                    "nested rules are not projected",
                    Some(i),
                );
                let close = matching_brace(bytes, pos, end);
                i = close.map_or(end, |index| index + 1);
                continue;
            }
            let segment_start = i;
            let segment = self.slice(i, pos).to_string();
            i = pos + 1;
            self.declaration(&segment, segment_start, accepted, selector);
        }
    }

    fn declaration(
        &mut self,
        segment: &str,
        offset: usize,
        accepted: &[(u8, u32)],
        selector: &str,
    ) {
        let trimmed = segment.trim();
        if trimmed.is_empty() {
            return;
        }
        self.declarations += 1;
        if self.declarations > MAX_DECLARATIONS {
            self.truncate(AppearanceTruncation::DeclarationLimit);
            self.stopped = true;
            return;
        }
        let Some(colon) = trimmed.find(':') else {
            self.report.add(
                UnsupportedKind::MalformedSyntax,
                trimmed,
                "declaration without a colon",
                Some(offset),
            );
            return;
        };
        let name = trimmed.get(..colon).unwrap_or("").trim();
        let mut value = trimmed.get(colon + 1..).unwrap_or("").trim();
        let mut important = false;
        let lowered = value.to_ascii_lowercase();
        if lowered.ends_with("!important") {
            important = true;
            value = value
                .get(..value.len() - "!important".len())
                .unwrap_or("")
                .trim();
        }
        if !name.starts_with("--") || name.len() <= 2 {
            self.report.add(
                UnsupportedKind::Declaration,
                &format!("{selector} {{ {name} }}"),
                "only custom properties are projected",
                Some(offset),
            );
            return;
        }
        if value.len() > MAX_VALUE_BYTES {
            self.report.add(
                UnsupportedKind::UnparseableValue,
                name,
                "custom property value exceeds the size cap",
                Some(offset),
            );
            return;
        }
        for &(modes, specificity) in accepted {
            self.order += 1;
            self.decls.push(VarDecl {
                name: name.to_string(),
                value: value.to_string(),
                modes,
                specificity,
                important,
                order: self.order,
                offset,
            });
        }
    }
}

/// `prefers-color-scheme` media prelude to mode bits.
fn media_mode_bits(prelude: &str) -> Option<u8> {
    let compact: String = prelude
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    let query = compact.strip_prefix("screenand").unwrap_or(&compact);
    match query {
        "(prefers-color-scheme:dark)" => Some(MODE_DARK),
        "(prefers-color-scheme:light)" => Some(MODE_LIGHT),
        _ => None,
    }
}

fn strip_compound<'a>(text: &'a str, keyword: &str, case_insensitive: bool) -> Option<&'a str> {
    let head = text.get(..keyword.len())?;
    let matches = if case_insensitive {
        head.eq_ignore_ascii_case(keyword)
    } else {
        head == keyword
    };
    if !matches {
        return None;
    }
    let rest = text.get(keyword.len()..)?;
    match rest.chars().next() {
        None | Some('.') | Some(':') => Some(rest),
        _ => None,
    }
}

/// Classify one comma-free selector into (mode bits, specificity).
fn classify_selector(selector: &str) -> Option<(u8, u32)> {
    let mut rest = selector.trim();
    if rest.is_empty() {
        return None;
    }
    let mut bits = MODE_ANY;
    let mut specificity = 0u32;
    while !rest.is_empty() {
        if let Some(next) =
            strip_compound(rest, "html", true).or_else(|| strip_compound(rest, "body", true))
        {
            specificity += 1;
            rest = next;
        } else if let Some(next) = strip_compound(rest, ":root", true) {
            specificity += 100;
            rest = next;
        } else if let Some(next) = strip_compound(rest, ".theme-light", false) {
            bits &= MODE_LIGHT;
            specificity += 100;
            rest = next;
        } else if let Some(next) = strip_compound(rest, ".theme-dark", false) {
            bits &= MODE_DARK;
            specificity += 100;
            rest = next;
        } else {
            return None;
        }
    }
    Some((bits, specificity))
}

// ---------------------------------------------------------------------------
// var() resolution
// ---------------------------------------------------------------------------

#[derive(Debug, Eq, PartialEq)]
enum ResolveError {
    Cycle(String),
    Depth,
    Undefined(String),
    TooLong,
    Syntax,
}

impl ResolveError {
    fn describe(&self) -> String {
        match self {
            Self::Cycle(name) => format!("cyclic reference through {name}"),
            Self::Depth => format!("var() nesting deeper than {MAX_VARIABLE_DEPTH}"),
            Self::Undefined(name) => format!("undefined variable {name}"),
            Self::TooLong => "resolved value exceeds size or expansion cap".to_string(),
            Self::Syntax => "malformed var() expression".to_string(),
        }
    }
}

struct VarEntry {
    key: (bool, u32, usize),
    value: String,
    offset: usize,
}

struct Resolver<'a> {
    vars: &'a HashMap<String, VarEntry>,
    budget: usize,
}

fn matching_paren(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut depth = 1usize;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' | b'\'' => {
                i = skip_string(bytes, i);
                continue;
            }
            b'\\' => {
                i += 2;
                continue;
            }
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn find_var(text: &str) -> Option<usize> {
    text.match_indices("var(")
        .map(|(index, _)| index)
        .find(|&index| {
            text.get(..index)
                .and_then(|before| before.chars().next_back())
                .is_none_or(|ch| !(ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'))
        })
}

impl Resolver<'_> {
    fn resolve(
        &mut self,
        value: &str,
        depth: usize,
        stack: &mut Vec<String>,
    ) -> Result<String, ResolveError> {
        if depth > MAX_VARIABLE_DEPTH {
            return Err(ResolveError::Depth);
        }
        let vars = self.vars;
        let mut out = String::new();
        let mut rest = value;
        while let Some(pos) = find_var(rest) {
            out.push_str(rest.get(..pos).unwrap_or(""));
            let after = rest.get(pos + 4..).unwrap_or("");
            let close = matching_paren(after).ok_or(ResolveError::Syntax)?;
            let inner = after.get(..close).unwrap_or("");
            let parts = split_top_level_once(inner);
            let name = parts.0.trim();
            if self.budget == 0 {
                return Err(ResolveError::TooLong);
            }
            self.budget -= 1;
            let replacement = if let Some(entry) = vars.get(name) {
                if stack.iter().any(|seen| seen == name) {
                    return Err(ResolveError::Cycle(name.to_string()));
                }
                stack.push(name.to_string());
                let result = self.resolve(&entry.value, depth + 1, stack);
                stack.pop();
                result?
            } else if let Some(fallback) = parts.1 {
                self.resolve(fallback, depth + 1, stack)?
            } else {
                return Err(ResolveError::Undefined(name.to_string()));
            };
            out.push_str(&replacement);
            if out.len() > MAX_VALUE_BYTES {
                return Err(ResolveError::TooLong);
            }
            rest = after.get(close + 1..).unwrap_or("");
        }
        out.push_str(rest);
        if out.len() > MAX_VALUE_BYTES {
            return Err(ResolveError::TooLong);
        }
        Ok(out)
    }
}

/// Split `name, fallback` at the first top-level comma.
fn split_top_level_once(text: &str) -> (&str, Option<&str>) {
    let bytes = text.as_bytes();
    let mut depth = 0usize;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' | b'\'' => {
                i = skip_string(bytes, i);
                continue;
            }
            b'\\' => {
                i += 2;
                continue;
            }
            b'(' | b'[' => depth += 1,
            b')' | b']' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => {
                return (
                    text.get(..i).unwrap_or(""),
                    Some(text.get(i + 1..).unwrap_or("")),
                );
            }
            _ => {}
        }
        i += 1;
    }
    (text, None)
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

fn project_mode(
    decls: &[VarDecl],
    mode: ThemeMode,
    overrides: &[(String, String)],
    report: &mut UnsupportedReport,
) -> AppearanceTokens {
    let mut vars: HashMap<String, VarEntry> = HashMap::new();
    for decl in decls.iter().filter(|decl| decl.modes & mode.bit() != 0) {
        let key = (decl.important, decl.specificity, decl.order);
        let replace = vars
            .get(&decl.name)
            .is_none_or(|existing| existing.key <= key);
        if replace {
            vars.insert(
                decl.name.clone(),
                VarEntry {
                    key,
                    value: decl.value.clone(),
                    offset: decl.offset,
                },
            );
        }
    }
    for (index, (name, value)) in overrides.iter().enumerate() {
        let trimmed = name.trim();
        let full = if trimmed.starts_with("--") {
            trimmed.to_string()
        } else {
            format!("--{trimmed}")
        };
        if full.len() <= 2 || value.len() > MAX_VALUE_BYTES {
            continue;
        }
        vars.insert(
            full,
            VarEntry {
                key: (true, u32::MAX, usize::MAX - overrides.len() + index),
                value: value.trim().to_string(),
                offset: 0,
            },
        );
    }

    let mut ctx = TokenContext {
        vars: &vars,
        mode,
        report,
    };
    let mut tokens = AppearanceTokens::empty(mode);
    tokens.background_primary = ctx.color("--background-primary");
    tokens.background_secondary = ctx.color("--background-secondary");
    tokens.text_normal = ctx.color("--text-normal");
    tokens.text_muted = ctx.color("--text-muted");
    tokens.interactive_accent = ctx.color("--interactive-accent");
    tokens.text_accent = ctx.color("--text-accent");
    tokens.font_text = ctx.family("--font-text");
    tokens.font_monospace = ctx.family("--font-monospace");
    tokens.font_text_size_px = ctx.length("--font-text-size");
    tokens.font_ui_small_px = ctx.length("--font-ui-small");
    tokens.font_ui_medium_px = ctx.length("--font-ui-medium");
    tokens.radius_s_px = ctx.length("--radius-s");
    tokens.radius_m_px = ctx.length("--radius-m");
    tokens.radius_l_px = ctx.length("--radius-l");
    tokens
}

struct TokenContext<'a> {
    vars: &'a HashMap<String, VarEntry>,
    mode: ThemeMode,
    report: &'a mut UnsupportedReport,
}

impl TokenContext<'_> {
    /// Resolve a defined variable; undefined tokens yield `None` silently.
    fn resolved(&mut self, name: &str) -> Option<String> {
        let entry = self.vars.get(name)?;
        let mut resolver = Resolver {
            vars: self.vars,
            budget: MAX_VARIABLE_SUBSTITUTIONS,
        };
        let mut stack = vec![name.to_string()];
        match resolver.resolve(&entry.value, 1, &mut stack) {
            Ok(value) => Some(value.trim().to_string()),
            Err(error) => {
                self.report.add(
                    UnsupportedKind::UnresolvedVariable,
                    name,
                    format!("{} mode: {}", self.mode.label(), error.describe()),
                    Some(entry.offset),
                );
                None
            }
        }
    }

    fn reject(&mut self, name: &str, value: &str, expected: &str) {
        let offset = self.vars.get(name).map(|entry| entry.offset);
        self.report.add(
            UnsupportedKind::UnparseableValue,
            &format!("{name}: {value}"),
            format!("{} mode: not a supported {expected}", self.mode.label()),
            offset,
        );
    }

    fn color(&mut self, name: &str) -> Option<Rgba> {
        let value = self.resolved(name)?;
        let parsed = parse_css_color(&value);
        if parsed.is_none() {
            self.reject(name, &value, "color");
        }
        parsed
    }

    fn length(&mut self, name: &str) -> Option<f32> {
        let value = self.resolved(name)?;
        let parsed = parse_css_length_px(&value);
        if parsed.is_none() {
            self.reject(name, &value, "length");
        }
        parsed
    }

    fn family(&mut self, name: &str) -> Option<String> {
        let value = self.resolved(name)?;
        if value.is_empty() {
            self.reject(name, &value, "font family list");
            return None;
        }
        Some(value)
    }
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/// Parse a CSS color: hex (3/4/6/8 digits), `rgb()/rgba()`, `hsl()/hsla()`
/// in comma or space syntax, and a small named set. Anything else is `None`.
pub fn parse_css_color(input: &str) -> Option<Rgba> {
    let text = input.trim().to_ascii_lowercase();
    if text.is_empty() || text.len() > 128 {
        return None;
    }
    if let Some(hex) = text.strip_prefix('#') {
        return parse_hex(hex);
    }
    if let Some(args) = function_args(&text, "rgba").or_else(|| function_args(&text, "rgb")) {
        return parse_rgb(args);
    }
    if let Some(args) = function_args(&text, "hsla").or_else(|| function_args(&text, "hsl")) {
        return parse_hsl(args);
    }
    named_color(&text)
}

fn parse_hex(hex: &str) -> Option<Rgba> {
    if !hex.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let pair = |index: usize| u8::from_str_radix(hex.get(index..index + 2)?, 16).ok();
    let single = |index: usize| {
        let digit = u8::from_str_radix(hex.get(index..index + 1)?, 16).ok()?;
        Some(digit * 17)
    };
    match hex.len() {
        3 => Some(Rgba::new(single(0)?, single(1)?, single(2)?, 255)),
        4 => Some(Rgba::new(single(0)?, single(1)?, single(2)?, single(3)?)),
        6 => Some(Rgba::new(pair(0)?, pair(2)?, pair(4)?, 255)),
        8 => Some(Rgba::new(pair(0)?, pair(2)?, pair(4)?, pair(6)?)),
        _ => None,
    }
}

fn function_args<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let rest = text.strip_prefix(name)?.trim_start();
    let inner = rest.strip_prefix('(')?.strip_suffix(')')?;
    if inner.contains('(') || inner.contains(')') {
        return None;
    }
    Some(inner)
}

fn split_args(args: &str) -> Vec<&str> {
    args.split(|ch: char| ch == ',' || ch == '/' || ch.is_whitespace())
        .filter(|part| !part.is_empty())
        .collect()
}

fn number(text: &str) -> Option<f64> {
    let value: f64 = text.parse().ok()?;
    value.is_finite().then_some(value)
}

fn component(text: &str, percent_scale: f64) -> Option<f64> {
    match text.strip_suffix('%') {
        Some(percent) => number(percent).map(|value| value * percent_scale / 100.0),
        None => number(text),
    }
}

fn to_byte(value: f64) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

fn alpha_byte(text: Option<&&str>) -> Option<u8> {
    match text {
        None => Some(255),
        Some(alpha) => component(alpha, 1.0).map(|value| to_byte(value.clamp(0.0, 1.0) * 255.0)),
    }
}

fn parse_rgb(args: &str) -> Option<Rgba> {
    let parts = split_args(args);
    if parts.len() < 3 || parts.len() > 4 {
        return None;
    }
    let r = component(parts[0], 255.0)?;
    let g = component(parts[1], 255.0)?;
    let b = component(parts[2], 255.0)?;
    Some(Rgba::new(
        to_byte(r),
        to_byte(g),
        to_byte(b),
        alpha_byte(parts.get(3))?,
    ))
}

/// `60%` or a bare `60` as a 0..=1 fraction.
fn percent_fraction(text: &str) -> Option<f64> {
    let value = number(text.strip_suffix('%').unwrap_or(text))?;
    Some((value / 100.0).clamp(0.0, 1.0))
}

fn parse_hsl(args: &str) -> Option<Rgba> {
    let parts = split_args(args);
    if parts.len() < 3 || parts.len() > 4 {
        return None;
    }
    let hue_text = parts[0];
    let raw_hue = if let Some(deg) = hue_text.strip_suffix("deg") {
        number(deg)?
    } else if let Some(turn) = hue_text.strip_suffix("turn") {
        number(turn)? * 360.0
    } else {
        number(hue_text)?
    };
    let hue = raw_hue.rem_euclid(360.0);
    let saturation = percent_fraction(parts[1])?;
    let lightness = percent_fraction(parts[2])?;
    let a = saturation * lightness.min(1.0 - lightness);
    let channel = |n: f64| {
        let k = (n + hue / 30.0).rem_euclid(12.0);
        let t = (k - 3.0).min(9.0 - k).clamp(-1.0, 1.0);
        to_byte((lightness - a * t) * 255.0)
    };
    Some(Rgba::new(
        channel(0.0),
        channel(8.0),
        channel(4.0),
        alpha_byte(parts.get(3))?,
    ))
}

fn named_color(name: &str) -> Option<Rgba> {
    let (r, g, b, a) = match name {
        "transparent" => (0, 0, 0, 0),
        "black" => (0, 0, 0, 255),
        "white" => (255, 255, 255, 255),
        "red" => (255, 0, 0, 255),
        "green" => (0, 128, 0, 255),
        "blue" => (0, 0, 255, 255),
        "yellow" => (255, 255, 0, 255),
        "orange" => (255, 165, 0, 255),
        "purple" => (128, 0, 128, 255),
        "gray" | "grey" => (128, 128, 128, 255),
        "silver" => (192, 192, 192, 255),
        "cyan" | "aqua" => (0, 255, 255, 255),
        "magenta" | "fuchsia" => (255, 0, 255, 255),
        "navy" => (0, 0, 128, 255),
        "teal" => (0, 128, 128, 255),
        "maroon" => (128, 0, 0, 255),
        _ => return None,
    };
    Some(Rgba::new(r, g, b, a))
}

/// Parse a non-negative length into CSS pixels (`px`, `rem`/`em` at 16px,
/// `pt` at 4/3, or a bare `0`).
pub fn parse_css_length_px(input: &str) -> Option<f32> {
    let text = input.trim().to_ascii_lowercase();
    let (digits, factor) = if let Some(value) = text.strip_suffix("rem") {
        (value, 16.0)
    } else if let Some(value) = text.strip_suffix("em") {
        (value, 16.0)
    } else if let Some(value) = text.strip_suffix("px") {
        (value, 1.0)
    } else if let Some(value) = text.strip_suffix("pt") {
        (value, 4.0 / 3.0)
    } else if text == "0" {
        return Some(0.0);
    } else {
        return None;
    };
    let value = number(digits.trim())? * factor;
    (0.0..=10_000.0).contains(&value).then_some(value as f32)
}

// ---------------------------------------------------------------------------
// Style Settings `@settings` blocks
// ---------------------------------------------------------------------------

/// Type of a Style Settings entry.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StyleSettingKind {
    Heading {
        level: u8,
    },
    ClassToggle,
    VariableText,
    VariableNumber,
    VariableColor,
    VariableSelect,
    /// Recognised syntax with a type this projection does not support.
    Unsupported(String),
}

#[derive(Clone, Debug, PartialEq)]
pub enum StyleSettingDefault {
    None,
    Bool(bool),
    Number(f64),
    Text(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StyleSettingOption {
    pub value: String,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StyleSetting {
    /// Class name for `ClassToggle`, CSS variable name (without `--`) for variables.
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub kind: StyleSettingKind,
    pub default: StyleSettingDefault,
    pub default_light: Option<String>,
    pub default_dark: Option<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub format: Option<String>,
    pub options: Vec<StyleSettingOption>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct StyleSettingsBlock {
    pub id: String,
    pub name: String,
    pub settings: Vec<StyleSetting>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct StyleSettingsParse {
    pub blocks: Vec<StyleSettingsBlock>,
    /// Non-fatal problems: YAML issues, skipped entries, truncation.
    pub issues: Vec<String>,
}

/// Read every `/* @settings ... */` comment block as data. Nothing is executed
/// and malformed entries are skipped with an issue.
pub fn parse_style_settings(css: &str) -> StyleSettingsParse {
    let mut result = StyleSettingsParse::default();
    let mut truncations = Vec::new();
    let text = bounded_input(css, &mut truncations);
    if !truncations.is_empty() {
        result
            .issues
            .push("stylesheet truncated before reading @settings".to_string());
    }
    let (ranges, _) = comment_ranges(text.as_bytes());
    for (start, end) in ranges {
        let inner = text.get(start + 2..end).unwrap_or("");
        let inner = inner.strip_suffix("*/").unwrap_or(inner);
        let Some(body) = inner.trim_start().strip_prefix("@settings") else {
            continue;
        };
        if result.blocks.len() >= MAX_SETTINGS_BLOCKS {
            result.issues.push(format!(
                "more than {MAX_SETTINGS_BLOCKS} @settings blocks; rest ignored"
            ));
            break;
        }
        if body.len() > MAX_SETTINGS_YAML_BYTES {
            result
                .issues
                .push("@settings block exceeds the size cap; skipped".to_string());
            continue;
        }
        let parsed = yaml::parse_mapping(body);
        result
            .issues
            .extend(parsed.issues.iter().map(|issue| format!("yaml: {issue}")));
        match settings_block(&parsed.entries, &mut result.issues) {
            Some(block) => result.blocks.push(block),
            None => result
                .issues
                .push("@settings block without an id; skipped".to_string()),
        }
    }
    result
}

fn yaml_get<'a>(entries: &'a [YamlMappingEntry], key: &str) -> Option<&'a YamlValue> {
    entries
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| &entry.value)
}

fn yaml_text(value: &YamlValue) -> Option<String> {
    match value {
        YamlValue::String(text) | YamlValue::Number(text) => Some(text.clone()),
        YamlValue::Boolean(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn yaml_f64(value: &YamlValue) -> Option<f64> {
    match value {
        YamlValue::Number(text) | YamlValue::String(text) => number(text.trim()),
        _ => None,
    }
}

fn yaml_field(entries: &[YamlMappingEntry], key: &str) -> Option<String> {
    yaml_get(entries, key).and_then(yaml_text)
}

fn settings_block(
    entries: &[YamlMappingEntry],
    issues: &mut Vec<String>,
) -> Option<StyleSettingsBlock> {
    let id = yaml_field(entries, "id").filter(|id| !id.is_empty())?;
    let name = yaml_field(entries, "name").unwrap_or_else(|| id.clone());
    let mut settings = Vec::new();
    if let Some(YamlValue::Sequence(items)) = yaml_get(entries, "settings") {
        for item in items {
            if settings.len() >= MAX_SETTINGS_PER_BLOCK {
                issues.push(format!(
                    "@settings {id}: more than {MAX_SETTINGS_PER_BLOCK} settings; rest ignored"
                ));
                break;
            }
            match item {
                YamlValue::Mapping(fields) => match setting_from_fields(fields) {
                    Ok(setting) => settings.push(setting),
                    Err(problem) => issues.push(format!("@settings {id}: {problem}")),
                },
                _ => issues.push(format!("@settings {id}: setting entry is not a mapping")),
            }
        }
    }
    Some(StyleSettingsBlock { id, name, settings })
}

fn setting_from_fields(fields: &[YamlMappingEntry]) -> Result<StyleSetting, String> {
    let id = yaml_field(fields, "id").filter(|id| !id.is_empty());
    let kind_name =
        yaml_field(fields, "type").ok_or_else(|| "setting without a type".to_string())?;
    let kind = match kind_name.as_str() {
        "heading" => {
            let level = yaml_get(fields, "level")
                .and_then(yaml_f64)
                .map_or(1, |level| level.clamp(1.0, 6.0) as u8);
            StyleSettingKind::Heading { level }
        }
        "class-toggle" => StyleSettingKind::ClassToggle,
        "variable-text" => StyleSettingKind::VariableText,
        "variable-number" | "variable-number-slider" => StyleSettingKind::VariableNumber,
        "variable-color" | "variable-themed-color" => StyleSettingKind::VariableColor,
        "variable-select" => StyleSettingKind::VariableSelect,
        other => StyleSettingKind::Unsupported(clip(other, 40)),
    };
    let id = id.ok_or_else(|| format!("{kind_name} setting without an id"))?;
    let title = yaml_field(fields, "title").unwrap_or_else(|| id.clone());
    let default = match (yaml_get(fields, "default"), &kind) {
        (Some(YamlValue::Boolean(flag)), _) => StyleSettingDefault::Bool(*flag),
        (Some(value), StyleSettingKind::VariableNumber) => {
            yaml_f64(value).map_or(StyleSettingDefault::None, StyleSettingDefault::Number)
        }
        (Some(value), _) => {
            yaml_text(value).map_or(StyleSettingDefault::None, StyleSettingDefault::Text)
        }
        (None, _) => StyleSettingDefault::None,
    };
    let mut options = Vec::new();
    if let Some(YamlValue::Sequence(items)) = yaml_get(fields, "options") {
        for item in items.iter().take(MAX_SETTINGS_PER_BLOCK) {
            match item {
                YamlValue::Mapping(entries) => {
                    if let Some(value) = yaml_field(entries, "value") {
                        let label = yaml_field(entries, "label").unwrap_or_else(|| value.clone());
                        options.push(StyleSettingOption { value, label });
                    }
                }
                other => {
                    if let Some(value) = yaml_text(other) {
                        options.push(StyleSettingOption {
                            label: value.clone(),
                            value,
                        });
                    }
                }
            }
        }
    }
    Ok(StyleSetting {
        id,
        title,
        description: yaml_field(fields, "description"),
        kind,
        default,
        default_light: yaml_field(fields, "default-light"),
        default_dark: yaml_field(fields, "default-dark"),
        min: yaml_get(fields, "min").and_then(yaml_f64),
        max: yaml_get(fields, "max").and_then(yaml_f64),
        step: yaml_get(fields, "step").and_then(yaml_f64),
        format: yaml_field(fields, "format"),
        options,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const OBSIDIAN_DEFAULTS: &str = r#"
/* Obsidian default theme variables (excerpt) */
:root {
  --color-base-00: #ffffff;
  --color-base-20: #f6f6f6;
  --color-base-100: #222222;
  --color-accent-h: 254;
  --color-accent-s: 80%;
  --color-accent-l: 68%;
  --color-accent: hsl(var(--color-accent-h), var(--color-accent-s), var(--color-accent-l));
  --font-text-theme: Inter, -apple-system, sans-serif;
  --font-monospace-theme: 'Fira Code', monospace;
  --font-text: var(--font-text-theme);
  --font-monospace: var(--font-monospace-theme);
  --font-text-size: 16px;
  --font-ui-small: 0.8125rem;
  --font-ui-medium: 13px;
  --radius-s: 4px;
  --radius-m: 8px;
  --radius-l: 10px;
}
.theme-light {
  --background-primary: var(--color-base-00);
  --background-secondary: var(--color-base-20);
  --text-normal: var(--color-base-100);
  --text-muted: rgba(0, 0, 0, 0.5);
  --interactive-accent: var(--color-accent);
  --text-accent: #123;
}
.theme-dark {
  --background-primary: #1e1e1e;
  --background-secondary: #262626;
  --text-normal: #dadada;
  --text-muted: hsl(0 0% 60% / 50%);
  --interactive-accent: var(--color-accent);
}
.markdown-rendered h1 { font-size: 2em; --h1-color: red; }
.theme-light:hover { --x: 1; }
"#;

    #[test]
    fn golden_default_theme_light_and_dark() {
        let analysis = analyze_appearance_css(OBSIDIAN_DEFAULTS);
        let light = &analysis.light;
        assert_eq!(
            light.background_primary,
            Some(Rgba::new(255, 255, 255, 255))
        );
        assert_eq!(
            light.background_secondary,
            Some(Rgba::new(246, 246, 246, 255))
        );
        assert_eq!(light.text_normal, Some(Rgba::new(0x22, 0x22, 0x22, 255)));
        assert_eq!(light.text_muted, Some(Rgba::new(0, 0, 0, 128)));
        assert_eq!(light.text_accent, Some(Rgba::new(0x11, 0x22, 0x33, 255)));
        assert!(light.interactive_accent.is_some());
        assert_eq!(
            light.font_text.as_deref(),
            Some("Inter, -apple-system, sans-serif")
        );
        assert_eq!(
            light.font_monospace.as_deref(),
            Some("'Fira Code', monospace")
        );
        assert_eq!(light.font_text_size_px, Some(16.0));
        assert_eq!(light.font_ui_small_px, Some(13.0));
        assert_eq!(light.radius_m_px, Some(8.0));

        let dark = &analysis.dark;
        assert_eq!(
            dark.background_primary,
            Some(Rgba::new(0x1e, 0x1e, 0x1e, 255))
        );
        assert_eq!(dark.text_muted, Some(Rgba::new(153, 153, 153, 128)));
        assert_eq!(dark.interactive_accent, light.interactive_accent);
        assert_eq!(dark.text_accent, None);
        assert_eq!(analysis.tokens(ThemeMode::Dark).mode, ThemeMode::Dark);
    }

    #[test]
    fn unsupported_constructs_are_reported() {
        let analysis = analyze_appearance_css(OBSIDIAN_DEFAULTS);
        assert!(!analysis.is_truncated());
        let report = &analysis.report;
        assert_eq!(report.count(UnsupportedKind::Selector), 2);
        assert!(
            report
                .entries
                .iter()
                .any(|entry| entry.text.contains(".markdown-rendered h1"))
        );
        assert!(
            report
                .entries
                .iter()
                .any(|entry| entry.text.contains(".theme-light:hover"))
        );
    }

    const MINIMAL_STRUCTURE: &str = r#"
/* @settings
name: Minimal
id: minimal-style
settings:
    -
        id: interface
        title: Interface
        type: heading
        level: 1
    -
        id: accent-toggle
        title: Custom accent
        type: class-toggle
        default: false
*/
@import url("https://example.com/x.css");
@charset "UTF-8";
body {
  --font-text-theme: "Inter", sans-serif;
  --font-editor-theme: var(--font-text-theme);
  --accent-h: 215;
  --accent-s: 70%;
  --font-ui-small: 13px;
}
body.theme-light, .theme-light.minimal-light {
  --background-primary: white;
  --text-normal: #1a1a1a;
}
.theme-dark, .theme-dark.minimal-default-dark {
  --background-primary: #000;
  --text-normal: #ddd;
}
@media (prefers-color-scheme: dark) {
  body { --background-secondary: #101010; }
  .theme-light { --text-muted: red; }
}
@media (max-width: 600px) { body { --radius-m: 2px; } }
@font-face { font-family: X; src: url(x.woff2); }
@keyframes spin { from { opacity: 0 } to { opacity: 1 } }
.workspace-leaf { --radius-m: 1px; color: red }
"#;

    #[test]
    fn golden_minimal_structure() {
        let analysis = analyze_appearance_css(MINIMAL_STRUCTURE);
        assert_eq!(
            analysis.light.background_primary,
            Some(Rgba::new(255, 255, 255, 255))
        );
        assert_eq!(
            analysis.light.text_normal,
            Some(Rgba::new(0x1a, 0x1a, 0x1a, 255))
        );
        assert_eq!(
            analysis.dark.background_primary,
            Some(Rgba::new(0, 0, 0, 255))
        );
        assert_eq!(
            analysis.dark.text_normal,
            Some(Rgba::new(0xdd, 0xdd, 0xdd, 255))
        );
        assert_eq!(
            analysis.dark.background_secondary,
            Some(Rgba::new(16, 16, 16, 255))
        );
        assert_eq!(analysis.light.background_secondary, None);
        assert_eq!(analysis.light.text_muted, None);
        assert_eq!(analysis.light.radius_m_px, None);
        assert_eq!(analysis.light.font_ui_small_px, Some(13.0));
        let report = &analysis.report;
        assert_eq!(report.count(UnsupportedKind::ContradictoryScope), 1);
        assert_eq!(report.count(UnsupportedKind::MediaQuery), 1);
        assert_eq!(report.count(UnsupportedKind::AtRule), 4);
        assert_eq!(report.count(UnsupportedKind::Selector), 3);
    }

    #[test]
    fn specificity_beats_source_order() {
        let css = ".theme-dark { --text-normal: #111; } body { --text-normal: #222; }";
        let analysis = analyze_appearance_css(css);
        assert_eq!(
            analysis.dark.text_normal,
            Some(Rgba::new(0x11, 0x11, 0x11, 255))
        );
        assert_eq!(
            analysis.light.text_normal,
            Some(Rgba::new(0x22, 0x22, 0x22, 255))
        );
        let important =
            "body { --text-normal: #222 !important; } .theme-dark { --text-normal: #111; }";
        let analysis = analyze_appearance_css(important);
        assert_eq!(
            analysis.dark.text_normal,
            Some(Rgba::new(0x22, 0x22, 0x22, 255))
        );
    }

    #[test]
    fn overrides_win() {
        let overrides = vec![("text-normal".to_string(), "#ff0000".to_string())];
        let analysis =
            analyze_appearance_css_with_overrides(":root { --text-normal: #000; }", &overrides);
        assert_eq!(analysis.light.text_normal, Some(Rgba::new(255, 0, 0, 255)));
        assert_eq!(analysis.dark.text_normal, Some(Rgba::new(255, 0, 0, 255)));
    }

    #[test]
    fn var_fallback_and_undefined() {
        let css =
            ":root { --text-normal: var(--missing, #0f0); --text-muted: var(--nope); --a: 1; }";
        let analysis = analyze_appearance_css(css);
        assert_eq!(analysis.light.text_normal, Some(Rgba::new(0, 255, 0, 255)));
        assert_eq!(analysis.light.text_muted, None);
        assert!(analysis.report.entries.iter().any(|entry| {
            entry.kind == UnsupportedKind::UnresolvedVariable && entry.text == "--text-muted"
        }));
    }

    #[test]
    fn cycles_are_reported_not_followed() {
        let css = ":root { --text-normal: var(--a); --a: var(--b); --b: var(--a); --text-muted: var(--text-muted); }";
        let analysis = analyze_appearance_css(css);
        assert_eq!(analysis.light.text_normal, None);
        assert_eq!(analysis.light.text_muted, None);
        assert_eq!(
            analysis.report.count(UnsupportedKind::UnresolvedVariable),
            4
        );
    }

    #[test]
    fn depth_bomb_is_bounded() {
        let mut css = String::from(":root {");
        for index in 0..200 {
            css.push_str(&format!("--v{index}: var(--v{});", index + 1));
        }
        css.push_str("--v200: #fff; --text-normal: var(--v0); --text-muted: var(--v100); }");
        let analysis = analyze_appearance_css(&css);
        assert_eq!(analysis.light.text_normal, None);
        assert_eq!(analysis.light.text_muted, None);
        assert_eq!(
            analysis.report.count(UnsupportedKind::UnresolvedVariable),
            4
        );
        let ok = ":root { --a: var(--b); --b: var(--c); --c: #123456; --text-normal: var(--a); }";
        assert!(analyze_appearance_css(ok).light.text_normal.is_some());
    }

    #[test]
    fn expansion_bomb_is_bounded() {
        let mut css = String::from(":root {");
        css.push_str("--v0: #fff;");
        for index in 1..12 {
            css.push_str(&format!(
                "--v{index}: var(--v{p}) var(--v{p}) var(--v{p}) var(--v{p});",
                p = index - 1
            ));
        }
        css.push_str("--text-normal: var(--v11); }");
        let analysis = analyze_appearance_css(&css);
        assert_eq!(analysis.light.text_normal, None);
        assert_eq!(
            analysis.report.count(UnsupportedKind::UnresolvedVariable),
            2
        );
    }

    #[test]
    fn huge_input_is_truncated_on_char_boundary() {
        let mut css = String::from(":root { --text-normal: #fff; }\n");
        while css.len() < MAX_CSS_BYTES + 10 {
            css.push_str("/* \u{1F600}\u{1F600}\u{1F600} */ ");
        }
        // A multibyte character straddles the cap.
        let analysis = analyze_appearance_css(&css);
        assert!(analysis.is_truncated());
        assert!(matches!(
            analysis.truncations[0],
            AppearanceTruncation::InputBytes { kept, .. } if kept <= MAX_CSS_BYTES
        ));
        assert_eq!(
            analysis.light.text_normal,
            Some(Rgba::new(255, 255, 255, 255))
        );
    }

    #[test]
    fn truncation_inside_multibyte_char() {
        let mut css = "a".repeat(MAX_CSS_BYTES - 1);
        css.push('\u{1F600}');
        css.push_str("tail");
        let analysis = analyze_appearance_css(&css);
        assert!(matches!(
            analysis.truncations[0],
            AppearanceTruncation::InputBytes { kept, .. } if kept == MAX_CSS_BYTES - 1
        ));
    }

    #[test]
    fn rule_limit_is_reported() {
        let css = "a{}".repeat(MAX_RULES + 50);
        let analysis = analyze_appearance_css(&css);
        assert!(
            analysis
                .truncations
                .contains(&AppearanceTruncation::RuleLimit)
        );
        assert!(analysis.report.entries.len() <= MAX_REPORT_ENTRIES);
        assert!(analysis.report.omitted > 0);
    }

    #[test]
    fn declaration_limit_is_reported() {
        let mut css = String::from(":root{");
        for index in 0..(MAX_DECLARATIONS + 10) {
            css.push_str(&format!("--v{index}:1;"));
        }
        css.push('}');
        let analysis = analyze_appearance_css(&css);
        assert!(
            analysis
                .truncations
                .contains(&AppearanceTruncation::DeclarationLimit)
        );
    }

    #[test]
    fn media_nesting_is_bounded() {
        let mut css = String::new();
        for _ in 0..10 {
            css.push_str("@media (prefers-color-scheme: dark) {");
        }
        css.push_str(":root { --text-normal: #fff; }");
        for _ in 0..10 {
            css.push('}');
        }
        let analysis = analyze_appearance_css(&css);
        assert!(
            analysis
                .truncations
                .contains(&AppearanceTruncation::NestingDepth)
        );
        let shallow = "@media (prefers-color-scheme: dark) { @media screen and (prefers-color-scheme: dark) { :root { --text-normal: #fff; } } }";
        let analysis = analyze_appearance_css(shallow);
        assert_eq!(
            analysis.dark.text_normal,
            Some(Rgba::new(255, 255, 255, 255))
        );
        assert_eq!(analysis.light.text_normal, None);
    }

    #[test]
    fn malformed_css_never_panics() {
        let samples = [
            "",
            "{",
            "}",
            "}}}}",
            ":root {",
            ":root { --a: ",
            ":root { --a: var(",
            ":root { --text-normal: var(--a, var(--b, var(",
            "@media",
            "@media (prefers-color-scheme: dark",
            "@",
            "/* unterminated",
            ":root { --a: \"unterminated }",
            "a { b { c { d } } }",
            ":root { --text-normal: rgb(",
            ":root { --text-normal: hsl(1,2,3,4,5); }",
            ":root { : ; ;; --: x; -- : y }",
            "\u{FEFF}:root{--text-normal:#fff}\u{0}",
            "\\",
            "a\\",
            ":root { --text-normal: \u{1F600}\u{1F600}; }",
        ];
        for sample in samples {
            let analysis = analyze_appearance_css(sample);
            let _ = parse_style_settings(sample);
            assert!(analysis.report.entries.len() <= MAX_REPORT_ENTRIES);
        }
        let analysis = analyze_appearance_css("\u{FEFF}:root{--text-normal:#fff}");
        assert_eq!(
            analysis.light.text_normal,
            Some(Rgba::new(255, 255, 255, 255))
        );
    }

    #[test]
    fn nested_rules_and_declarations_are_reported() {
        let css = ":root { color: red; .inner { --x: 1 } --text-normal: #fff; broken }";
        let analysis = analyze_appearance_css(css);
        assert_eq!(
            analysis.light.text_normal,
            Some(Rgba::new(255, 255, 255, 255))
        );
        assert_eq!(analysis.report.count(UnsupportedKind::NestedRule), 1);
        assert_eq!(analysis.report.count(UnsupportedKind::Declaration), 1);
        assert_eq!(analysis.report.count(UnsupportedKind::MalformedSyntax), 1);
    }

    #[test]
    fn unparseable_token_values_are_reported() {
        let css = ":root { --text-normal: calc(1 + 2); --radius-m: 5%; --text-muted: color-mix(in srgb, red, blue); }";
        let analysis = analyze_appearance_css(css);
        assert_eq!(analysis.light.text_normal, None);
        assert_eq!(analysis.report.count(UnsupportedKind::UnparseableValue), 6);
    }

    #[test]
    fn color_parsing() {
        assert_eq!(parse_css_color("#fff"), Some(Rgba::new(255, 255, 255, 255)));
        assert_eq!(parse_css_color("#F008"), Some(Rgba::new(255, 0, 0, 136)));
        assert_eq!(
            parse_css_color("#11223344"),
            Some(Rgba::new(0x11, 0x22, 0x33, 0x44))
        );
        assert_eq!(
            parse_css_color("rgb(10, 20, 30)"),
            Some(Rgba::new(10, 20, 30, 255))
        );
        assert_eq!(
            parse_css_color("rgb(10 20 30 / 50%)"),
            Some(Rgba::new(10, 20, 30, 128))
        );
        assert_eq!(
            parse_css_color("rgba(100%, 0%, 0%, .5)"),
            Some(Rgba::new(255, 0, 0, 128))
        );
        assert_eq!(
            parse_css_color("hsl(0, 100%, 50%)"),
            Some(Rgba::new(255, 0, 0, 255))
        );
        assert_eq!(
            parse_css_color("hsl(120deg 100% 50%)"),
            Some(Rgba::new(0, 255, 0, 255))
        );
        assert_eq!(
            parse_css_color("HSLA(240, 100%, 50%, 1)"),
            Some(Rgba::new(0, 0, 255, 255))
        );
        assert_eq!(
            parse_css_color("hsl(0, 0%, 100%)"),
            Some(Rgba::new(255, 255, 255, 255))
        );
        assert_eq!(parse_css_color("Transparent"), Some(Rgba::new(0, 0, 0, 0)));
        assert_eq!(parse_css_color("rebeccapurple"), None);
        assert_eq!(parse_css_color("#12"), None);
        assert_eq!(parse_css_color("#ggg"), None);
        assert_eq!(parse_css_color("#\u{e9}\u{e9}\u{e9}"), None);
        assert_eq!(parse_css_color("rgb(nan, 0, 0)"), None);
        assert_eq!(parse_css_color("rgb(1, 2)"), None);
        assert_eq!(parse_css_color("rgb(var(--x), 0, 0)"), None);
        assert_eq!(parse_css_color(""), None);
    }

    #[test]
    fn length_parsing() {
        assert_eq!(parse_css_length_px("16px"), Some(16.0));
        assert_eq!(parse_css_length_px("1.5rem"), Some(24.0));
        assert_eq!(parse_css_length_px("0"), Some(0.0));
        assert_eq!(parse_css_length_px("12pt"), Some(16.0));
        assert_eq!(parse_css_length_px("-1px"), None);
        assert_eq!(parse_css_length_px("inf px"), None);
        assert_eq!(parse_css_length_px("1e9px"), None);
        assert_eq!(parse_css_length_px("calc(1px)"), None);
        assert_eq!(parse_css_length_px("10"), None);
    }

    #[test]
    fn selector_classification() {
        assert_eq!(classify_selector("body"), Some((MODE_ANY, 1)));
        assert_eq!(classify_selector(":root"), Some((MODE_ANY, 100)));
        assert_eq!(classify_selector("body.theme-dark"), Some((MODE_DARK, 101)));
        assert_eq!(
            classify_selector(".theme-dark:root"),
            Some((MODE_DARK, 200))
        );
        assert_eq!(classify_selector(".theme-lighter"), None);
        assert_eq!(classify_selector("body .theme-dark"), None);
        assert_eq!(classify_selector("bodyx"), None);
        assert_eq!(classify_selector(".theme-light.theme-dark"), Some((0, 200)));
        assert_eq!(classify_selector(""), None);
    }

    #[test]
    fn style_settings_blocks() {
        let parsed = parse_style_settings(MINIMAL_STRUCTURE);
        assert_eq!(parsed.blocks.len(), 1, "issues: {:?}", parsed.issues);
        let block = &parsed.blocks[0];
        assert_eq!(block.id, "minimal-style");
        assert_eq!(block.name, "Minimal");
        assert_eq!(block.settings.len(), 2);
        assert_eq!(
            block.settings[0].kind,
            StyleSettingKind::Heading { level: 1 }
        );
        assert_eq!(block.settings[1].kind, StyleSettingKind::ClassToggle);
        assert_eq!(block.settings[1].default, StyleSettingDefault::Bool(false));
    }

    #[test]
    fn style_settings_variable_types() {
        let css = r#"/* @settings

name: Demo
id: demo
settings:
    -
        id: size
        title: Size
        type: variable-number
        default: 16
        min: 8
        max: 32
        step: 2
        format: px
    -
        id: accent
        title: Accent
        type: variable-color
        format: hex
        default: '#ff0000'
    -
        id: label
        title: Label
        type: variable-text
        default: '"hi"'
    -
        id: layout
        title: Layout
        type: variable-select
        default: wide
        options:
            - wide
            -
                label: Narrow
                value: narrow
    -
        id: odd
        type: info-text
    -
        title: no id
        type: class-toggle
    -
        id: notype
*/"#;
        let parsed = parse_style_settings(css);
        assert_eq!(parsed.blocks.len(), 1, "issues: {:?}", parsed.issues);
        let settings = &parsed.blocks[0].settings;
        assert_eq!(settings.len(), 5, "issues: {:?}", parsed.issues);
        assert_eq!(settings[0].kind, StyleSettingKind::VariableNumber);
        assert_eq!(settings[0].default, StyleSettingDefault::Number(16.0));
        assert_eq!(settings[0].min, Some(8.0));
        assert_eq!(settings[0].max, Some(32.0));
        assert_eq!(settings[0].step, Some(2.0));
        assert_eq!(settings[0].format.as_deref(), Some("px"));
        assert_eq!(settings[1].kind, StyleSettingKind::VariableColor);
        assert_eq!(
            settings[1].default,
            StyleSettingDefault::Text("#ff0000".into())
        );
        assert_eq!(settings[2].kind, StyleSettingKind::VariableText);
        assert_eq!(settings[3].kind, StyleSettingKind::VariableSelect);
        assert_eq!(settings[3].options.len(), 2);
        assert_eq!(settings[3].options[1].label, "Narrow");
        assert_eq!(settings[3].options[1].value, "narrow");
        assert_eq!(
            settings[4].kind,
            StyleSettingKind::Unsupported("info-text".into())
        );
        assert!(
            parsed
                .issues
                .iter()
                .any(|issue| issue.contains("without an id"))
        );
        assert!(
            parsed
                .issues
                .iter()
                .any(|issue| issue.contains("without a type"))
        );
    }

    #[test]
    fn style_settings_ignores_other_comments_and_bombs() {
        let parsed = parse_style_settings("/* hello */ a { } /* @settings\n*/");
        assert!(parsed.blocks.is_empty());
        assert_eq!(parsed.issues.len(), 1);

        let mut css = String::new();
        for _ in 0..(MAX_SETTINGS_BLOCKS + 5) {
            css.push_str("/* @settings\nname: A\nid: a\n*/\n");
        }
        let parsed = parse_style_settings(&css);
        assert_eq!(parsed.blocks.len(), MAX_SETTINGS_BLOCKS);
        assert!(!parsed.issues.is_empty());

        let big = format!(
            "/* @settings\n{}*/",
            "x: y\n".repeat(MAX_SETTINGS_YAML_BYTES)
        );
        let parsed = parse_style_settings(&big);
        assert!(parsed.blocks.is_empty());
    }
}
