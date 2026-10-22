//! Keyboard-driven pickers: the quick switcher (Ctrl/Cmd+O) and the command palette
//! (Ctrl/Cmd+P), built on one shared [`Palette`] state machine.

use super::NavKey;
use super::backend::WorkspaceBackend;
use super::commands::{CommandContext, CommandRegistry};
use super::tabs::{set_accessible_label, tab_title};
use eframe::egui;

/// Maximum number of quick switcher rows.
pub const QUICK_SWITCHER_LIMIT: usize = 50;

/// What a key press did to a [`Palette`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaletteOutcome {
    /// Nothing changed.
    Idle,
    /// The selection moved.
    Moved,
    /// The user confirmed. `Some(index)` is the chosen row; `None` means there were no rows.
    /// The palette is closed afterwards.
    Accept(Option<usize>),
    /// The user dismissed the palette, which is now closed.
    Cancel,
}

/// Open/closed state, query text and selected row of a picker.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Palette {
    open: bool,
    query: String,
    selected: usize,
    focus_pending: bool,
    scroll_pending: bool,
}

impl Palette {
    /// Opens the palette with an empty query and asks for keyboard focus.
    pub fn open(&mut self) {
        self.open = true;
        self.query.clear();
        self.selected = 0;
        self.focus_pending = true;
        self.scroll_pending = false;
    }

    pub fn close(&mut self) {
        self.open = false;
        self.focus_pending = false;
        self.scroll_pending = false;
    }

    pub fn is_open(&self) -> bool {
        self.open
    }

    pub fn query(&self) -> &str {
        &self.query
    }

    /// Replaces the query; the selection returns to the first row when the text changed.
    pub fn set_query(&mut self, query: impl Into<String>) {
        let query = query.into();
        if query != self.query {
            self.query = query;
            self.selected = 0;
        }
    }

    pub fn selected(&self) -> usize {
        self.selected
    }

    /// Keeps the selection inside `0..item_count`.
    pub fn clamp_selection(&mut self, item_count: usize) {
        self.selected = self.selected.min(item_count.saturating_sub(1));
    }

    /// Applies one navigation key. Up and Down wrap around; Enter accepts; Escape cancels.
    pub fn handle_key(&mut self, key: NavKey, item_count: usize) -> PaletteOutcome {
        if !self.open {
            return PaletteOutcome::Idle;
        }
        self.clamp_selection(item_count);
        let moved_to = match key {
            NavKey::Down if item_count > 0 => Some((self.selected + 1) % item_count),
            NavKey::Up if item_count > 0 => Some((self.selected + item_count - 1) % item_count),
            NavKey::Home if item_count > 0 => Some(0),
            NavKey::End if item_count > 0 => Some(item_count - 1),
            NavKey::Enter => {
                let chosen = (item_count > 0).then_some(self.selected);
                self.close();
                return PaletteOutcome::Accept(chosen);
            }
            NavKey::Escape => {
                self.close();
                return PaletteOutcome::Cancel;
            }
            _ => None,
        };
        match moved_to {
            Some(index) if index != self.selected => {
                self.selected = index;
                self.scroll_pending = true;
                PaletteOutcome::Moved
            }
            _ => PaletteOutcome::Idle,
        }
    }
}

/// What the quick switcher asks the workspace to do.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum QuickSwitcherOutcome {
    /// Open an existing note.
    Open(String),
    /// Create a note at this path (no match, or Shift+Enter).
    Create(String),
}

/// Quick switcher state with results cached per query and backend revision.
#[derive(Clone, Debug, Default)]
pub struct QuickSwitcher {
    pub palette: Palette,
    results: Vec<String>,
    results_key: Option<(String, u64)>,
}

impl QuickSwitcher {
    /// Recomputes results when the query or the backend revision changed.
    pub fn refresh(&mut self, backend: &dyn WorkspaceBackend) {
        let key = (self.palette.query().to_owned(), backend.revision());
        if self.results_key.as_ref() != Some(&key) {
            self.results = backend.quick_switch(&key.0, QUICK_SWITCHER_LIMIT);
            self.results_key = Some(key);
            self.palette.clamp_selection(self.results.len());
        }
    }

    pub fn results(&self) -> &[String] {
        &self.results
    }

    /// The path a new note would get from the current query, if any.
    pub fn create_path(&self) -> Option<String> {
        let name = self.palette.query().trim().trim_matches('/');
        if name.is_empty() {
            None
        } else if name.to_lowercase().ends_with(".md") {
            Some(name.to_owned())
        } else {
            Some(format!("{name}.md"))
        }
    }

    /// Applies a navigation key after refreshing the results.
    pub fn handle_key(
        &mut self,
        key: NavKey,
        backend: &dyn WorkspaceBackend,
    ) -> Option<QuickSwitcherOutcome> {
        self.refresh(backend);
        let create_path = self.create_path();
        match self.palette.handle_key(key, self.results.len()) {
            PaletteOutcome::Accept(Some(index)) => self
                .results
                .get(index)
                .cloned()
                .map(QuickSwitcherOutcome::Open),
            PaletteOutcome::Accept(None) => create_path.map(QuickSwitcherOutcome::Create),
            PaletteOutcome::Idle | PaletteOutcome::Moved | PaletteOutcome::Cancel => None,
        }
    }
}

/// Command palette state.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct CommandPalette {
    pub palette: Palette,
}

impl CommandPalette {
    /// Applies a navigation key and returns the id of the command to run, if any.
    pub fn handle_key(
        &mut self,
        key: NavKey,
        registry: &CommandRegistry,
        context: &CommandContext,
    ) -> Option<String> {
        let ranked = registry.rank(self.palette.query(), context);
        match self.palette.handle_key(key, ranked.len()) {
            PaletteOutcome::Accept(Some(index)) => {
                ranked.get(index).map(|command| command.id.clone())
            }
            _ => None,
        }
    }
}

struct PaletteItem {
    text: String,
    detail: String,
    label: String,
}

struct PaletteSpec {
    id: &'static str,
    title: &'static str,
    query_label: &'static str,
    hint: &'static str,
    empty_text: String,
    extra_button: Option<(String, String)>,
}

enum PaletteUiOutcome {
    Accept { index: Option<usize>, shift: bool },
    Extra,
    Cancel,
}

/// Renders the quick switcher as a modal while it is open.
///
/// Up/Down move the selection, Enter opens the selected note (or creates the typed one when
/// nothing matches), Shift+Enter always creates, Escape or a click outside dismisses.
pub fn show_quick_switcher(
    ctx: &egui::Context,
    switcher: &mut QuickSwitcher,
    backend: &dyn WorkspaceBackend,
) -> Option<QuickSwitcherOutcome> {
    if !switcher.palette.is_open() {
        return None;
    }
    switcher.refresh(backend);
    let create_path = switcher.create_path();
    let items: Vec<PaletteItem> = switcher
        .results()
        .iter()
        .map(|path| PaletteItem {
            text: tab_title(path).to_owned(),
            detail: path.clone(),
            label: format!("Switch to {path}"),
        })
        .collect();
    let empty_text = match &create_path {
        Some(path) => format!("No matching notes. Press Enter to create {path}."),
        None => "No notes yet. Type a name to create one.".to_owned(),
    };
    let spec = PaletteSpec {
        id: "openobsidian-quick-switcher",
        title: "Quick switcher",
        query_label: "Quick switcher query",
        hint: "Find or create a note…",
        empty_text,
        extra_button: create_path
            .as_ref()
            .map(|path| (format!("Create {path}"), format!("Create note {path}"))),
    };
    let outcome = show_palette_modal(ctx, &spec, &mut switcher.palette, &items)?;
    match outcome {
        PaletteUiOutcome::Accept { index, shift } => {
            if shift {
                return create_path.map(QuickSwitcherOutcome::Create);
            }
            match index.and_then(|index| switcher.results().get(index)) {
                Some(path) => Some(QuickSwitcherOutcome::Open(path.clone())),
                None if index.is_none() => create_path.map(QuickSwitcherOutcome::Create),
                None => None,
            }
        }
        PaletteUiOutcome::Extra => create_path.map(QuickSwitcherOutcome::Create),
        PaletteUiOutcome::Cancel => None,
    }
}

/// Renders the command palette as a modal while it is open and returns the id of the command
/// the user chose.
pub fn show_command_palette(
    ctx: &egui::Context,
    command_palette: &mut CommandPalette,
    registry: &CommandRegistry,
    context: &CommandContext,
) -> Option<String> {
    if !command_palette.palette.is_open() {
        return None;
    }
    let ranked = registry.rank(command_palette.palette.query(), context);
    let items: Vec<PaletteItem> = ranked
        .iter()
        .map(|command| PaletteItem {
            text: command.title.clone(),
            detail: command
                .shortcut
                .map(|shortcut| ctx.format_shortcut(&shortcut))
                .unwrap_or_default(),
            label: format!("Command {}", command.title),
        })
        .collect();
    let spec = PaletteSpec {
        id: "openobsidian-command-palette",
        title: "Command palette",
        query_label: "Command palette query",
        hint: "Type a command…",
        empty_text: "No matching commands.".to_owned(),
        extra_button: None,
    };
    match show_palette_modal(ctx, &spec, &mut command_palette.palette, &items)? {
        PaletteUiOutcome::Accept {
            index: Some(index), ..
        } => ranked.get(index).map(|command| command.id.clone()),
        PaletteUiOutcome::Accept { index: None, .. }
        | PaletteUiOutcome::Extra
        | PaletteUiOutcome::Cancel => None,
    }
}

fn read_palette_keys(ctx: &egui::Context) -> (Vec<NavKey>, bool) {
    ctx.input_mut(|input| {
        let shift = input.modifiers.shift;
        let mut keys = Vec::new();
        for (key, nav) in [
            (egui::Key::ArrowDown, NavKey::Down),
            (egui::Key::ArrowUp, NavKey::Up),
            (egui::Key::Enter, NavKey::Enter),
            (egui::Key::Escape, NavKey::Escape),
        ] {
            if input.consume_key(egui::Modifiers::NONE, key) {
                keys.push(nav);
            }
        }
        (keys, shift)
    })
}

fn show_palette_modal(
    ctx: &egui::Context,
    spec: &PaletteSpec,
    palette: &mut Palette,
    items: &[PaletteItem],
) -> Option<PaletteUiOutcome> {
    let (keys, shift) = read_palette_keys(ctx);
    for key in keys {
        match palette.handle_key(key, items.len()) {
            PaletteOutcome::Accept(index) => {
                return Some(PaletteUiOutcome::Accept { index, shift });
            }
            PaletteOutcome::Cancel => return Some(PaletteUiOutcome::Cancel),
            PaletteOutcome::Idle | PaletteOutcome::Moved => {}
        }
    }
    let modal = egui::Modal::new(egui::Id::new(spec.id))
        .show(ctx, |ui| show_palette_contents(ui, spec, palette, items));
    let should_close = modal.should_close();
    if let Some(outcome) = modal.inner {
        palette.close();
        return Some(outcome);
    }
    if should_close {
        palette.close();
        return Some(PaletteUiOutcome::Cancel);
    }
    None
}

fn show_palette_contents(
    ui: &mut egui::Ui,
    spec: &PaletteSpec,
    palette: &mut Palette,
    items: &[PaletteItem],
) -> Option<PaletteUiOutcome> {
    let mut outcome = None;
    ui.set_width(480.0);
    ui.heading(spec.title);
    let query_label = ui.label(spec.query_label);
    let mut query = palette.query().to_owned();
    let response = ui
        .add(
            egui::TextEdit::singleline(&mut query)
                .id_salt((spec.id, "query"))
                .hint_text(spec.hint)
                .desired_width(f32::INFINITY)
                .return_key(None::<egui::KeyboardShortcut>),
        )
        .labelled_by(query_label.id);
    if palette.focus_pending {
        if response.has_focus() {
            palette.focus_pending = false;
        } else {
            response.request_focus();
        }
    }
    if response.changed() {
        palette.set_query(query);
        ui.ctx().request_repaint();
    }
    ui.separator();
    if items.is_empty() {
        ui.weak(spec.empty_text.as_str());
    }
    if let Some((text, label)) = &spec.extra_button {
        let create = ui.button(text.as_str());
        set_accessible_label(ui, &create, label);
        if create.clicked() {
            outcome = Some(PaletteUiOutcome::Extra);
        }
    }
    let scroll_pending = std::mem::take(&mut palette.scroll_pending);
    egui::ScrollArea::vertical()
        .id_salt((spec.id, "results"))
        .max_height(360.0)
        .auto_shrink([false, true])
        .show(ui, |ui| {
            for (index, item) in items.iter().enumerate() {
                let selected = index == palette.selected();
                let row = ui.horizontal(|ui| {
                    let response = ui.selectable_label(selected, item.text.as_str());
                    if !item.detail.is_empty() {
                        ui.weak(item.detail.as_str());
                    }
                    response
                });
                let response = row.inner;
                set_accessible_label(ui, &response, &item.label);
                if selected && scroll_pending {
                    response.scroll_to_me(None);
                }
                if response.clicked() {
                    outcome = Some(PaletteUiOutcome::Accept {
                        index: Some(index),
                        shift: false,
                    });
                }
            }
        });
    ui.weak("↑/↓ to navigate · Enter to choose · Esc to dismiss");
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::backend::InMemoryBackend;
    use crate::workspace::commands::ids;

    #[test]
    fn palette_navigation_wraps_and_closes_on_accept_or_cancel() {
        let mut palette = Palette::default();
        assert_eq!(palette.handle_key(NavKey::Down, 3), PaletteOutcome::Idle);
        palette.open();
        assert!(palette.is_open());
        assert_eq!(palette.handle_key(NavKey::Up, 3), PaletteOutcome::Moved);
        assert_eq!(palette.selected(), 2);
        assert_eq!(palette.handle_key(NavKey::Down, 3), PaletteOutcome::Moved);
        assert_eq!(palette.selected(), 0);
        assert_eq!(palette.handle_key(NavKey::End, 3), PaletteOutcome::Moved);
        assert_eq!(palette.handle_key(NavKey::End, 3), PaletteOutcome::Idle);
        assert_eq!(palette.handle_key(NavKey::Left, 3), PaletteOutcome::Idle);
        assert_eq!(
            palette.handle_key(NavKey::Enter, 3),
            PaletteOutcome::Accept(Some(2))
        );
        assert!(!palette.is_open());

        palette.open();
        assert_eq!(palette.selected(), 0);
        assert_eq!(palette.handle_key(NavKey::Down, 0), PaletteOutcome::Idle);
        assert_eq!(
            palette.handle_key(NavKey::Enter, 0),
            PaletteOutcome::Accept(None)
        );
        palette.open();
        assert_eq!(
            palette.handle_key(NavKey::Escape, 5),
            PaletteOutcome::Cancel
        );
        assert!(!palette.is_open());
    }

    #[test]
    fn palette_query_changes_reset_and_clamp_selection() {
        let mut palette = Palette::default();
        palette.open();
        palette.handle_key(NavKey::End, 4);
        palette.set_query("abc");
        assert_eq!(palette.selected(), 0);
        palette.handle_key(NavKey::End, 4);
        palette.set_query("abc");
        assert_eq!(palette.selected(), 3);
        palette.clamp_selection(2);
        assert_eq!(palette.selected(), 1);
        assert_eq!(
            palette.handle_key(NavKey::Enter, 1),
            PaletteOutcome::Accept(Some(0))
        );
    }

    #[test]
    fn quick_switcher_opens_matches_and_creates_missing_notes() {
        let backend = InMemoryBackend::new()
            .with_note("Projects/Alpha.md", "")
            .with_note("Beta.md", "");
        let mut switcher = QuickSwitcher::default();
        switcher.palette.open();
        switcher.palette.set_query("alp");
        switcher.refresh(&backend);
        assert_eq!(switcher.results(), ["Projects/Alpha.md"]);
        assert_eq!(
            switcher.handle_key(NavKey::Enter, &backend),
            Some(QuickSwitcherOutcome::Open("Projects/Alpha.md".to_owned()))
        );

        switcher.palette.open();
        switcher.palette.set_query("Ideas/New idea");
        assert_eq!(
            switcher.handle_key(NavKey::Enter, &backend),
            Some(QuickSwitcherOutcome::Create("Ideas/New idea.md".to_owned()))
        );

        switcher.palette.open();
        assert_eq!(switcher.create_path(), None);
        assert_eq!(switcher.handle_key(NavKey::Escape, &backend), None);
        assert!(!switcher.palette.is_open());
    }

    #[test]
    fn command_palette_returns_ranked_command_id() {
        let registry = CommandRegistry::with_defaults();
        let context = CommandContext::default();
        let mut command_palette = CommandPalette::default();
        command_palette.palette.open();
        command_palette.palette.set_query("quick switcher");
        assert_eq!(
            command_palette.handle_key(NavKey::Enter, &registry, &context),
            Some(ids::QUICK_SWITCHER.to_owned())
        );
        command_palette.palette.open();
        command_palette.palette.set_query("zzzz");
        assert_eq!(
            command_palette.handle_key(NavKey::Enter, &registry, &context),
            None
        );
    }
}
