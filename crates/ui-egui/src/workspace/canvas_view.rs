//! Pan/zoom viewer for JSON Canvas documents.
//!
//! The viewer never touches the vault. [`CanvasScene`] is an owned, UI-independent projection of a
//! parsed Canvas into draw primitives; [`CanvasView`] holds pan/zoom/selection state, paints a
//! scene and returns [`CanvasViewAction`] intents for the host to execute (save a text edit with
//! the revision check, open a note, create a note after an explicit preview).
//!
//! Documented limits: cards cannot be moved, resized or connected, and only text cards are
//! editable. Malformed or missing fields are kept visible as issues instead of being dropped.

use super::NavKey;
use eframe::egui;
use openobsidian_engine::{
    CanvasDocument, CanvasEdgeProjection, CanvasField, CanvasNodeContent, CanvasNodeProjection,
    parse_canvas,
};
use std::collections::BTreeMap;

/// Smallest zoom factor the view accepts.
pub const MIN_ZOOM: f32 = 0.05;
/// Largest zoom factor the view accepts.
pub const MAX_ZOOM: f32 = 4.0;

const DEFAULT_CARD_WIDTH: f32 = 250.0;
const DEFAULT_CARD_HEIGHT: f32 = 60.0;
const ZOOM_STEP: f32 = 1.25;
const FIT_MARGIN: f32 = 24.0;
const MAX_TITLE_CHARS: usize = 40;
const MAX_NOTE_NAME_CHARS: usize = 60;

/// Work the host must perform on behalf of the Canvas view.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CanvasViewAction {
    /// Save this text for the text card (revision-checked write through the engine).
    EditText { node_id: String, text: String },
    /// Open the vault note or file named by a file card.
    OpenNote(String),
    /// Open the URL of a link card.
    OpenLink(String),
    /// The user asked to create a note from this text card. The host must show a preview of the
    /// path and content and only then create the note; nothing is created automatically.
    CreateNoteFromCard {
        node_id: String,
        text: String,
        suggested_path: String,
    },
}

/// The kind of a Canvas card.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CardKind {
    Text,
    File,
    Link,
    Group,
    Unsupported,
}

impl CardKind {
    fn name(self) -> &'static str {
        match self {
            Self::Text => "Text",
            Self::File => "File",
            Self::Link => "Link",
            Self::Group => "Group",
            Self::Unsupported => "Unsupported",
        }
    }
}

/// A side of a card where an edge attaches.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Side {
    Top,
    Bottom,
    Left,
    Right,
}

/// One card to draw, in world coordinates.
#[derive(Clone, Debug, PartialEq)]
pub struct CardPrim {
    /// Node id; empty when the id is missing or malformed (such a card cannot be selected).
    pub id: String,
    pub kind: CardKind,
    pub rect: egui::Rect,
    pub color: Option<egui::Color32>,
    /// Short single-line summary used in the keyboard card list.
    pub title: String,
    /// Full text of a text card, file path, URL or group label.
    pub body: String,
    /// Note path for file cards or URL for link cards.
    pub target: Option<String>,
    /// Problems found in this node's fields.
    pub issues: Vec<String>,
}

impl CardPrim {
    /// Accessible one-line label for the card list.
    pub fn list_label(&self) -> String {
        let mut label = format!("{}: {}", self.kind.name(), self.title);
        if !self.issues.is_empty() {
            label.push_str(" (has issues)");
        }
        label
    }
}

/// One edge to draw, in world coordinates.
#[derive(Clone, Debug, PartialEq)]
pub struct EdgePrim {
    pub from: egui::Pos2,
    pub to: egui::Pos2,
    pub arrow_from: bool,
    pub arrow_to: bool,
    pub label: Option<String>,
    pub color: Option<egui::Color32>,
}

/// Owned draw primitives for one Canvas document.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CanvasScene {
    /// Cards in paint order: groups first, then every other card in document order.
    pub cards: Vec<CardPrim>,
    pub edges: Vec<EdgePrim>,
    /// Document-level problems (bad arrays, edges that point at missing cards).
    pub issues: Vec<String>,
}

impl CanvasScene {
    /// Parses Canvas bytes and projects them.
    pub fn from_source(bytes: &[u8]) -> Result<Self, String> {
        parse_canvas(bytes)
            .map(|document| Self::from_document(&document))
            .map_err(|error| error.to_string())
    }

    /// Projects a parsed document. Malformed entries become issues, never silent drops.
    pub fn from_document(document: &CanvasDocument) -> Self {
        let mut issues = Vec::new();
        if document.nodes_field().is_malformed() {
            issues.push("`nodes` is not an array".to_owned());
        }
        if document.edges_field().is_malformed() {
            issues.push("`edges` is not an array".to_owned());
        }
        let mut groups = Vec::new();
        let mut others = Vec::new();
        for node in document.project_nodes() {
            let card = card_from_node(&node);
            if card.kind == CardKind::Group {
                groups.push(card);
            } else {
                others.push(card);
            }
        }
        groups.extend(others);
        let cards = groups;

        let edges = {
            let mut lookup: BTreeMap<&str, usize> = BTreeMap::new();
            for (index, card) in cards.iter().enumerate() {
                if !card.id.is_empty() {
                    lookup.entry(card.id.as_str()).or_insert(index);
                }
            }
            let mut edges = Vec::new();
            for (position, edge) in document.project_edges().enumerate() {
                match edge_from_projection(&edge, &cards, &lookup) {
                    Ok(prim) => edges.push(prim),
                    Err(problem) => issues.push(format!("edge {}: {problem}", position + 1)),
                }
            }
            edges
        };
        Self {
            cards,
            edges,
            issues,
        }
    }

    /// Finds a card by node id.
    pub fn card_by_id(&self, id: &str) -> Option<&CardPrim> {
        if id.is_empty() {
            return None;
        }
        self.cards.iter().find(|card| card.id == id)
    }

    /// Topmost card containing a world-space point.
    pub fn hit_test(&self, world: egui::Pos2) -> Option<usize> {
        self.cards
            .iter()
            .rposition(|card| card.rect.contains(world))
    }

    /// Bounding box of every card, if there are any.
    pub fn bounds(&self) -> Option<egui::Rect> {
        let mut cards = self.cards.iter();
        let first = cards.next()?;
        Some(cards.fold(first.rect, |bounds, card| bounds.union(card.rect)))
    }

    /// Total number of problems, including per-card ones.
    pub fn issue_count(&self) -> usize {
        self.issues.len()
            + self
                .cards
                .iter()
                .map(|card| card.issues.len())
                .sum::<usize>()
    }
}

fn absent<T>(field: &CanvasField<'_, T>) -> &'static str {
    if field.is_malformed() {
        "malformed"
    } else {
        "missing"
    }
}

fn geometry(
    value: Option<f64>,
    absent_reason: &str,
    default: f32,
    name: &str,
    issues: &mut Vec<String>,
) -> f32 {
    match value {
        Some(number) if number.is_finite() => number as f32,
        _ => {
            issues.push(format!("{name} is {absent_reason}; using {default}"));
            default
        }
    }
}

fn card_from_node(node: &CanvasNodeProjection<'_>) -> CardPrim {
    let mut issues = Vec::new();
    let id = node.id.valid().copied().unwrap_or("").to_owned();
    if id.is_empty() {
        issues.push(format!("node id is {}", absent(&node.id)));
    }
    let x = geometry(
        node.x.valid().and_then(|number| number.as_f64()),
        absent(&node.x),
        0.0,
        "x",
        &mut issues,
    );
    let y = geometry(
        node.y.valid().and_then(|number| number.as_f64()),
        absent(&node.y),
        0.0,
        "y",
        &mut issues,
    );
    let mut width = geometry(
        node.width.valid().and_then(|number| number.as_f64()),
        absent(&node.width),
        DEFAULT_CARD_WIDTH,
        "width",
        &mut issues,
    );
    let mut height = geometry(
        node.height.valid().and_then(|number| number.as_f64()),
        absent(&node.height),
        DEFAULT_CARD_HEIGHT,
        "height",
        &mut issues,
    );
    if width <= 0.0 {
        issues.push("width is not positive".to_owned());
        width = DEFAULT_CARD_WIDTH;
    }
    if height <= 0.0 {
        issues.push("height is not positive".to_owned());
        height = DEFAULT_CARD_HEIGHT;
    }
    if node.color.is_malformed() {
        issues.push("color is malformed".to_owned());
    }
    let color = node.color.valid().copied().and_then(parse_color);

    let mut target = None;
    let (kind, body) = match &node.content {
        CanvasNodeContent::Text { text } => {
            let body = match text.valid().copied() {
                Some(value) => value.to_owned(),
                None => {
                    issues.push(format!("text is {}", absent(text)));
                    String::new()
                }
            };
            (CardKind::Text, body)
        }
        CanvasNodeContent::File { file, subpath } => {
            if subpath.is_malformed() {
                issues.push("subpath is malformed".to_owned());
            }
            let body = match file.valid().copied() {
                Some(value) if !value.is_empty() => {
                    target = Some(value.to_owned());
                    value.to_owned()
                }
                _ => {
                    issues.push(format!("file is {}", absent(file)));
                    String::new()
                }
            };
            (CardKind::File, body)
        }
        CanvasNodeContent::Link { url } => {
            let body = match url.valid().copied() {
                Some(value) if !value.is_empty() => {
                    target = Some(value.to_owned());
                    value.to_owned()
                }
                _ => {
                    issues.push(format!("url is {}", absent(url)));
                    String::new()
                }
            };
            (CardKind::Link, body)
        }
        CanvasNodeContent::Group { label, .. } => {
            if label.is_malformed() {
                issues.push("label is malformed".to_owned());
            }
            (
                CardKind::Group,
                label.valid().copied().unwrap_or("").to_owned(),
            )
        }
        CanvasNodeContent::Unsupported { node_type } => {
            match node_type.valid().copied() {
                Some(value) => issues.push(format!("unsupported node type `{value}`")),
                None => issues.push(format!("node type is {}", absent(node_type))),
            }
            (CardKind::Unsupported, String::new())
        }
    };
    let title = if body.is_empty() {
        format!("(empty {})", kind.name().to_lowercase())
    } else {
        preview(&body, MAX_TITLE_CHARS)
    };
    CardPrim {
        id,
        kind,
        rect: egui::Rect::from_min_size(egui::pos2(x, y), egui::vec2(width, height)),
        color,
        title,
        body,
        target,
        issues,
    }
}

fn edge_from_projection(
    edge: &CanvasEdgeProjection<'_>,
    cards: &[CardPrim],
    lookup: &BTreeMap<&str, usize>,
) -> Result<EdgePrim, String> {
    let from_id = edge
        .from_node
        .valid()
        .copied()
        .ok_or_else(|| format!("fromNode is {}", absent(&edge.from_node)))?;
    let to_id = edge
        .to_node
        .valid()
        .copied()
        .ok_or_else(|| format!("toNode is {}", absent(&edge.to_node)))?;
    let from_card = lookup
        .get(from_id)
        .and_then(|index| cards.get(*index))
        .ok_or_else(|| format!("fromNode `{from_id}` does not exist"))?;
    let to_card = lookup
        .get(to_id)
        .and_then(|index| cards.get(*index))
        .ok_or_else(|| format!("toNode `{to_id}` does not exist"))?;
    let (auto_from, auto_to) = auto_sides(from_card.rect, to_card.rect);
    let from_side = parse_side(&edge.from_side).unwrap_or(auto_from);
    let to_side = parse_side(&edge.to_side).unwrap_or(auto_to);
    Ok(EdgePrim {
        from: anchor(from_card.rect, from_side),
        to: anchor(to_card.rect, to_side),
        arrow_from: parse_end(&edge.from_end, false),
        arrow_to: parse_end(&edge.to_end, true),
        label: edge
            .label
            .valid()
            .copied()
            .filter(|label| !label.is_empty())
            .map(str::to_owned),
        color: edge.color.valid().copied().and_then(parse_color),
    })
}

fn parse_side(field: &CanvasField<'_, &str>) -> Option<Side> {
    match field.valid().copied() {
        Some("top") => Some(Side::Top),
        Some("bottom") => Some(Side::Bottom),
        Some("left") => Some(Side::Left),
        Some("right") => Some(Side::Right),
        _ => None,
    }
}

fn parse_end(field: &CanvasField<'_, &str>, default: bool) -> bool {
    match field.valid().copied() {
        Some("arrow") => true,
        Some("none") => false,
        _ => default,
    }
}

/// Chooses attachment sides for an edge whose sides are not specified.
pub fn auto_sides(from: egui::Rect, to: egui::Rect) -> (Side, Side) {
    let delta = to.center() - from.center();
    if delta.x.abs() >= delta.y.abs() {
        if delta.x >= 0.0 {
            (Side::Right, Side::Left)
        } else {
            (Side::Left, Side::Right)
        }
    } else if delta.y >= 0.0 {
        (Side::Bottom, Side::Top)
    } else {
        (Side::Top, Side::Bottom)
    }
}

/// Midpoint of one side of a rectangle.
pub fn anchor(rect: egui::Rect, side: Side) -> egui::Pos2 {
    match side {
        Side::Top => egui::pos2(rect.center().x, rect.min.y),
        Side::Bottom => egui::pos2(rect.center().x, rect.max.y),
        Side::Left => egui::pos2(rect.min.x, rect.center().y),
        Side::Right => egui::pos2(rect.max.x, rect.center().y),
    }
}

/// The two barb end points of an arrow head whose tip is `tip` and which points away from `origin`.
pub fn arrow_head(tip: egui::Pos2, origin: egui::Pos2, size: f32) -> [egui::Pos2; 2] {
    let direction = tip - origin;
    let length = direction.length();
    if length < 1e-3 {
        return [tip, tip];
    }
    let unit = direction / length;
    let perpendicular = egui::vec2(-unit.y, unit.x);
    let base = tip - unit * size;
    [
        base + perpendicular * (size * 0.5),
        base - perpendicular * (size * 0.5),
    ]
}

/// Parses a Canvas preset (`"1"` to `"6"`) or `#rrggbb` color.
pub fn parse_color(value: &str) -> Option<egui::Color32> {
    match value {
        "1" => return Some(egui::Color32::from_rgb(0xe9, 0x3a, 0x3a)),
        "2" => return Some(egui::Color32::from_rgb(0xe9, 0x8a, 0x2f)),
        "3" => return Some(egui::Color32::from_rgb(0xd9, 0xb9, 0x2a)),
        "4" => return Some(egui::Color32::from_rgb(0x3a, 0xa8, 0x55)),
        "5" => return Some(egui::Color32::from_rgb(0x2a, 0xa8, 0xc4)),
        "6" => return Some(egui::Color32::from_rgb(0x8a, 0x5c, 0xd6)),
        _ => {}
    }
    if value.len() != 7 || !value.is_ascii() || !value.starts_with('#') {
        return None;
    }
    let red = u8::from_str_radix(&value[1..3], 16).ok()?;
    let green = u8::from_str_radix(&value[3..5], 16).ok()?;
    let blue = u8::from_str_radix(&value[5..7], 16).ok()?;
    Some(egui::Color32::from_rgb(red, green, blue))
}

/// First non-empty line of `text`, shortened to `max_chars` characters.
pub fn preview(text: &str, max_chars: usize) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    if line.chars().count() > max_chars {
        let mut shortened: String = line.chars().take(max_chars).collect();
        shortened.push_str("...");
        shortened
    } else {
        line.to_owned()
    }
}

/// Suggested vault-relative note path for "create note from card": derived from the first line.
pub fn suggested_note_path(text: &str) -> String {
    let line = text
        .lines()
        .map(|line| line.trim().trim_start_matches('#').trim())
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let cleaned: String = line
        .chars()
        .filter(|character| !character.is_control() && !"\\/:*?\"<>|[]^#".contains(*character))
        .take(MAX_NOTE_NAME_CHARS)
        .collect();
    let name = cleaned.trim();
    if name.is_empty() {
        "Untitled.md".to_owned()
    } else {
        format!("{name}.md")
    }
}

/// Moves a card-list selection forward or backward, wrapping around.
pub fn cycle_selection(len: usize, current: Option<usize>, forward: bool) -> Option<usize> {
    if len == 0 {
        return None;
    }
    Some(match (current, forward) {
        (None, true) => 0,
        (None, false) => len - 1,
        (Some(index), true) => (index + 1) % len,
        (Some(index), false) => (index + len - 1) % len,
    })
}

/// Maps a navigation key to a card-list step: `Down`/`Right` forward, `Up`/`Left` backward.
pub fn nav_step(key: NavKey) -> Option<bool> {
    match key {
        NavKey::Down | NavKey::Right => Some(true),
        NavKey::Up | NavKey::Left => Some(false),
        _ => None,
    }
}

/// Pan and zoom between world coordinates and canvas-local screen coordinates (origin at the
/// top-left corner of the drawing area).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ViewTransform {
    pub pan: egui::Vec2,
    pub zoom: f32,
}

impl Default for ViewTransform {
    fn default() -> Self {
        Self {
            pan: egui::Vec2::ZERO,
            zoom: 1.0,
        }
    }
}

impl ViewTransform {
    pub fn to_local(&self, world: egui::Pos2) -> egui::Pos2 {
        (self.pan + world.to_vec2() * self.zoom).to_pos2()
    }

    pub fn to_world(&self, local: egui::Pos2) -> egui::Pos2 {
        ((local.to_vec2() - self.pan) / self.zoom).to_pos2()
    }

    pub fn rect_to_local(&self, rect: egui::Rect) -> egui::Rect {
        egui::Rect::from_min_max(self.to_local(rect.min), self.to_local(rect.max))
    }

    /// Multiplies the zoom by `factor` while keeping the world point under `local` fixed.
    pub fn zoom_at(&mut self, local: egui::Pos2, factor: f32) {
        let world = self.to_world(local);
        self.zoom = (self.zoom * factor).clamp(MIN_ZOOM, MAX_ZOOM);
        self.pan = local.to_vec2() - world.to_vec2() * self.zoom;
    }

    /// A transform that shows all of `bounds` inside a viewport of `viewport` size.
    pub fn fit(bounds: egui::Rect, viewport: egui::Vec2, margin: f32) -> Self {
        let available_x = (viewport.x - 2.0 * margin).max(1.0);
        let available_y = (viewport.y - 2.0 * margin).max(1.0);
        let zoom = (available_x / bounds.width().max(1.0))
            .min(available_y / bounds.height().max(1.0))
            .clamp(MIN_ZOOM, 1.5);
        Self {
            pan: viewport / 2.0 - bounds.center().to_vec2() * zoom,
            zoom,
        }
    }

    /// Pans so the center of `world_rect` is in the middle of the viewport.
    pub fn center_on(&mut self, world_rect: egui::Rect, viewport: egui::Vec2) {
        self.pan = viewport / 2.0 - world_rect.center().to_vec2() * self.zoom;
    }
}

#[derive(Clone, Debug)]
struct EditState {
    node_id: String,
    text: String,
}

/// Pan/zoom, selection and in-place edit state for one open Canvas.
#[derive(Clone, Debug)]
pub struct CanvasView {
    pub transform: ViewTransform,
    selected: Option<String>,
    editing: Option<EditState>,
    fit_pending: bool,
    reveal_pending: bool,
    last_size: egui::Vec2,
}

impl Default for CanvasView {
    fn default() -> Self {
        Self::new()
    }
}

impl CanvasView {
    pub fn new() -> Self {
        Self {
            transform: ViewTransform::default(),
            selected: None,
            editing: None,
            fit_pending: true,
            reveal_pending: false,
            last_size: egui::vec2(400.0, 300.0),
        }
    }

    /// Id of the selected card, if any.
    pub fn selected(&self) -> Option<&str> {
        self.selected.as_deref()
    }

    /// Whether a text card is being edited in place.
    pub fn is_editing(&self) -> bool {
        self.editing.is_some()
    }

    /// Selects a card by id and scrolls it into the middle of the view.
    pub fn select(&mut self, id: &str) {
        self.selected = Some(id.to_owned());
        self.reveal_pending = true;
    }

    /// Starts editing the text card `id`; returns false when it is not an editable text card.
    pub fn begin_edit(&mut self, scene: &CanvasScene, id: &str) -> bool {
        match scene.card_by_id(id) {
            Some(card) if card.kind == CardKind::Text => {
                self.editing = Some(EditState {
                    node_id: id.to_owned(),
                    text: card.body.clone(),
                });
                self.selected = Some(id.to_owned());
                true
            }
            _ => false,
        }
    }

    /// Abandons the in-place edit without producing an action.
    pub fn cancel_edit(&mut self) {
        self.editing = None;
    }

    /// Asks the next frame to fit the whole Canvas into view.
    pub fn request_fit(&mut self) {
        self.fit_pending = true;
    }

    fn commit_edit(&mut self, actions: &mut Vec<CanvasViewAction>) {
        if let Some(edit) = self.editing.take() {
            actions.push(CanvasViewAction::EditText {
                node_id: edit.node_id,
                text: edit.text,
            });
        }
    }

    /// Paints the toolbar, the keyboard card list and the pan/zoom surface.
    pub fn show(&mut self, ui: &mut egui::Ui, scene: &CanvasScene) -> Vec<CanvasViewAction> {
        let mut actions = Vec::new();
        let selection_vanished = self
            .selected
            .as_deref()
            .is_some_and(|id| scene.card_by_id(id).is_none());
        if selection_vanished {
            self.selected = None;
        }
        let edit_vanished = self
            .editing
            .as_ref()
            .is_some_and(|edit| scene.card_by_id(&edit.node_id).is_none());
        if edit_vanished {
            self.editing = None;
        }
        self.show_toolbar(ui, scene, &mut actions);
        self.show_card_list(ui, scene);
        self.show_surface(ui, scene, &mut actions);
        actions
    }

    fn show_toolbar(
        &mut self,
        ui: &mut egui::Ui,
        scene: &CanvasScene,
        actions: &mut Vec<CanvasViewAction>,
    ) {
        let selected = self.selected.clone();
        ui.horizontal_wrapped(|ui| {
            if ui.button("Zoom out").clicked() {
                let center = (self.last_size / 2.0).to_pos2();
                self.transform.zoom_at(center, 1.0 / ZOOM_STEP);
            }
            if ui.button("Zoom in").clicked() {
                let center = (self.last_size / 2.0).to_pos2();
                self.transform.zoom_at(center, ZOOM_STEP);
            }
            if ui.button("Fit to window").clicked() {
                self.fit_pending = true;
            }
            if ui.button("Reset view").clicked() {
                self.transform = ViewTransform::default();
            }
            ui.label(format!("{:.0}%", self.transform.zoom * 100.0));
            let issue_count = scene.issue_count();
            if issue_count > 0 {
                ui.colored_label(
                    ui.visuals().warn_fg_color,
                    format!("{issue_count} issue(s)"),
                );
            }
            if self.editing.is_some() {
                if ui.button("Save card").clicked() {
                    self.commit_edit(actions);
                }
                if ui.button("Cancel edit").clicked() {
                    self.editing = None;
                }
                return;
            }
            let Some(card) = selected.as_deref().and_then(|id| scene.card_by_id(id)) else {
                return;
            };
            match card.kind {
                CardKind::Text => {
                    if ui.button("Edit text").clicked() {
                        self.editing = Some(EditState {
                            node_id: card.id.clone(),
                            text: card.body.clone(),
                        });
                    }
                    if ui.button("Create note from card").clicked() {
                        actions.push(CanvasViewAction::CreateNoteFromCard {
                            node_id: card.id.clone(),
                            text: card.body.clone(),
                            suggested_path: suggested_note_path(&card.body),
                        });
                    }
                }
                CardKind::File => {
                    if let Some(path) = &card.target
                        && ui.button("Open note").clicked()
                    {
                        actions.push(CanvasViewAction::OpenNote(path.clone()));
                    }
                }
                CardKind::Link => {
                    if let Some(url) = &card.target
                        && ui.button("Open link").clicked()
                    {
                        actions.push(CanvasViewAction::OpenLink(url.clone()));
                    }
                }
                CardKind::Group | CardKind::Unsupported => {}
            }
        });
    }

    fn show_card_list(&mut self, ui: &mut egui::Ui, scene: &CanvasScene) {
        egui::CollapsingHeader::new(format!("Cards ({})", scene.cards.len()))
            .id_salt("openobsidian-canvas-card-list")
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    let current = self
                        .selected
                        .as_deref()
                        .and_then(|id| scene.cards.iter().position(|card| card.id == id));
                    let mut step = None;
                    if ui.button("Previous card").clicked() {
                        step = Some(false);
                    }
                    if ui.button("Next card").clicked() {
                        step = Some(true);
                    }
                    if let Some(forward) = step
                        && let Some(index) = cycle_selection(scene.cards.len(), current, forward)
                        && let Some(card) = scene.cards.get(index)
                        && !card.id.is_empty()
                    {
                        self.selected = Some(card.id.clone());
                        self.reveal_pending = true;
                    }
                });
                egui::ScrollArea::vertical()
                    .id_salt("openobsidian-canvas-card-scroll")
                    .max_height(140.0)
                    .show(ui, |ui| {
                        for card in &scene.cards {
                            let is_selected = !card.id.is_empty()
                                && self.selected.as_deref() == Some(card.id.as_str());
                            let response = ui.selectable_label(is_selected, card.list_label());
                            if response.clicked() && !card.id.is_empty() {
                                self.selected = Some(card.id.clone());
                                self.reveal_pending = true;
                            }
                        }
                    });
                for issue in &scene.issues {
                    ui.colored_label(ui.visuals().warn_fg_color, issue.as_str());
                }
                for card in &scene.cards {
                    for issue in &card.issues {
                        ui.colored_label(
                            ui.visuals().warn_fg_color,
                            format!("{}: {issue}", card.title),
                        );
                    }
                }
            });
    }

    fn show_surface(
        &mut self,
        ui: &mut egui::Ui,
        scene: &CanvasScene,
        actions: &mut Vec<CanvasViewAction>,
    ) {
        let available = ui.available_size();
        let size = egui::vec2(available.x.max(50.0), available.y.max(120.0));
        let (rect, response) = ui.allocate_exact_size(size, egui::Sense::click_and_drag());
        self.last_size = rect.size();
        if self.fit_pending {
            self.fit_pending = false;
            if let Some(bounds) = scene.bounds() {
                self.transform = ViewTransform::fit(bounds, rect.size(), FIT_MARGIN);
            }
        }
        if self.reveal_pending {
            self.reveal_pending = false;
            let target = self
                .selected
                .as_deref()
                .and_then(|id| scene.card_by_id(id))
                .map(|card| card.rect);
            if let Some(world_rect) = target {
                self.transform.center_on(world_rect, rect.size());
            }
        }

        if response.dragged() {
            self.transform.pan += response.drag_delta();
        }
        if response.hovered() {
            let (zoom_delta, scroll) =
                ui.input(|input| (input.zoom_delta(), input.smooth_scroll_delta));
            if (zoom_delta - 1.0).abs() > f32::EPSILON
                && let Some(pointer) = ui.input(|input| input.pointer.hover_pos())
            {
                self.transform
                    .zoom_at((pointer - rect.min).to_pos2(), zoom_delta);
            }
            self.transform.pan += scroll;
        }
        if response.clicked()
            && let Some(pos) = response.interact_pointer_pos()
        {
            let world = self.transform.to_world((pos - rect.min).to_pos2());
            let hit = scene.hit_test(world);
            self.selected = hit
                .and_then(|index| scene.cards.get(index))
                .filter(|card| !card.id.is_empty())
                .map(|card| card.id.clone());
        }
        if response.double_clicked()
            && self.editing.is_none()
            && let Some(id) = self.selected.clone()
        {
            self.begin_edit(scene, &id);
        }

        let painter = ui.painter_at(rect);
        let transform = self.transform;
        let to_screen = |local: egui::Pos2| rect.min + local.to_vec2();
        painter.rect_filled(rect, 0.0, ui.visuals().extreme_bg_color);
        let text_color = ui.visuals().text_color();
        let accent = ui.visuals().selection.stroke.color;

        for edge in &scene.edges {
            let from = to_screen(transform.to_local(edge.from));
            let to = to_screen(transform.to_local(edge.to));
            let color = edge.color.unwrap_or(text_color.gamma_multiply(0.7));
            let stroke = egui::Stroke::new((1.5 * transform.zoom).clamp(0.5, 4.0), color);
            painter.line_segment([from, to], stroke);
            let head = (10.0 * transform.zoom).clamp(4.0, 24.0);
            if edge.arrow_to {
                for barb in arrow_head(to, from, head) {
                    painter.line_segment([to, barb], stroke);
                }
            }
            if edge.arrow_from {
                for barb in arrow_head(from, to, head) {
                    painter.line_segment([from, barb], stroke);
                }
            }
            if let Some(label) = &edge.label
                && transform.zoom >= 0.3
            {
                painter.text(
                    from + (to - from) * 0.5,
                    egui::Align2::CENTER_CENTER,
                    label.as_str(),
                    egui::FontId::proportional((12.0 * transform.zoom).clamp(8.0, 32.0)),
                    text_color,
                );
            }
        }

        let editing_id = self.editing.as_ref().map(|edit| edit.node_id.clone());
        let mut edit_rect = None;
        for card in &scene.cards {
            let local = transform.rect_to_local(card.rect);
            let screen = egui::Rect::from_min_max(to_screen(local.min), to_screen(local.max));
            if !screen.intersects(rect) {
                continue;
            }
            let accent_color = card.color.unwrap_or(text_color.gamma_multiply(0.5));
            let fill = if card.kind == CardKind::Group {
                accent_color.gamma_multiply(0.12)
            } else {
                ui.visuals()
                    .faint_bg_color
                    .blend(accent_color.gamma_multiply(0.15))
            };
            painter.rect_filled(screen, 4.0, fill);
            let is_selected =
                !card.id.is_empty() && self.selected.as_deref() == Some(card.id.as_str());
            let border = if !card.issues.is_empty() {
                egui::Stroke::new(2.0, ui.visuals().warn_fg_color)
            } else if is_selected {
                egui::Stroke::new(3.0, accent)
            } else {
                egui::Stroke::new(1.5, accent_color)
            };
            painter.rect_stroke(screen, 4.0, border, egui::StrokeKind::Inside);
            if editing_id.as_deref() == Some(card.id.as_str()) {
                edit_rect = Some(screen);
                continue;
            }
            if transform.zoom < 0.3 {
                continue;
            }
            let clipped = painter.with_clip_rect(screen.intersect(rect));
            let label = match card.kind {
                CardKind::Link | CardKind::File | CardKind::Group | CardKind::Text => {
                    card.body.clone()
                }
                CardKind::Unsupported => "Unsupported card".to_owned(),
            };
            let font = egui::FontId::proportional((14.0 * transform.zoom).clamp(6.0, 40.0));
            let pad = 6.0 * transform.zoom;
            let galley = clipped.layout(
                label,
                font,
                text_color,
                (screen.width() - 2.0 * pad).max(1.0),
            );
            clipped.galley(screen.min + egui::vec2(pad, pad), galley, text_color);
        }

        if let (Some(screen), Some(edit)) = (edit_rect, self.editing.as_mut()) {
            ui.put(
                screen.shrink(2.0),
                egui::TextEdit::multiline(&mut edit.text)
                    .id_salt("openobsidian-canvas-card-editor")
                    .desired_width(screen.width() - 4.0),
            );
        }
        if self.editing.is_some() {
            let (save, cancel) = ui.input(|input| {
                (
                    input.modifiers.command && input.key_pressed(egui::Key::Enter),
                    input.key_pressed(egui::Key::Escape),
                )
            });
            if cancel {
                self.editing = None;
            } else if save {
                self.commit_edit(actions);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(left: f32, right: f32) -> bool {
        (left - right).abs() < 1e-3
    }

    fn scene(json: &str) -> CanvasScene {
        CanvasScene::from_source(json.as_bytes()).expect("canvas parses")
    }

    const SAMPLE: &str = r##"{
        "nodes": [
            {"id":"g","type":"group","x":-50,"y":-50,"width":600,"height":400,"label":"Area"},
            {"id":"a","type":"text","x":0,"y":0,"width":200,"height":100,"text":"# Idea\nbody","color":"4"},
            {"id":"b","type":"file","x":300,"y":0,"width":200,"height":100,"file":"Notes/B.md"},
            {"id":"c","type":"link","x":0,"y":200,"width":200,"height":100,"url":"https://example.com"}
        ],
        "edges": [
            {"id":"e1","fromNode":"a","toNode":"b","label":"rel"},
            {"id":"e2","fromNode":"a","toNode":"missing"}
        ]
    }"##;

    #[test]
    fn transform_round_trips_and_zooms_about_cursor() {
        let mut transform = ViewTransform {
            pan: egui::vec2(30.0, -20.0),
            zoom: 2.0,
        };
        let world = egui::pos2(10.0, 15.0);
        let local = transform.to_local(world);
        assert!(close(local.x, 50.0) && close(local.y, 10.0));
        let back = transform.to_world(local);
        assert!(close(back.x, world.x) && close(back.y, world.y));
        let cursor = egui::pos2(120.0, 80.0);
        let before = transform.to_world(cursor);
        transform.zoom_at(cursor, 1.5);
        let after = transform.to_world(cursor);
        assert!(close(transform.zoom, 3.0));
        assert!(close(before.x, after.x) && close(before.y, after.y));
        transform.zoom_at(cursor, 1000.0);
        assert!(close(transform.zoom, MAX_ZOOM));
        transform.zoom_at(cursor, 1e-9);
        assert!(close(transform.zoom, MIN_ZOOM));
    }

    #[test]
    fn fit_centers_bounds_in_viewport() {
        let bounds = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(1000.0, 500.0));
        let viewport = egui::vec2(500.0, 400.0);
        let transform = ViewTransform::fit(bounds, viewport, 0.0);
        assert!(close(transform.zoom, 0.5));
        let center = transform.to_local(bounds.center());
        assert!(close(center.x, 250.0) && close(center.y, 200.0));
        let mut moved = ViewTransform::default();
        moved.center_on(bounds, viewport);
        let center = moved.to_local(bounds.center());
        assert!(close(center.x, 250.0) && close(center.y, 200.0));
    }

    #[test]
    fn projection_orders_groups_first_and_keeps_issues() {
        let scene = scene(SAMPLE);
        assert_eq!(scene.cards.len(), 4);
        assert_eq!(scene.cards[0].kind, CardKind::Group);
        assert_eq!(scene.cards[1].id, "a");
        assert_eq!(scene.cards[2].target.as_deref(), Some("Notes/B.md"));
        assert_eq!(
            scene.cards[3].target.as_deref(),
            Some("https://example.com")
        );
        assert_eq!(scene.cards[1].color, parse_color("4"));
        assert_eq!(scene.edges.len(), 1);
        assert_eq!(scene.edges[0].label.as_deref(), Some("rel"));
        assert!(scene.edges[0].arrow_to && !scene.edges[0].arrow_from);
        assert_eq!(scene.issues.len(), 1);
        assert!(scene.issues[0].contains("missing"));
        let bounds = scene.bounds().expect("bounds");
        assert!(close(bounds.min.x, -50.0) && close(bounds.max.x, 550.0));
    }

    #[test]
    fn edge_anchors_follow_relative_position() {
        let scene = scene(SAMPLE);
        let edge = &scene.edges[0];
        assert!(close(edge.from.x, 200.0) && close(edge.from.y, 50.0));
        assert!(close(edge.to.x, 300.0) && close(edge.to.y, 50.0));
        let a = egui::Rect::from_min_size(egui::pos2(0.0, 0.0), egui::vec2(10.0, 10.0));
        let below = egui::Rect::from_min_size(egui::pos2(0.0, 100.0), egui::vec2(10.0, 10.0));
        assert_eq!(auto_sides(a, below), (Side::Bottom, Side::Top));
        assert_eq!(auto_sides(below, a), (Side::Top, Side::Bottom));
        let left = anchor(a, Side::Left);
        assert!(close(left.x, 0.0) && close(left.y, 5.0));
    }

    #[test]
    fn hit_testing_prefers_cards_over_groups() {
        let scene = scene(SAMPLE);
        let on_card = scene.hit_test(egui::pos2(10.0, 10.0)).expect("card hit");
        assert_eq!(scene.cards[on_card].id, "a");
        let on_group = scene.hit_test(egui::pos2(-20.0, -20.0)).expect("group hit");
        assert_eq!(scene.cards[on_group].id, "g");
        assert_eq!(scene.hit_test(egui::pos2(5000.0, 5000.0)), None);
    }

    #[test]
    fn malformed_nodes_are_reported_not_dropped() {
        let scene = scene(
            r#"{"nodes":[{"id":"x","type":"text","x":"nope","y":1,"width":-5,"height":10},
                {"type":"weird"}],"edges":[{"fromNode":1}]}"#,
        );
        assert_eq!(scene.cards.len(), 2);
        assert!(
            scene.cards[0]
                .issues
                .iter()
                .any(|issue| issue.starts_with("x is malformed"))
        );
        assert!(
            scene.cards[0]
                .issues
                .iter()
                .any(|issue| issue.contains("width"))
        );
        assert!(close(scene.cards[0].rect.width(), DEFAULT_CARD_WIDTH));
        assert_eq!(scene.cards[1].kind, CardKind::Unsupported);
        assert!(scene.cards[1].id.is_empty());
        assert!(scene.card_by_id("").is_none());
        assert_eq!(scene.issues.len(), 1);
        assert!(scene.issue_count() >= 5);
        assert!(CanvasScene::from_source(b"[1]").is_err());
    }

    #[test]
    fn colors_previews_and_note_names() {
        assert_eq!(
            parse_color("#102030"),
            Some(egui::Color32::from_rgb(0x10, 0x20, 0x30))
        );
        assert_eq!(parse_color("#12"), None);
        assert_eq!(parse_color("#12345é"), None);
        assert_eq!(parse_color("red"), None);
        assert_eq!(preview("\n  first line  \nsecond", 40), "first line");
        assert_eq!(preview("abcdef", 3), "abc...");
        assert_eq!(suggested_note_path("# My: idea?\nmore"), "My idea.md");
        assert_eq!(suggested_note_path("  \n"), "Untitled.md");
        assert_eq!(suggested_note_path("a/b\\c"), "abc.md");
    }

    #[test]
    fn arrow_head_barbs_are_behind_tip() {
        let [first, second] = arrow_head(egui::pos2(10.0, 0.0), egui::pos2(0.0, 0.0), 4.0);
        assert!(close(first.x, 6.0) && close(second.x, 6.0));
        assert!(close(first.y, -second.y) && close(first.y.abs(), 2.0));
        let tip = egui::pos2(1.0, 1.0);
        assert_eq!(arrow_head(tip, tip, 4.0), [tip, tip]);
    }

    #[test]
    fn card_list_navigation_wraps() {
        assert_eq!(cycle_selection(0, None, true), None);
        assert_eq!(cycle_selection(3, None, true), Some(0));
        assert_eq!(cycle_selection(3, None, false), Some(2));
        assert_eq!(cycle_selection(3, Some(2), true), Some(0));
        assert_eq!(cycle_selection(3, Some(0), false), Some(2));
        assert_eq!(nav_step(NavKey::Down), Some(true));
        assert_eq!(nav_step(NavKey::Left), Some(false));
        assert_eq!(nav_step(NavKey::Enter), None);
    }

    #[test]
    fn edit_flow_produces_intent_only_for_text_cards() {
        let scene = scene(SAMPLE);
        let mut view = CanvasView::new();
        assert!(!view.begin_edit(&scene, "b"));
        assert!(!view.begin_edit(&scene, "nope"));
        assert!(view.begin_edit(&scene, "a"));
        assert!(view.is_editing());
        assert_eq!(view.selected(), Some("a"));
        if let Some(edit) = view.editing.as_mut() {
            edit.text.push_str("\nmore");
        }
        let mut actions = Vec::new();
        view.commit_edit(&mut actions);
        assert_eq!(
            actions,
            [CanvasViewAction::EditText {
                node_id: "a".to_owned(),
                text: "# Idea\nbody\nmore".to_owned()
            }]
        );
        assert!(!view.is_editing());
        view.begin_edit(&scene, "a");
        view.cancel_edit();
        assert!(!view.is_editing());
    }
}
