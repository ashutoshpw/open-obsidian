//! Read-only parsing and evaluation for version 1 Bases definitions.
//!
//! The supported projection is deliberately bounded. The original JSON or
//! YAML tree and source bytes remain attached to the document, so unknown
//! definitions survive and callers can return the original source unchanged.

use crate::yaml::{self, YamlMappingEntry, YamlValue};
use serde_json::{Map, Number, Value};
use std::collections::BTreeMap;
use std::fmt;

/// JSON-compatible value used by note properties and evaluated formula results.
pub type BaseValue = Value;

/// One note row supplied to the read-only Bases evaluator.
#[derive(Clone, Debug, PartialEq)]
pub struct BaseRow {
    pub path: String,
    pub properties: Map<String, Value>,
}

/// Supported Bases view kinds.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BaseViewType {
    Table,
    List,
    Cards,
}

/// Source representation retained for unknown fields and source fidelity.
#[derive(Clone, Debug, PartialEq)]
pub enum BaseRawValue {
    Json(Value),
    NativeYaml(YamlValue),
}

/// Filter operators in the supported version 1 subset.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BaseComparisonOperator {
    Equals,
    NotEquals,
    Contains,
    GreaterThan,
    GreaterThanOrEqual,
    LessThan,
    LessThanOrEqual,
}

/// A bounded filter expression.
#[derive(Clone, Debug, PartialEq)]
pub enum BaseFilter {
    All(Vec<BaseFilter>),
    Any(Vec<BaseFilter>),
    Not(Box<BaseFilter>),
    Comparison {
        field: String,
        operator: BaseComparisonOperator,
        value: Value,
    },
}

/// One field ordering rule.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BaseSort {
    pub field: String,
    pub descending: bool,
}

/// A parsed view and its unmodified source definition.
#[derive(Clone, Debug, PartialEq)]
pub struct BaseView {
    pub view_type: BaseViewType,
    pub name: Option<String>,
    pub filter: Option<BaseFilter>,
    pub sort: Vec<BaseSort>,
    pub group_by: Option<String>,
    pub limit: Option<usize>,
    pub formulas: BTreeMap<String, String>,
    raw: BaseRawValue,
}

impl BaseView {
    /// Returns the complete original view definition, including unknown fields.
    pub fn raw_definition(&self) -> &BaseRawValue {
        &self.raw
    }
}

/// Issue kinds kept explicit for callers that need to display compatibility gaps.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BaseIssueKind {
    UnsupportedFormula,
    InvalidFilter,
    InvalidSource,
}

/// A non-fatal issue found while parsing or evaluating a Bases definition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BaseIssue {
    pub kind: BaseIssueKind,
    pub message: String,
    pub expression: Option<String>,
}

impl BaseIssue {
    fn new(kind: BaseIssueKind, message: impl Into<String>, expression: Option<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            expression,
        }
    }
}

/// Source syntax detected for the definition.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BaseSourceFormat {
    Json,
    NativeYaml,
}

/// Parsed Bases document retaining its raw definition and exact source bytes.
#[derive(Clone, Debug, PartialEq)]
pub struct BaseDocument {
    source_format: BaseSourceFormat,
    source_bytes: Vec<u8>,
    raw_root: BaseRawValue,
    views: Vec<BaseView>,
    issues: Vec<BaseIssue>,
}

impl BaseDocument {
    pub fn source_format(&self) -> BaseSourceFormat {
        self.source_format
    }

    pub fn views(&self) -> &[BaseView] {
        &self.views
    }

    pub fn issues(&self) -> &[BaseIssue] {
        &self.issues
    }

    /// Returns the full original root definition, including fields unknown here.
    pub fn raw_definition(&self) -> &BaseRawValue {
        &self.raw_root
    }

    /// Returns the exact bytes supplied to parse_base.
    pub fn source_bytes(&self) -> &[u8] {
        &self.source_bytes
    }
}

/// A formula result row. An unsupported formula has no entry in values.
#[derive(Clone, Debug, PartialEq)]
pub struct EvaluatedBaseRow {
    pub path: String,
    pub properties: Map<String, Value>,
    pub values: Map<String, Value>,
}

/// Evaluation output for one selected view.
#[derive(Clone, Debug, PartialEq)]
pub struct BaseEvaluation {
    pub view: BaseView,
    pub rows: Vec<EvaluatedBaseRow>,
    pub groups: BTreeMap<String, Vec<EvaluatedBaseRow>>,
    pub issues: Vec<BaseIssue>,
}

/// Why a definition could not be parsed safely.
#[derive(Debug)]
pub enum BaseParseError {
    InvalidUtf8,
    MalformedJson(serde_json::Error),
    InvalidDocument(String),
    InvalidView { index: usize, reason: String },
}

impl fmt::Display for BaseParseError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUtf8 => formatter.write_str("Bases source is not valid UTF-8"),
            Self::MalformedJson(error) => write!(formatter, "invalid Bases JSON: {error}"),
            Self::InvalidDocument(message) => formatter.write_str(message),
            Self::InvalidView { index, reason } => {
                write!(formatter, "Bases view {index} is invalid: {reason}")
            }
        }
    }
}

impl std::error::Error for BaseParseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::MalformedJson(error) => Some(error),
            Self::InvalidUtf8 | Self::InvalidDocument(_) | Self::InvalidView { .. } => None,
        }
    }
}

/// Parse a version 1 JSON Bases document or a native YAML Bases definition.
///
/// JSON syntax failures use the legacy native-YAML fallback. Valid JSON with an
/// invalid Bases shape is rejected rather than reinterpreted as YAML.
pub fn parse_base(bytes: &[u8]) -> Result<BaseDocument, BaseParseError> {
    let source = std::str::from_utf8(bytes).map_err(|_| BaseParseError::InvalidUtf8)?;
    match serde_json::from_str::<Value>(source) {
        Ok(value) => parse_json_base(value, bytes.to_vec()),
        Err(error) if error.is_syntax() || error.is_eof() => {
            parse_native_base(source, bytes.to_vec())
        }
        Err(error) => Err(BaseParseError::MalformedJson(error)),
    }
}

/// Return the exact original source bytes retained by parse_base.
pub fn encode_base(document: &BaseDocument) -> Vec<u8> {
    document.source_bytes.clone()
}

fn parse_json_base(value: Value, source_bytes: Vec<u8>) -> Result<BaseDocument, BaseParseError> {
    let Some(root) = value.as_object() else {
        return Err(BaseParseError::InvalidDocument(
            "Bases document must declare version 1 and views".to_owned(),
        ));
    };
    let version_one = root.get("version").and_then(Value::as_f64) == Some(1.0)
        || root.get("schema_version").and_then(Value::as_f64) == Some(1.0);
    let Some(raw_views) = root.get("views").and_then(Value::as_array) else {
        return Err(BaseParseError::InvalidDocument(
            "Bases document must declare version 1 and views".to_owned(),
        ));
    };
    if !version_one {
        return Err(BaseParseError::InvalidDocument(
            "Bases document must declare version 1 and views".to_owned(),
        ));
    }

    let views = raw_views
        .iter()
        .enumerate()
        .map(|(index, raw)| parse_json_view(raw, index))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(BaseDocument {
        source_format: BaseSourceFormat::Json,
        source_bytes,
        raw_root: BaseRawValue::Json(value),
        views,
        issues: Vec::new(),
    })
}

fn parse_json_view(value: &Value, index: usize) -> Result<BaseView, BaseParseError> {
    let Some(raw) = value.as_object() else {
        return Err(invalid_view(index, "view must be an object"));
    };
    let view_type = match raw.get("type").and_then(Value::as_str) {
        Some("table") => BaseViewType::Table,
        Some("list") => BaseViewType::List,
        Some("cards") => BaseViewType::Cards,
        _ => return Err(invalid_view(index, "view must declare a supported type")),
    };

    let filter = match raw.get("filter") {
        None => None,
        Some(value) => Some(
            parse_json_filter(value)
                .ok_or_else(|| invalid_view(index, "filter is outside the version 1 grammar"))?,
        ),
    };
    let mut sort = Vec::new();
    if let Some(entries) = raw.get("sort").and_then(Value::as_array) {
        for entry in entries {
            let Some(entry) = entry.as_object() else {
                return Err(invalid_view(index, "sort entries must declare a field"));
            };
            let Some(field) = entry.get("field").and_then(Value::as_str) else {
                return Err(invalid_view(index, "sort entries must declare a field"));
            };
            sort.push(BaseSort {
                field: field.to_owned(),
                descending: entry.get("direction").and_then(Value::as_str) == Some("desc"),
            });
        }
    }
    let formulas = raw
        .get("formulas")
        .and_then(Value::as_object)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|(name, expression)| {
                    expression
                        .as_str()
                        .map(|expression| (name.clone(), expression.to_owned()))
                })
                .collect()
        })
        .unwrap_or_default();
    let limit = raw
        .get("limit")
        .and_then(Value::as_u64)
        .and_then(|limit| usize::try_from(limit).ok());

    Ok(BaseView {
        view_type,
        name: raw.get("name").and_then(Value::as_str).map(str::to_owned),
        filter,
        sort,
        group_by: raw.get("groupBy").and_then(Value::as_str).map(str::to_owned),
        limit,
        formulas,
        raw: BaseRawValue::Json(value.clone()),
    })
}

fn invalid_view(index: usize, reason: &str) -> BaseParseError {
    BaseParseError::InvalidView {
        index,
        reason: reason.to_owned(),
    }
}

fn parse_json_filter(value: &Value) -> Option<BaseFilter> {
    let object = value.as_object()?;
    match object.get("kind")?.as_str()? {
        "all" | "any" => {
            let filters = object.get("filters")?.as_array()?;
            let filters = filters
                .iter()
                .map(parse_json_filter)
                .collect::<Option<Vec<_>>>()?;
            if object.get("kind")?.as_str()? == "all" {
                Some(BaseFilter::All(filters))
            } else {
                Some(BaseFilter::Any(filters))
            }
        }
        "not" => Some(BaseFilter::Not(Box::new(parse_json_filter(
            object.get("filter")?,
        )?))),
        "comparison" => {
            let field = object.get("field")?.as_str()?.to_owned();
            let operator = match object.get("operator")?.as_str()? {
                "equals" => BaseComparisonOperator::Equals,
                "not-equals" => BaseComparisonOperator::NotEquals,
                "contains" => BaseComparisonOperator::Contains,
                "gt" => BaseComparisonOperator::GreaterThan,
                "gte" => BaseComparisonOperator::GreaterThanOrEqual,
                "lt" => BaseComparisonOperator::LessThan,
                "lte" => BaseComparisonOperator::LessThanOrEqual,
                _ => return None,
            };
            Some(BaseFilter::Comparison {
                field,
                operator,
                value: object.get("value")?.clone(),
            })
        }
        _ => None,
    }
}

fn parse_native_base(source: &str, source_bytes: Vec<u8>) -> Result<BaseDocument, BaseParseError> {
    let parsed = yaml::parse_mapping(source);
    let raw_root = YamlValue::Mapping(parsed.entries);
    let entries = mapping_entries(&raw_root).expect("native Bases root is a mapping");
    let mut issues = parsed
        .issues
        .into_iter()
        .map(|message| BaseIssue::new(BaseIssueKind::InvalidSource, message, None))
        .collect::<Vec<_>>();
    let Some(raw_views) = mapping_get(entries, "views").and_then(YamlValue::as_sequence) else {
        return Err(BaseParseError::InvalidDocument(
            "Bases document must declare version 1 and views".to_owned(),
        ));
    };

    let global_filter = native_filter(mapping_get(entries, "filters"), &mut issues);
    let base_formulas = native_formulas(mapping_get(entries, "formulas"));
    let views = raw_views
        .iter()
        .enumerate()
        .map(|(index, raw)| {
            parse_native_view(raw, index, &global_filter, &base_formulas, &mut issues)
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(BaseDocument {
        source_format: BaseSourceFormat::NativeYaml,
        source_bytes,
        raw_root: BaseRawValue::NativeYaml(raw_root),
        views,
        issues,
    })
}

fn parse_native_view(
    value: &YamlValue,
    index: usize,
    global_filter: &NativeFilterResult,
    base_formulas: &BTreeMap<String, String>,
    issues: &mut Vec<BaseIssue>,
) -> Result<BaseView, BaseParseError> {
    let Some(entries) = mapping_entries(value) else {
        return Err(invalid_view(index, "native view must be a mapping"));
    };
    let view_type = match mapping_get(entries, "type").and_then(YamlValue::as_string) {
        Some("table") => BaseViewType::Table,
        Some("list") => BaseViewType::List,
        Some("cards") => BaseViewType::Cards,
        _ => return Err(invalid_view(index, "view must declare a supported type")),
    };

    if let Some(expression) = mapping_get(entries, "formula").and_then(YamlValue::as_string) {
        issues.push(BaseIssue::new(
            BaseIssueKind::InvalidSource,
            "Native Bases formulas must be declared in a formulas map",
            Some(expression.to_owned()),
        ));
    }
    let local_filter = native_filter(mapping_get(entries, "filters"), issues);
    let filter = if global_filter.supported && local_filter.supported {
        combine_filters([global_filter.filter.clone(), local_filter.filter])
    } else {
        None
    };
    let mut formulas = base_formulas.clone();
    formulas.extend(native_formulas(mapping_get(entries, "formulas")));
    let sort = native_order(mapping_get(entries, "order"))
        .or_else(|| native_order(mapping_get(entries, "sort")))
        .unwrap_or_default();
    let group_by = mapping_get(entries, "groupBy").and_then(|value| match value {
        YamlValue::String(value) => Some(value.clone()),
        YamlValue::Mapping(entries) => mapping_get(entries, "property")
            .and_then(YamlValue::as_string)
            .map(str::to_owned),
        _ => None,
    });

    Ok(BaseView {
        view_type,
        name: mapping_get(entries, "name")
            .and_then(YamlValue::as_string)
            .map(str::to_owned),
        filter,
        sort,
        group_by,
        limit: mapping_get(entries, "limit").and_then(yaml_nonnegative_usize),
        formulas,
        raw: BaseRawValue::NativeYaml(value.clone()),
    })
}

fn combine_filters(filters: [Option<BaseFilter>; 2]) -> Option<BaseFilter> {
    let mut present = filters.into_iter().flatten().collect::<Vec<_>>();
    match present.len() {
        0 => None,
        1 => present.pop(),
        _ => Some(BaseFilter::All(present)),
    }
}

#[derive(Clone)]
struct NativeFilterResult {
    filter: Option<BaseFilter>,
    supported: bool,
}

fn native_filter(value: Option<&YamlValue>, issues: &mut Vec<BaseIssue>) -> NativeFilterResult {
    let Some(value) = value else {
        return NativeFilterResult {
            filter: None,
            supported: true,
        };
    };
    match value {
        YamlValue::String(expression) => native_comparison(expression, issues),
        YamlValue::Mapping(entries) => native_filter_mapping(entries, issues),
        _ => invalid_native_filter("Native Bases filters must be strings or and/or/not maps", issues),
    }
}

fn native_filter_mapping(
    entries: &[YamlMappingEntry],
    issues: &mut Vec<BaseIssue>,
) -> NativeFilterResult {
    if entries.len() != 1 {
        return invalid_native_filter(
            "Native Bases filter maps must contain one of and, or or not",
            issues,
        );
    }
    let entry = &entries[0];
    let kind = match entry.key.as_str() {
        "and" => "and",
        "or" => "or",
        "not" => "not",
        _ => {
            return invalid_native_filter(
                "Native Bases filter maps must contain one of and, or or not",
                issues,
            );
        }
    };
    let children = match &entry.value {
        YamlValue::Sequence(children) => children.iter().collect::<Vec<_>>(),
        child => vec![child],
    };
    let parsed = children
        .into_iter()
        .map(|child| native_filter(Some(child), issues))
        .collect::<Vec<_>>();
    if parsed.iter().any(|result| !result.supported) {
        return NativeFilterResult {
            filter: None,
            supported: false,
        };
    }
    let filters = parsed
        .into_iter()
        .filter_map(|result| result.filter)
        .collect::<Vec<_>>();
    if filters.is_empty() {
        return invalid_native_filter(
            &format!("Native Bases {kind} filters must contain at least one filter"),
            issues,
        );
    }
    let filter = match kind {
        "and" => BaseFilter::All(filters),
        "or" => BaseFilter::Any(filters),
        _ => BaseFilter::Not(Box::new(BaseFilter::Any(filters))),
    };
    NativeFilterResult {
        filter: Some(filter),
        supported: true,
    }
}

fn invalid_native_filter(message: &str, issues: &mut Vec<BaseIssue>) -> NativeFilterResult {
    issues.push(BaseIssue::new(
        BaseIssueKind::InvalidFilter,
        message,
        None,
    ));
    NativeFilterResult {
        filter: None,
        supported: false,
    }
}

fn native_comparison(expression: &str, issues: &mut Vec<BaseIssue>) -> NativeFilterResult {
    let Some((field, operator, operand)) = split_native_comparison(expression) else {
        return invalid_native_filter(
            &format!(
                "Native Bases filter is outside the supported comparison subset: {expression}"
            ),
            issues,
        );
    };
    let operator = match operator.to_ascii_lowercase().as_str() {
        "=" | "==" => BaseComparisonOperator::Equals,
        "!=" => BaseComparisonOperator::NotEquals,
        "contains" => BaseComparisonOperator::Contains,
        ">" => BaseComparisonOperator::GreaterThan,
        ">=" => BaseComparisonOperator::GreaterThanOrEqual,
        "<" => BaseComparisonOperator::LessThan,
        "<=" => BaseComparisonOperator::LessThanOrEqual,
        _ => {
            return invalid_native_filter(
                &format!("Native Bases filter operator is not supported: {operator}"),
                issues,
            );
        }
    };
    let value = native_expression_value(operand);
    NativeFilterResult {
        filter: Some(BaseFilter::Comparison {
            field: field.to_owned(),
            operator,
            value,
        }),
        supported: true,
    }
}

fn split_native_comparison(expression: &str) -> Option<(&str, &str, &str)> {
    let expression = expression.trim();
    let field_end = expression
        .char_indices()
        .take_while(|(_, character)| {
            character.is_ascii_alphanumeric() || matches!(*character, '_' | '.' | '-')
        })
        .map(|(index, character)| index + character.len_utf8())
        .last()?;
    let field = &expression[..field_end];
    let rest = expression[field_end..].trim_start();
    for operator in ["==", "!=", ">=", "<=", ">", "<", "=", "contains"] {
        if rest
            .get(..operator.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(operator))
        {
            let operand = rest[operator.len()..].trim();
            if !operand.is_empty() {
                return Some((field, operator, operand));
            }
        }
    }
    None
}

fn native_expression_value(token: &str) -> Value {
    let trimmed = token.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        return serde_json::from_str::<String>(trimmed)
            .map(Value::String)
            .unwrap_or_else(|_| Value::String(trimmed[1..trimmed.len() - 1].to_owned()));
    }
    if trimmed.len() >= 2 && trimmed.starts_with('\'') && trimmed.ends_with('\'') {
        return Value::String(trimmed[1..trimmed.len() - 1].replace("''", "'"));
    }
    if trimmed == "null" || trimmed == "~" {
        return Value::Null;
    }
    if trimmed.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if trimmed.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if is_native_number(trimmed) {
        if let Ok(number) = trimmed.parse::<f64>()
            && let Some(number) = Number::from_f64(number)
        {
            return Value::Number(number);
        }
    }
    Value::String(trimmed.to_owned())
}

fn is_native_number(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = usize::from(matches!(bytes.first(), Some(&b'+') | Some(&b'-')));
    let mut digits = 0usize;
    while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
        index += 1;
        digits += 1;
    }
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
            index += 1;
            digits += 1;
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

fn native_formulas(value: Option<&YamlValue>) -> BTreeMap<String, String> {
    let Some(YamlValue::Mapping(entries)) = value else {
        return BTreeMap::new();
    };
    entries
        .iter()
        .filter_map(|entry| match &entry.value {
            YamlValue::String(expression) => Some((entry.key.clone(), expression.clone())),
            _ => None,
        })
        .collect()
}

fn native_order(value: Option<&YamlValue>) -> Option<Vec<BaseSort>> {
    let Some(YamlValue::Sequence(entries)) = value else {
        return None;
    };
    Some(
        entries
            .iter()
            .filter_map(|entry| match entry {
                YamlValue::String(field) => Some(BaseSort {
                    field: field.clone(),
                    descending: false,
                }),
                _ => None,
            })
            .collect(),
    )
}

fn yaml_nonnegative_usize(value: &YamlValue) -> Option<usize> {
    match value {
        YamlValue::Number(value) => {
            if let Ok(integer) = value.parse::<usize>() {
                return Some(integer);
            }
            let number = value.parse::<f64>().ok()?;
            (number.is_finite()
                && number >= 0.0
                && number.fract() == 0.0
                && number <= usize::MAX as f64)
                .then_some(number as usize)
        }
        _ => None,
    }
}

fn mapping_entries(value: &YamlValue) -> Option<&[YamlMappingEntry]> {
    match value {
        YamlValue::Mapping(entries) => Some(entries),
        _ => None,
    }
}

fn mapping_get<'a>(entries: &'a [YamlMappingEntry], key: &str) -> Option<&'a YamlValue> {
    entries
        .iter()
        .find(|entry| entry.key == key)
        .map(|entry| &entry.value)
}

/// Evaluate one view over caller-supplied note rows.
pub fn evaluate_base(
    document: &BaseDocument,
    view_name: &str,
    source_rows: &[BaseRow],
) -> Result<BaseEvaluation, BaseParseError> {
    let view = document
        .views
        .iter()
        .find(|view| view.name.as_deref() == Some(view_name))
        .or_else(|| document.views.first())
        .ok_or_else(|| {
            BaseParseError::InvalidDocument("Bases document has no views".to_owned())
        })?
        .clone();
    let mut issues = document.issues.clone();
    let filtered = source_rows
        .iter()
        .filter(|row| {
            view.filter
                .as_ref()
                .is_none_or(|filter| matches_filter(filter, row))
        })
        .map(|row| evaluate_row(row, &view, &mut issues))
        .collect::<Vec<_>>();
    if filtered.is_empty() {
        for expression in view.formulas.values() {
            let trimmed_expression = expression.trim();
            if !is_obviously_unsupported_formula(trimmed_expression)
                || source_rows
                    .iter()
                    .any(|row| field_value(row, trimmed_expression).is_some())
            {
                continue;
            }
            let issue = BaseIssue::new(
                BaseIssueKind::UnsupportedFormula,
                format!("Unsupported Bases formula: {expression}"),
                Some(expression.clone()),
            );
            if !issues.contains(&issue) {
                issues.push(issue);
            }
        }
    }
    let mut rows = filtered;
    if !view.sort.is_empty() {
        rows.sort_by(|left, right| compare_rows(left, right, &view.sort));
    }
    if let Some(limit) = view.limit {
        rows.truncate(limit);
    }

    let mut groups: BTreeMap<String, Vec<EvaluatedBaseRow>> = BTreeMap::new();
    if let Some(field) = &view.group_by {
        let field = normalize_field(field);
        for row in &rows {
            let value = row
                .values
                .get(field)
                .filter(|value| !value.is_null())
                .or_else(|| row.properties.get(field).filter(|value| !value.is_null()));
            groups
                .entry(value.map_or_else(String::new, js_string))
                .or_default()
                .push(row.clone());
        }
    }
    Ok(BaseEvaluation {
        view,
        rows,
        groups,
        issues,
    })
}

fn normalize_field(field: &str) -> &str {
    field.strip_prefix("note.").unwrap_or(field)
}

fn field_value<'a>(row: &'a BaseRow, field: &str) -> Option<Value> {
    let field = normalize_field(field);
    match field {
        "file.path" => Some(Value::String(row.path.clone())),
        "file.name" => Some(Value::String(
            row.path.rsplit('/').next().unwrap_or(&row.path).to_owned(),
        )),
        "file.ext" => Some(Value::String(file_extension(&row.path))),
        _ => row.properties.get(field).cloned(),
    }
}

fn file_extension(path: &str) -> String {
    let file_name = path.rsplit('/').next().unwrap_or(path);
    file_name
        .rfind('.')
        .map_or("", |index| &file_name[index + 1..])
        .to_owned()
}

fn matches_filter(filter: &BaseFilter, row: &BaseRow) -> bool {
    match filter {
        BaseFilter::All(filters) => filters.iter().all(|filter| matches_filter(filter, row)),
        BaseFilter::Any(filters) => filters.iter().any(|filter| matches_filter(filter, row)),
        BaseFilter::Not(filter) => !matches_filter(filter, row),
        BaseFilter::Comparison {
            field,
            operator,
            value,
        } => {
            let actual = field_value(row, field);
            match operator {
                BaseComparisonOperator::Contains => match actual.as_ref() {
                    Some(Value::Array(values)) => array_includes(values, value),
                    _ => actual
                        .as_ref()
                        .filter(|actual| !actual.is_null())
                        .map_or_else(String::new, js_string)
                        .to_lowercase()
                        .contains(&js_string(value).to_lowercase()),
                },
                BaseComparisonOperator::Equals => compare_values(actual.as_ref(), Some(value)).is_eq(),
                BaseComparisonOperator::NotEquals => {
                    !compare_values(actual.as_ref(), Some(value)).is_eq()
                }
                BaseComparisonOperator::GreaterThan => {
                    compare_values(actual.as_ref(), Some(value)).is_gt()
                }
                BaseComparisonOperator::GreaterThanOrEqual => {
                    !compare_values(actual.as_ref(), Some(value)).is_lt()
                }
                BaseComparisonOperator::LessThan => {
                    compare_values(actual.as_ref(), Some(value)).is_lt()
                }
                BaseComparisonOperator::LessThanOrEqual => {
                    !compare_values(actual.as_ref(), Some(value)).is_gt()
                }
            }
        }
    }
}

fn array_includes(values: &[Value], needle: &Value) -> bool {
    match needle {
        Value::Null => values.iter().any(Value::is_null),
        Value::Bool(needle) => values.iter().any(|value| value.as_bool() == Some(*needle)),
        Value::Number(needle) => values
            .iter()
            .filter_map(Value::as_f64)
            .any(|value| Some(value) == needle.as_f64()),
        Value::String(needle) => values.iter().any(|value| value.as_str() == Some(needle)),
        Value::Array(_) | Value::Object(_) => false,
    }
}

fn evaluate_row(row: &BaseRow, view: &BaseView, issues: &mut Vec<BaseIssue>) -> EvaluatedBaseRow {
    let mut values = row.properties.clone();
    values.insert("file.path".to_owned(), Value::String(row.path.clone()));
    values.insert(
        "file.name".to_owned(),
        Value::String(row.path.rsplit('/').next().unwrap_or(&row.path).to_owned()),
    );
    values.insert("file.ext".to_owned(), Value::String(file_extension(&row.path)));
    for (name, expression) in &view.formulas {
        // A formula owns its output name. If it cannot be evaluated, a
        // same-named source property must not masquerade as the formula value.
        values.remove(name);
        match formula_value(expression, row) {
            Some(value) => {
                values.insert(name.clone(), value);
            }
            None => push_issue_once(
                issues,
                BaseIssue::new(
                    BaseIssueKind::UnsupportedFormula,
                    format!("Unsupported Bases formula: {expression}"),
                    Some(expression.clone()),
                ),
            ),
        }
    }
    EvaluatedBaseRow {
        path: row.path.clone(),
        properties: row.properties.clone(),
        values,
    }
}

fn push_issue_once(issues: &mut Vec<BaseIssue>, issue: BaseIssue) {
    if !issues.contains(&issue) {
        issues.push(issue);
    }
}

/// Detect unsupported expression syntax even when there are no rows to evaluate.
fn is_obviously_unsupported_formula(expression: &str) -> bool {
    let quoted_literal = expression.len() >= 2
        && ((expression.starts_with('"') && expression.ends_with('"'))
            || (expression.starts_with('\'') && expression.ends_with('\'')));
    if quoted_literal
        || matches!(expression, "true" | "false")
        || is_legacy_formula_number(expression)
    {
        return false;
    }
    if expression.is_empty() {
        return true;
    }

    expression.chars().any(|character| {
        matches!(
            character,
            '(' | ')' | '+' | '*' | '/' | '%' | '=' | '>' | '<' | '!' | '&' | '|'
        )
    })
}

fn formula_value(expression: &str, row: &BaseRow) -> Option<Value> {
    let trimmed = expression.trim();
    if let Some(value) = field_value(row, trimmed) {
        return Some(value);
    }
    match trimmed {
        "true" => return Some(Value::Bool(true)),
        "false" => return Some(Value::Bool(false)),
        _ => {}
    }
    if is_legacy_formula_number(trimmed)
        && let Ok(number) = trimmed.parse::<f64>()
        && let Some(number) = Number::from_f64(number)
    {
        return Some(Value::Number(number));
    }
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        return Some(Value::String(trimmed[1..trimmed.len() - 1].to_owned()));
    }
    None
}

fn is_legacy_formula_number(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = usize::from(bytes.first() == Some(&b'-'));
    let integer_start = index;
    while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
        index += 1;
    }
    if index == integer_start {
        return false;
    }
    if bytes.get(index) == Some(&b'.') {
        index += 1;
        let decimal_start = index;
        while bytes.get(index).is_some_and(|byte| byte.is_ascii_digit()) {
            index += 1;
        }
        if index == decimal_start {
            return false;
        }
    }
    index == bytes.len()
}

fn compare_rows(
    left: &EvaluatedBaseRow,
    right: &EvaluatedBaseRow,
    sorts: &[BaseSort],
) -> std::cmp::Ordering {
    for sort in sorts {
        let field = normalize_field(&sort.field);
        let left_value = left
            .values
            .get(field)
            .filter(|value| !value.is_null())
            .or_else(|| left.properties.get(field));
        let right_value = right
            .values
            .get(field)
            .filter(|value| !value.is_null())
            .or_else(|| right.properties.get(field));
        let order = compare_values(left_value, right_value);
        if order != std::cmp::Ordering::Equal {
            return if sort.descending { order.reverse() } else { order };
        }
    }
    natural_compare(&left.path, &right.path)
}

fn compare_values(left: Option<&Value>, right: Option<&Value>) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    match (left, right) {
        (None, None) | (Some(Value::Null), Some(Value::Null)) => Ordering::Equal,
        (None, _) | (Some(Value::Null), _) => Ordering::Less,
        (_, None) | (_, Some(Value::Null)) => Ordering::Greater,
        (Some(Value::Number(left)), Some(Value::Number(right))) => {
            compare_numbers(left, right)
        }
        (Some(left), Some(right)) => natural_compare(&js_string(left), &js_string(right)),
    }
}

fn compare_numbers(left: &Number, right: &Number) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    let integer_value = |number: &Number| {
        number
            .as_i64()
            .map(i128::from)
            .or_else(|| number.as_u64().map(i128::from))
    };
    if let (Some(left), Some(right)) = (integer_value(left), integer_value(right)) {
        return left.cmp(&right);
    }

    match (left.as_f64(), right.as_f64()) {
        (Some(left), Some(right)) => left.partial_cmp(&right).unwrap_or(Ordering::Equal),
        _ => natural_compare(&left.to_string(), &right.to_string()),
    }
}

fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(|value| {
                if value.is_null() {
                    String::new()
                } else {
                    js_string(value)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// Deterministic case-insensitive natural comparison for strings and paths.
fn natural_compare(left: &str, right: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let left = left.to_lowercase().chars().collect::<Vec<_>>();
    let right = right.to_lowercase().chars().collect::<Vec<_>>();
    let (mut left_index, mut right_index) = (0usize, 0usize);
    while left_index < left.len() && right_index < right.len() {
        if left[left_index].is_ascii_digit() && right[right_index].is_ascii_digit() {
            let left_end = digit_run_end(&left, left_index);
            let right_end = digit_run_end(&right, right_index);
            let left_digits = &left[left_index..left_end];
            let right_digits = &right[right_index..right_end];
            let left_significant = left_digits
                .iter()
                .position(|character| *character != '0')
                .map_or(&left_digits[left_digits.len()..], |start| &left_digits[start..]);
            let right_significant = right_digits
                .iter()
                .position(|character| *character != '0')
                .map_or(
                    &right_digits[right_digits.len()..],
                    |start| &right_digits[start..],
                );
            let order = left_significant
                .len()
                .cmp(&right_significant.len())
                .then_with(|| left_significant.cmp(right_significant));
            if order != Ordering::Equal {
                return order;
            }
            left_index = left_end;
            right_index = right_end;
        } else {
            let order = left[left_index].cmp(&right[right_index]);
            if order != Ordering::Equal {
                return order;
            }
            left_index += 1;
            right_index += 1;
        }
    }
    left.len()
        .saturating_sub(left_index)
        .cmp(&right.len().saturating_sub(right_index))
}

fn digit_run_end(value: &[char], start: usize) -> usize {
    value[start..]
        .iter()
        .position(|character| !character.is_ascii_digit())
        .map_or(value.len(), |offset| start + offset)
}

/// An extracted embedded definition with byte offsets into its Markdown source.
#[derive(Clone, Debug, PartialEq)]
pub struct EmbeddedBaseDefinition {
    pub source: String,
    pub start: usize,
    pub end: usize,
    pub document: Option<BaseDocument>,
    pub issues: Vec<BaseIssue>,
}

/// Parse embedded fenced Bases definitions without changing the Markdown source.
pub fn parse_embedded_bases(source: &str) -> Vec<EmbeddedBaseDefinition> {
    let lines = source_line_ranges(source);
    let mut definitions = Vec::new();
    let mut open: Option<(u8, usize, usize)> = None;
    for (start, end, full_end) in lines {
        let line = &source[start..end];
        if let Some((marker, length, content_start)) = open {
            if closes_fence(line, marker, length) {
                let content = source[content_start..start].to_owned();
                definitions.push(parse_embedded_definition(content, content_start, start));
                open = None;
            }
        } else if let Some((marker, length)) = opens_fence(line) {
            open = Some((marker, length, full_end));
        }
    }
    if let Some((_, _, content_start)) = open {
        definitions.push(EmbeddedBaseDefinition {
            source: source[content_start..].to_owned(),
            start: content_start,
            end: source.len(),
            document: None,
            issues: vec![BaseIssue::new(
                BaseIssueKind::InvalidSource,
                "Embedded base fence is not closed",
                None,
            )],
        });
    }
    definitions
}

fn source_line_ranges(source: &str) -> Vec<(usize, usize, usize)> {
    let bytes = source.as_bytes();
    let mut lines = Vec::new();
    let mut start = 0usize;
    while start < bytes.len() {
        let mut end = start;
        while end < bytes.len() && !matches!(bytes[end], b'\r' | b'\n') {
            end += 1;
        }
        let full_end = if end == bytes.len() {
            end
        } else if bytes[end] == b'\r' && bytes.get(end + 1) == Some(&b'\n') {
            end + 2
        } else {
            end + 1
        };
        lines.push((start, end, full_end));
        start = full_end;
    }
    lines
}

fn opens_fence(line: &str) -> Option<(u8, usize)> {
    let bytes = line.as_bytes();
    let indent = bytes.iter().take_while(|byte| **byte == b' ').count();
    if indent > 3 {
        return None;
    }
    let marker = *bytes.get(indent)?;
    if !matches!(marker, b'\x60' | b'~') {
        return None;
    }
    let run = bytes[indent..]
        .iter()
        .take_while(|byte| **byte == marker)
        .count();
    if run < 3 {
        return None;
    }
    let mut remainder = &bytes[indent + run..];
    while remainder.first().is_some_and(|byte| byte.is_ascii_whitespace()) {
        remainder = &remainder[1..];
    }
    if remainder.len() < 4 || !remainder[..4].eq_ignore_ascii_case(b"base") {
        return None;
    }
    remainder = &remainder[4..];
    remainder
        .iter()
        .all(|byte| byte.is_ascii_whitespace())
        .then_some((marker, run))
}

fn closes_fence(line: &str, marker: u8, minimum_length: usize) -> bool {
    let bytes = line.as_bytes();
    let indent = bytes.iter().take_while(|byte| **byte == b' ').count();
    if indent > 3 || bytes.get(indent) != Some(&marker) {
        return false;
    }
    let run = bytes[indent..]
        .iter()
        .take_while(|byte| **byte == marker)
        .count();
    run >= minimum_length
        && bytes[indent + run..]
            .iter()
            .all(|byte| byte.is_ascii_whitespace())
}

fn parse_embedded_definition(
    source: String,
    start: usize,
    end: usize,
) -> EmbeddedBaseDefinition {
    match parse_base(source.as_bytes()) {
        Ok(document) => EmbeddedBaseDefinition {
            issues: document.issues.clone(),
            source,
            start,
            end,
            document: Some(document),
        },
        Err(error) => EmbeddedBaseDefinition {
            source,
            start,
            end,
            document: None,
            issues: vec![BaseIssue::new(
                BaseIssueKind::InvalidSource,
                error.to_string(),
                None,
            )],
        },
    }
}

impl YamlValue {
    pub(crate) fn as_sequence(&self) -> Option<&[YamlValue]> {
        match self {
            Self::Sequence(values) => Some(values),
            _ => None,
        }
    }

    pub(crate) fn as_string(&self) -> Option<&str> {
        match self {
            Self::String(value) => Some(value),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BaseIssueKind, BaseRawValue, BaseRow, BaseSourceFormat, BaseViewType, encode_base,
        evaluate_base, parse_base, parse_embedded_bases, YamlValue,
    };
    use serde_json::Value;

    const C07_BASES_FIXTURE: &str = include_str!("../../../fixtures/c07-bases.json");
    const C07_UNSUPPORTED_FORMULA_FIXTURE: &str =
        include_str!("../../../fixtures/c07-unsupported-formula.json");
    const LEGACY_NATIVE_BASES_FIXTURE: &str = include_str!("../../../fixtures/bases-native.yaml");

    fn fixture_rows(value: &Value) -> Vec<BaseRow> {
        value
            .as_array()
            .expect("fixture rows must be an array")
            .iter()
            .map(|row| BaseRow {
                path: row["path"]
                    .as_str()
                    .expect("fixture row path must be a string")
                    .to_owned(),
                properties: row["properties"]
                    .as_object()
                    .expect("fixture row properties must be an object")
                    .clone(),
            })
            .collect()
    }

    fn source_for_case(case: &Value) -> Vec<u8> {
        match case["format"].as_str() {
            Some("json") => serde_json::to_vec(&case["source"])
                .expect("fixture JSON Bases source must encode"),
            Some("yaml") => case["source"]
                .as_str()
                .expect("fixture YAML source must be a string")
                .as_bytes()
                .to_vec(),
            other => panic!("unsupported fixture source format {other:?}"),
        }
    }

    fn raw_field_exists(raw: &BaseRawValue, key: &str) -> bool {
        match raw {
            BaseRawValue::Json(value) => value.get(key).is_some(),
            BaseRawValue::NativeYaml(YamlValue::Mapping(entries)) => {
                entries.iter().any(|entry| entry.key == key)
            }
            BaseRawValue::NativeYaml(_) => false,
        }
    }

    fn view_type_name(view_type: BaseViewType) -> &'static str {
        match view_type {
            BaseViewType::Table => "table",
            BaseViewType::List => "list",
            BaseViewType::Cards => "cards",
        }
    }

    fn issue_kind_name(kind: BaseIssueKind) -> &'static str {
        match kind {
            BaseIssueKind::UnsupportedFormula => "unsupported-formula",
            BaseIssueKind::InvalidFilter => "invalid-filter",
            BaseIssueKind::InvalidSource => "invalid-source",
        }
    }

    #[test]
    fn fixture_json_and_native_yaml_definitions_evaluate_and_preserve_source() {
        let fixture: Value =
            serde_json::from_str(C07_BASES_FIXTURE).expect("C07 Bases fixture must be JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c07-bases");

        for case in fixture["supported_cases"]
            .as_array()
            .expect("C07 fixture must contain supported cases")
        {
            let case_id = case["id"]
                .as_str()
                .expect("each C07 case must have an id");
            let source = source_for_case(case);
            let document = parse_base(&source)
                .unwrap_or_else(|error| panic!("{case_id}: source must parse: {error}"));
            let expected_format = match case["format"].as_str() {
                Some("json") => BaseSourceFormat::Json,
                Some("yaml") => BaseSourceFormat::NativeYaml,
                _ => panic!("{case_id}: fixture format must be known"),
            };
            assert_eq!(document.source_format(), expected_format, "{case_id}");
            assert_eq!(encode_base(&document), source, "{case_id}: exact source bytes");
            assert!(document.issues().is_empty(), "{case_id}: supported source issues");

            let expected_types = case["expected"]["view_types"]
                .as_array()
                .expect("expected view types must be an array")
                .iter()
                .map(|value| value.as_str().expect("view type must be a string"))
                .collect::<Vec<_>>();
            let actual_types = document
                .views()
                .iter()
                .map(|view| view_type_name(view.view_type))
                .collect::<Vec<_>>();
            assert_eq!(actual_types, expected_types, "{case_id}: supported views");

            let result = evaluate_base(
                &document,
                case["view"].as_str().expect("view name must be a string"),
                &fixture_rows(&case["rows"]),
            )
            .unwrap_or_else(|error| panic!("{case_id}: view must evaluate: {error}"));
            let expected_paths = case["expected"]["paths"]
                .as_array()
                .expect("expected paths must be an array")
                .iter()
                .map(|path| path.as_str().expect("expected path must be a string"))
                .collect::<Vec<_>>();
            assert_eq!(
                result.rows.iter().map(|row| row.path.as_str()).collect::<Vec<_>>(),
                expected_paths,
                "{case_id}: selected rows"
            );
            let formula_name = case["expected"]["formula"]["name"]
                .as_str()
                .expect("formula name must be a string");
            assert_eq!(
                result.rows[0].values.get(formula_name),
                Some(&case["expected"]["formula"]["value"]),
                "{case_id}: supported formula"
            );
            if case_id == "json-supported-definition" {
                assert_eq!(
                    result.rows[0].values.get("isOpen").and_then(Value::as_bool),
                    Some(true)
                );
                assert_eq!(
                    result.rows[0].values.get("answer").and_then(Value::as_f64),
                    Some(42.0)
                );
                assert_eq!(
                    result.rows[0].values.get("quoted").and_then(Value::as_str),
                    Some("hello")
                );
                assert_eq!(
                    result.rows[0].properties.get("metadata"),
                    Some(&case["rows"][1]["properties"]["metadata"]),
                    "{case_id}: nested property values"
                );
            }
            let expected_groups = case["expected"]["group_names"]
                .as_array()
                .expect("expected groups must be an array")
                .iter()
                .map(|name| name.as_str().expect("group must be a string"))
                .collect::<Vec<_>>();
            assert_eq!(
                result.groups.keys().map(String::as_str).collect::<Vec<_>>(),
                expected_groups,
                "{case_id}: group keys"
            );
            assert!(
                raw_field_exists(document.raw_definition(), "unknownRoot"),
                "{case_id}: unknown root field remains available"
            );
            assert!(
                raw_field_exists(result.view.raw_definition(), "unknownView"),
                "{case_id}: unknown view field remains available"
            );
        }
    }

    #[test]
    fn parses_and_evaluates_the_existing_native_bases_fixture() {
        let fixture: Value =
            serde_json::from_str(C07_BASES_FIXTURE).expect("C07 Bases fixture must be JSON");
        let case = &fixture["supported_cases"][1];
        let document = parse_base(LEGACY_NATIVE_BASES_FIXTURE.as_bytes())
            .expect("legacy native Bases fixture must parse");

        assert_eq!(document.source_format(), BaseSourceFormat::NativeYaml);
        assert_eq!(document.source_bytes(), LEGACY_NATIVE_BASES_FIXTURE.as_bytes());
        let encoded = encode_base(&document);
        assert_eq!(encoded.as_slice(), LEGACY_NATIVE_BASES_FIXTURE.as_bytes());
        assert_eq!(document.views().len(), 2);
        assert!(raw_field_exists(document.raw_definition(), "properties"));

        let result = evaluate_base(
            &document,
            "Open items",
            &fixture_rows(&case["rows"]),
        )
        .expect("legacy native Bases view must evaluate");
        let expected_paths = case["expected"]["paths"]
            .as_array()
            .expect("expected paths must be an array")
            .iter()
            .map(|path| path.as_str().expect("path must be a string"))
            .collect::<Vec<_>>();
        let actual_paths = result
            .rows
            .iter()
            .map(|row| row.path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(actual_paths, expected_paths);
        assert!(result.issues.is_empty());
    }

    #[test]
    fn unsupported_native_filter_is_reported_without_partial_filtering() {
        let fixture: Value =
            serde_json::from_str(C07_BASES_FIXTURE).expect("C07 fixture must be JSON");
        let case = &fixture["unsupported_native_filter"];
        assert_eq!(
            case["id"],
            "native-unsupported-filter-is-not-applied"
        );
        let source = case["source"]
            .as_str()
            .expect("unsupported native source must be a string")
            .as_bytes();
        let document = parse_base(source).expect("unsupported filter source still parses");
        let result = evaluate_base(
            &document,
            case["view"].as_str().expect("view name must be a string"),
            &fixture_rows(&case["rows"]),
        )
        .expect("unsupported native filter view evaluates without applying it");

        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].path, "closed.md");
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].kind, BaseIssueKind::InvalidFilter);
        assert_eq!(
            issue_kind_name(result.issues[0].kind),
            case["expected"]["issue_kind"].as_str().unwrap()
        );
        assert_eq!(
            result.issues[0].message.as_str(),
            case["expected"]["issue_message"].as_str().unwrap()
        );
        assert_eq!(document.source_bytes(), source);
    }

    #[test]
    fn fixture_json_filter_operators_and_nested_boolean_forms_evaluate() {
        let fixture: Value =
            serde_json::from_str(C07_BASES_FIXTURE).expect("C07 fixture must be JSON");
        let case = &fixture["filter_operator_case"];
        assert_eq!(case["id"], "json-filter-operator-subset");
        let source = serde_json::to_vec(&case["source"]).expect("filter definition encodes");
        let document = parse_base(&source).expect("supported filters parse");
        let result = evaluate_base(
            &document,
            case["view"].as_str().expect("view name must be a string"),
            &fixture_rows(&case["rows"]),
        )
        .expect("supported filter view evaluates");
        let expected_paths = case["expected"]["paths"]
            .as_array()
            .expect("expected paths must be an array")
            .iter()
            .map(|path| path.as_str().expect("expected path must be a string"))
            .collect::<Vec<_>>();

        assert_eq!(
            result.rows.iter().map(|row| row.path.as_str()).collect::<Vec<_>>(),
            expected_paths
        );
    }

    #[test]
    fn numeric_and_file_field_fixture_cases_use_typed_values() {
        let fixture: Value =
            serde_json::from_str(C07_BASES_FIXTURE).expect("C07 fixture must be JSON");

        for case_id in [
            "numeric_sort_case",
            "numeric_filter_case",
            "file_derived_fields_case",
        ] {
            let case = &fixture[case_id];
            let source = serde_json::to_vec(&case["source"])
                .unwrap_or_else(|error| panic!("{case_id}: source must encode: {error}"));
            let document = parse_base(&source)
                .unwrap_or_else(|error| panic!("{case_id}: source must parse: {error}"));
            let result = evaluate_base(
                &document,
                case["view"].as_str().expect("view name must be a string"),
                &fixture_rows(&case["rows"]),
            )
            .unwrap_or_else(|error| panic!("{case_id}: view must evaluate: {error}"));
            let expected_paths = case["expected"]["paths"]
                .as_array()
                .expect("expected paths must be an array")
                .iter()
                .map(|path| path.as_str().expect("expected path must be a string"))
                .collect::<Vec<_>>();
            assert_eq!(
                result.rows.iter().map(|row| row.path.as_str()).collect::<Vec<_>>(),
                expected_paths,
                "{case_id}: evaluated paths"
            );

            if let Some(expected_fields) = case["expected"]["fields"].as_object() {
                for row in &result.rows {
                    let expected = &expected_fields[row.path.as_str()];
                    assert_eq!(
                        row.values.get("file.name"),
                        expected.get("name"),
                        "{case_id}: file.name for {}",
                        row.path
                    );
                    assert_eq!(
                        row.values.get("file.ext"),
                        expected.get("ext"),
                        "{case_id}: file.ext for {}",
                        row.path
                    );
                }
            }
            assert_eq!(encode_base(&document), source, "{case_id}: source retention");
        }
    }

    #[test]
    fn unsupported_formula_fixture_returns_issue_and_no_fabricated_value() {
        let fixture: Value = serde_json::from_str(C07_UNSUPPORTED_FORMULA_FIXTURE)
            .expect("unsupported formula fixture must be JSON");
        assert_eq!(fixture["schema_version"], 1);
        assert_eq!(fixture["id"], "fixture:c07-unsupported-formula");
        let source = serde_json::to_vec(&fixture["source"])
            .expect("unsupported formula source must encode");
        let document = parse_base(&source).expect("unsupported formula definition parses");
        let result = evaluate_base(
            &document,
            fixture["view"].as_str().expect("view name must be a string"),
            &fixture_rows(&fixture["rows"]),
        )
        .expect("unsupported formula view evaluates with an issue");
        let formula = fixture["expected"]["formula"]
            .as_str()
            .expect("formula name must be a string");

        assert!(result.rows[0].values.get(formula).is_none());
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].kind, BaseIssueKind::UnsupportedFormula);
        assert_eq!(
            issue_kind_name(result.issues[0].kind),
            fixture["expected"]["issue_kind"].as_str().unwrap()
        );
        assert_eq!(
            result.issues[0].expression.as_deref(),
            fixture["expected"]["issue_expression"].as_str()
        );
        assert_eq!(
            result.issues[0].message.as_str(),
            fixture["expected"]["issue_message"].as_str().unwrap()
        );
        assert_eq!(encode_base(&document), source);
        assert!(raw_field_exists(document.raw_definition(), "unknownRoot"));
        assert!(raw_field_exists(
            result.view.raw_definition(),
            "unknownView"
        ));

        for case in fixture["edge_cases"]
            .as_array()
            .expect("unsupported formula edge cases must be an array")
        {
            let case_id = case["id"].as_str().expect("edge case must have an id");
            let mut source_value = fixture["source"].clone();
            if let Some(filter) = case.get("filter") {
                source_value["views"][0]["filter"] = filter.clone();
            }
            let edge_source = serde_json::to_vec(&source_value)
                .expect("edge-case Bases source must encode");
            let edge_document = parse_base(&edge_source)
                .unwrap_or_else(|error| panic!("{case_id}: source must parse: {error}"));
            assert_eq!(
                encode_base(&edge_document),
                edge_source,
                "{case_id}: source retained"
            );
            let edge_result = evaluate_base(
                &edge_document,
                fixture["view"].as_str().expect("view name must be a string"),
                &fixture_rows(&case["rows"]),
            )
            .unwrap_or_else(|error| panic!("{case_id}: view must evaluate: {error}"));

            assert_eq!(
                edge_result.rows.len(),
                case["expected"]["row_count"].as_u64().unwrap() as usize,
                "{case_id}: surviving rows"
            );
            assert_eq!(
                edge_result.issues.len(),
                case["expected"]["issue_count"].as_u64().unwrap() as usize,
                "{case_id}: formula issue remains visible"
            );
            assert_eq!(
                edge_result.issues[0].kind,
                BaseIssueKind::UnsupportedFormula,
                "{case_id}: issue kind"
            );
            assert_eq!(
                edge_result.issues[0].expression.as_deref(),
                fixture["expected"]["issue_expression"].as_str(),
                "{case_id}: issue expression"
            );
            assert_eq!(
                edge_result.issues[0].message,
                fixture["expected"]["issue_message"].as_str().unwrap(),
                "{case_id}: issue message"
            );

            if let Some(source_property) = case["expected"]["source_property"].as_str() {
                let formula = fixture["expected"]["formula"]
                    .as_str()
                    .expect("formula name must be a string");
                assert_eq!(
                    edge_result.rows[0].properties.get(formula).and_then(Value::as_str),
                    Some(source_property),
                    "{case_id}: source property is retained separately"
                );
                assert_eq!(
                    edge_result.rows[0].values.get(formula).is_none(),
                    case["expected"]["formula_value_absent"].as_bool().unwrap(),
                    "{case_id}: source property must not masquerade as formula output"
                );
            }
        }
    }

    #[test]
    fn embedded_definition_fixture_retains_byte_spans_and_source() {
        let fixture: Value =
            serde_json::from_str(C07_BASES_FIXTURE).expect("C07 fixture must be JSON");
        let case = &fixture["embedded_case"];
        assert_eq!(case["id"], "embedded-definitions-retain-source-spans");
        let source = case["source"]
            .as_str()
            .expect("embedded source must be a string");
        let definitions = parse_embedded_bases(source);

        assert_eq!(definitions.len(), case["expected_count"].as_u64().unwrap() as usize);
        let definition = &definitions[0];
        assert_eq!(
            &source[definition.start..definition.end],
            definition.source.as_str()
        );
        assert!(definition.issues.is_empty());
        let document = definition.document.as_ref().expect("embedded definition parses");
        assert_eq!(
            document.views()[0].name.as_deref(),
            case["expected_view"].as_str()
        );
        assert!(raw_field_exists(
            document.views()[0].raw_definition(),
            "unknownView"
        ));
    }

    #[test]
    fn unclosed_embedded_definition_fixture_is_an_explicit_source_issue() {
        let fixture: Value =
            serde_json::from_str(C07_BASES_FIXTURE).expect("C07 fixture must be JSON");
        let case = &fixture["unclosed_embedded_case"];
        assert_eq!(case["id"], "unclosed-definition-is-an-issue");
        let definitions = parse_embedded_bases(
            case["source"]
                .as_str()
                .expect("unclosed source must be a string"),
        );

        assert_eq!(definitions.len(), 1);
        assert!(definitions[0].document.is_none());
        assert_eq!(definitions[0].issues[0].kind, BaseIssueKind::InvalidSource);
        assert_eq!(
            definitions[0].issues[0].message,
            case["expected_issue"].as_str().unwrap()
        );
    }

    #[test]
    fn numeric_filters_and_sorting_compare_json_numbers_by_value() {
        let source = serde_json::json!({
            "version": 1,
            "views": [
                {
                    "type": "table",
                    "name": "Ascending",
                    "sort": [{"field": "score", "direction": "asc"}]
                },
                {
                    "type": "table",
                    "name": "Natural labels",
                    "sort": [{"field": "label", "direction": "asc"}]
                },
                {
                    "type": "list",
                    "name": "Above quarter",
                    "filter": {
                        "kind": "comparison",
                        "field": "score",
                        "operator": "gt",
                        "value": 0.25
                    },
                    "sort": [{"field": "score", "direction": "asc"}]
                }
            ]
        });
        let document = parse_base(
            &serde_json::to_vec(&source).expect("numeric Bases source must encode"),
        )
        .expect("numeric Bases source must parse");
        let row = |path: &str, score: f64, label: &str| BaseRow {
            path: path.to_owned(),
            properties: serde_json::json!({"score": score, "label": label})
                .as_object()
                .expect("row properties must be an object")
                .clone(),
        };
        let rows = vec![
            row("half.md", 0.5, "item10"),
            row("two.md", 2.0, "item2"),
            row("quarter.md", 0.25, "item3"),
            row("small.md", 0.05, "item1"),
        ];

        let sorted = evaluate_base(&document, "Ascending", &rows)
            .expect("numeric sort view must evaluate");
        assert_eq!(
            sorted.rows.iter().map(|row| row.path.as_str()).collect::<Vec<_>>(),
            ["small.md", "quarter.md", "half.md", "two.md"]
        );

        let natural = evaluate_base(&document, "Natural labels", &rows)
            .expect("natural string sort view must evaluate");
        assert_eq!(
            natural
                .rows
                .iter()
                .map(|row| row.path.as_str())
                .collect::<Vec<_>>(),
            ["small.md", "two.md", "quarter.md", "half.md"]
        );

        let filtered = evaluate_base(&document, "Above quarter", &rows)
            .expect("numeric filter view must evaluate");
        assert_eq!(
            filtered
                .rows
                .iter()
                .map(|row| row.path.as_str())
                .collect::<Vec<_>>(),
            ["half.md", "two.md"]
        );
    }

    #[test]
    fn derived_file_extension_uses_basename_and_is_available_for_sorting() {
        let source = br#"{"version":1,"views":[{"type":"table","name":"By extension","sort":[{"field":"file.ext"}]}]}"#;
        let document = parse_base(source).expect("file metadata Bases source must parse");
        let rows = vec![
            BaseRow {
                path: "folder.v1/no-extension".to_owned(),
                properties: serde_json::Map::new(),
            },
            BaseRow {
                path: "folder.v1/readme.md".to_owned(),
                properties: serde_json::Map::new(),
            },
        ];

        let result = evaluate_base(&document, "By extension", &rows)
            .expect("file metadata view must evaluate");
        assert_eq!(
            result.rows.iter().map(|row| row.path.as_str()).collect::<Vec<_>>(),
            ["folder.v1/no-extension", "folder.v1/readme.md"]
        );
        assert_eq!(
            result.rows[0].values.get("file.ext"),
            Some(&Value::String(String::new()))
        );
        assert_eq!(
            result.rows[1].values.get("file.ext"),
            Some(&Value::String("md".to_owned()))
        );
        assert_eq!(
            result.rows[1].values.get("file.name"),
            Some(&Value::String("readme.md".to_owned()))
        );
    }

    #[test]
    fn identical_unsupported_formula_issues_are_reported_once_for_many_rows() {
        let source = br#"{"version":1,"views":[{"type":"list","name":"Notes","formulas":{"bad":"date(today)"}}]}"#;
        let document = parse_base(source).expect("unsupported formula source must parse");
        let rows = ["one.md", "two.md", "three.md"]
            .into_iter()
            .map(|path| BaseRow {
                path: path.to_owned(),
                properties: serde_json::Map::new(),
            })
            .collect::<Vec<_>>();

        let result = evaluate_base(&document, "Notes", &rows)
            .expect("unsupported formula view must evaluate with an issue");
        assert_eq!(result.rows.len(), 3);
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].expression.as_deref(), Some("date(today)"));
    }

    #[test]
    fn parser_rejects_invalid_utf8_and_json_bases_shapes() {
        assert!(parse_base(&[b'{', 0xff, b'}']).is_err());
        assert!(parse_base(br#"{"version":2,"views":[]}"#).is_err());
    }
}
