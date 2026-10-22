//! Obsidian-style workspace: file explorer, tabs, quick switcher, command palette and side panes.
//!
//! The workspace is pure UI state plus egui rendering. It reads vault data only through
//! [`WorkspaceBackend`] and never touches the filesystem: everything that must change on disk
//! (or in the host's editor buffers) is returned from [`Workspace::show`] as a
//! [`WorkspaceAction`] for the host to execute.
//!
//! Host contract, per frame: call [`Workspace::show_with_editor`] (or [`Workspace::show`]) with a
//! backend, then execute the returned actions. After creating a note for
//! [`WorkspaceAction::CreateNote`] or [`WorkspaceAction::CreateNoteAt`], call
//! [`Workspace::open_note`] with the final path. After renames or deletions performed outside the
//! workspace, call [`Workspace::rename_path`] or [`Workspace::remove_path`].

pub mod backend;
pub mod commands;
pub mod explorer;
pub mod fuzzy;
pub mod host;
pub mod palette;
pub mod panes;
pub mod tabs;

pub use backend::{BacklinkRow, InMemoryBackend, LinkRow, SearchRow, WorkspaceBackend};
pub use commands::{Command, CommandContext, CommandRegistry, ids};
pub use explorer::{ExplorerNodeKind, ExplorerOutcome, ExplorerRow, ExplorerTree, show_explorer};
pub use host::WorkspaceHost;
pub use palette::{
    CommandPalette, Palette, PaletteOutcome, QuickSwitcher, QuickSwitcherOutcome,
    show_command_palette, show_quick_switcher,
};
pub use panes::{SidePane, SidePaneTab, show_side_pane};
pub use tabs::{Tab, TabSet, TabSetParseError, show_tab_bar};

use eframe::egui;

/// Navigation keys understood by the workspace state machines, independent of egui.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum NavKey {
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    Enter,
    Escape,
}

/// Work the host must perform on behalf of the workspace.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WorkspaceAction {
    /// The active tab now shows this note: load it into the editor (reusing a cached buffer
    /// when one exists). Emitted whenever the active note changes, at most once per frame.
    OpenNote(String),
    /// The tab for this note was closed; save or discard its editor buffer.
    TabClosed(String),
    /// Create a new untitled note in this folder (`""` is the vault root). The host picks a
    /// unique file name and then calls [`Workspace::open_note`].
    CreateNote { folder: String },
    /// Create a note at exactly this path, then call [`Workspace::open_note`].
    CreateNoteAt(String),
    /// Move this note to the vault trash, then call [`Workspace::remove_path`].
    TrashNote(String),
    /// Save the editor buffer of this note.
    SaveNote(String),
    /// A registered command the workspace does not implement itself.
    RunCommand(String),
}

/// All workspace state. Fields are public so hosts can persist or tweak them directly.
#[derive(Clone, Debug)]
pub struct Workspace {
    pub explorer: ExplorerTree,
    pub tabs: TabSet,
    pub commands: CommandRegistry,
    pub quick_switcher: QuickSwitcher,
    pub command_palette: CommandPalette,
    pub side_pane: SidePane,
    pub explorer_visible: bool,
    pub side_pane_visible: bool,
    paths_revision: Option<u64>,
    reported_active: Option<String>,
    pending_reveal: Option<String>,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            explorer: ExplorerTree::default(),
            tabs: TabSet::default(),
            commands: CommandRegistry::with_defaults(),
            quick_switcher: QuickSwitcher::default(),
            command_palette: CommandPalette::default(),
            side_pane: SidePane::default(),
            explorer_visible: true,
            side_pane_visible: true,
            paths_revision: None,
            reported_active: None,
            pending_reveal: None,
        }
    }
}

impl Workspace {
    pub fn new() -> Self {
        Self::default()
    }

    /// Shows `path` in the active tab and selects it in the explorer.
    pub fn open_note(&mut self, path: &str) {
        self.tabs.open_in_active(path);
        self.paths_revision = None;
        self.pending_reveal = Some(path.to_owned());
    }

    /// Updates tabs and the explorer after the host renamed a file or folder.
    pub fn rename_path(&mut self, old: &str, new: &str) {
        self.tabs.rename_path(old, new);
        self.paths_revision = None;
    }

    /// Updates tabs and the explorer after the host deleted a file.
    pub fn remove_path(&mut self, path: &str) {
        self.tabs.remove_path(path);
        self.paths_revision = None;
    }

    /// Forces the explorer to re-read [`WorkspaceBackend::list_paths`] on the next frame, for
    /// backends that do not bump [`WorkspaceBackend::revision`].
    pub fn invalidate_paths(&mut self) {
        self.paths_revision = None;
    }

    /// Facts used by command enabled-predicates.
    pub fn command_context(&self) -> CommandContext {
        let active = self
            .tabs
            .active_index()
            .and_then(|index| self.tabs.tabs().get(index));
        CommandContext {
            has_active_note: active.is_some(),
            active_tab_pinned: active.is_some_and(|tab| tab.pinned),
            tab_count: self.tabs.len(),
            can_go_back: self.tabs.can_go_back(),
            can_go_forward: self.tabs.can_go_forward(),
        }
    }

    /// Runs a command by id. Disabled commands do nothing; ids the workspace does not implement
    /// are returned as [`WorkspaceAction::RunCommand`].
    pub fn execute(&mut self, id: &str) -> Vec<WorkspaceAction> {
        let context = self.command_context();
        let disabled = self
            .commands
            .get(id)
            .is_some_and(|command| !command.is_enabled(&context));
        if disabled {
            return Vec::new();
        }
        let active = self.tabs.active_path().map(str::to_owned);
        let mut actions = Vec::new();
        match id {
            ids::QUICK_SWITCHER => {
                self.command_palette.palette.close();
                self.quick_switcher.palette.open();
            }
            ids::COMMAND_PALETTE => {
                self.quick_switcher.palette.close();
                self.command_palette.palette.open();
            }
            ids::NEW_NOTE => actions.push(WorkspaceAction::CreateNote {
                folder: self.explorer.target_folder(),
            }),
            ids::SAVE_NOTE => actions.extend(active.map(WorkspaceAction::SaveNote)),
            ids::DELETE_NOTE => actions.extend(active.map(WorkspaceAction::TrashNote)),
            ids::CLOSE_TAB => {
                let closed = self.tabs.close_active();
                actions.extend(closed.map(|tab| WorkspaceAction::TabClosed(tab.path)));
            }
            ids::CLOSE_OTHER_TABS => {
                if let Some(index) = self.tabs.active_index() {
                    let closed = self.tabs.close_others(index);
                    actions.extend(
                        closed
                            .into_iter()
                            .map(|tab| WorkspaceAction::TabClosed(tab.path)),
                    );
                }
            }
            ids::NEXT_TAB => {
                self.tabs.activate_next();
            }
            ids::PREVIOUS_TAB => {
                self.tabs.activate_previous();
            }
            ids::TOGGLE_PIN => {
                if let Some(index) = self.tabs.active_index() {
                    self.tabs.toggle_pinned(index);
                }
            }
            ids::NAVIGATE_BACK => {
                self.tabs.go_back();
            }
            ids::NAVIGATE_FORWARD => {
                self.tabs.go_forward();
            }
            ids::REVEAL_IN_EXPLORER => {
                if let Some(path) = &active {
                    self.explorer.reveal(path);
                }
                self.explorer_visible = true;
            }
            ids::TOGGLE_EXPLORER => self.explorer_visible = !self.explorer_visible,
            ids::TOGGLE_SIDE_PANE => self.side_pane_visible = !self.side_pane_visible,
            ids::SHOW_BACKLINKS => self.show_side_tab(SidePaneTab::Backlinks),
            ids::SHOW_OUTGOING_LINKS => self.show_side_tab(SidePaneTab::Outgoing),
            ids::SHOW_TAGS => self.show_side_tab(SidePaneTab::Tags),
            ids::SEARCH_VAULT => {
                self.side_pane.focus_search();
                self.side_pane_visible = true;
            }
            other => actions.push(WorkspaceAction::RunCommand(other.to_owned())),
        }
        actions
    }

    fn show_side_tab(&mut self, tab: SidePaneTab) {
        self.side_pane.tab = tab;
        self.side_pane_visible = true;
    }

    /// Consumes the first matching command shortcut of this frame and runs it.
    pub fn handle_shortcuts(&mut self, ctx: &egui::Context) -> Vec<WorkspaceAction> {
        let context = self.command_context();
        let shortcuts = self.commands.shortcuts_by_specificity(&context);
        let triggered = ctx.input_mut(|input| {
            shortcuts
                .into_iter()
                .find(|(shortcut, _)| input.consume_shortcut(shortcut))
                .map(|(_, id)| id)
        });
        match triggered {
            Some(id) => self.execute(&id),
            None => Vec::new(),
        }
    }

    /// Renders the workspace with a placeholder editor that only names the active note.
    pub fn show(
        &mut self,
        ui: &mut egui::Ui,
        backend: &dyn WorkspaceBackend,
    ) -> Vec<WorkspaceAction> {
        self.show_with_editor(ui, backend, |ui, path| {
            ui.heading(tabs::tab_title(path));
            ui.weak(path);
        })
    }

    /// Renders the workspace. `editor` draws the content of the active tab.
    pub fn show_with_editor(
        &mut self,
        ui: &mut egui::Ui,
        backend: &dyn WorkspaceBackend,
        editor: impl FnOnce(&mut egui::Ui, &str),
    ) -> Vec<WorkspaceAction> {
        self.sync_paths(backend);
        if let Some(path) = self.pending_reveal.take() {
            self.explorer.reveal(&path);
        }
        let open_in_new_tab = ui.input(|input| input.modifiers.command);
        let mut intents = self.handle_shortcuts(ui.ctx());

        // Modals first so their keyboard handling sees Enter/Escape/arrows before any panel.
        if let Some(outcome) = show_quick_switcher(ui.ctx(), &mut self.quick_switcher, backend) {
            intents.push(match outcome {
                QuickSwitcherOutcome::Open(path) => WorkspaceAction::OpenNote(path),
                QuickSwitcherOutcome::Create(path) => WorkspaceAction::CreateNoteAt(path),
            });
        }
        let context = self.command_context();
        let chosen = show_command_palette(
            ui.ctx(),
            &mut self.command_palette,
            &self.commands,
            &context,
        );
        if let Some(id) = chosen {
            intents.extend(self.execute(&id));
        }

        let active = self.tabs.active_path().map(str::to_owned);
        if self.explorer_visible {
            egui::Panel::left(egui::Id::new("openobsidian-workspace-explorer"))
                .resizable(true)
                .default_size(240.0)
                .show(ui, |ui| {
                    ui.strong("Files");
                    intents.extend(show_explorer(ui, &mut self.explorer));
                });
        }
        if self.side_pane_visible {
            egui::Panel::right(egui::Id::new("openobsidian-workspace-side-pane"))
                .resizable(true)
                .default_size(280.0)
                .show(ui, |ui| {
                    let pane = &mut self.side_pane;
                    intents.extend(show_side_pane(ui, pane, active.as_deref(), backend));
                });
        }
        egui::Panel::top(egui::Id::new("openobsidian-workspace-tab-bar")).show(ui, |ui| {
            intents.extend(show_tab_bar(ui, &mut self.tabs));
        });
        let requested = egui::CentralPanel::default()
            .show(ui, |ui| match self.tabs.active_path() {
                Some(path) => {
                    editor(ui, path);
                    None
                }
                None => show_empty_state(ui),
            })
            .inner;
        if let Some(id) = requested {
            intents.extend(self.execute(id));
        }
        self.apply_intents(intents, open_in_new_tab)
    }

    fn sync_paths(&mut self, backend: &dyn WorkspaceBackend) {
        let revision = backend.revision();
        if self.paths_revision != Some(revision) {
            self.explorer.set_paths(backend.list_paths());
            self.paths_revision = Some(revision);
        }
    }

    fn apply_intents(
        &mut self,
        intents: Vec<WorkspaceAction>,
        open_in_new_tab: bool,
    ) -> Vec<WorkspaceAction> {
        let mut actions = Vec::new();
        for intent in intents {
            match intent {
                WorkspaceAction::OpenNote(path) => {
                    if open_in_new_tab {
                        self.tabs.open(&path);
                    } else {
                        self.tabs.open_in_active(&path);
                    }
                    self.explorer.select(Some(&path));
                }
                other => actions.push(other),
            }
        }
        let active = self.tabs.active_path().map(str::to_owned);
        if active != self.reported_active {
            if let Some(path) = &active {
                actions.insert(0, WorkspaceAction::OpenNote(path.clone()));
            }
            self.reported_active = active;
        }
        actions
    }
}

fn show_empty_state(ui: &mut egui::Ui) -> Option<&'static str> {
    let mut requested = None;
    ui.add_space(24.0);
    ui.heading("No file is open");
    if ui.button("Open quick switcher").clicked() {
        requested = Some(ids::QUICK_SWITCHER);
    }
    if ui.button("Create new note").clicked() {
        requested = Some(ids::NEW_NOTE);
    }
    if ui.button("Open command palette").clicked() {
        requested = Some(ids::COMMAND_PALETTE);
    }
    requested
}

#[cfg(test)]
mod tests {
    use super::*;
    use egui_kittest::{Harness, kittest::Queryable as _};

    struct TestApp {
        workspace: Workspace,
        backend: InMemoryBackend,
        actions: Vec<WorkspaceAction>,
    }

    fn test_backend() -> InMemoryBackend {
        InMemoryBackend::new()
            .with_note(
                "Home.md",
                "# Home\nSee [[Projects/Alpha]] and [[Ideas]].\n#index",
            )
            .with_note("Projects/Alpha.md", "Alpha links [[Home]]\n#project")
            .with_note("Ideas.md", "Back to [[Home]]\n#project")
    }

    fn harness(workspace: Workspace) -> Harness<'static, TestApp> {
        let app = TestApp {
            workspace,
            backend: test_backend(),
            actions: Vec::new(),
        };
        let mut harness = Harness::new_ui_state(
            |ui, app| {
                let actions = app.workspace.show(ui, &app.backend);
                app.actions.extend(actions);
            },
            app,
        );
        harness.set_size(egui::vec2(1200.0, 800.0));
        harness.step();
        harness.step();
        harness
    }

    fn active(harness: &Harness<'_, TestApp>) -> Option<String> {
        harness
            .state()
            .workspace
            .tabs
            .active_path()
            .map(str::to_owned)
    }

    #[test]
    fn execute_routes_built_in_and_host_commands() {
        let mut workspace = Workspace::new();
        assert!(workspace.execute(ids::CLOSE_TAB).is_empty());
        workspace.open_note("a.md");
        assert_eq!(
            workspace.execute(ids::SAVE_NOTE),
            [WorkspaceAction::SaveNote("a.md".to_owned())]
        );
        assert_eq!(
            workspace.execute(ids::NEW_NOTE),
            [WorkspaceAction::CreateNote {
                folder: String::new()
            }]
        );
        workspace.execute(ids::COMMAND_PALETTE);
        assert!(workspace.command_palette.palette.is_open());
        workspace.execute(ids::QUICK_SWITCHER);
        assert!(workspace.quick_switcher.palette.is_open());
        assert!(!workspace.command_palette.palette.is_open());
        workspace.execute(ids::SEARCH_VAULT);
        assert_eq!(workspace.side_pane.tab, SidePaneTab::Search);
        assert_eq!(
            workspace.execute("host:custom"),
            [WorkspaceAction::RunCommand("host:custom".to_owned())]
        );
        workspace.execute(ids::TOGGLE_PIN);
        assert!(workspace.command_context().active_tab_pinned);
        assert!(workspace.execute(ids::CLOSE_TAB).is_empty());
        workspace.execute(ids::TOGGLE_PIN);
        assert_eq!(
            workspace.execute(ids::CLOSE_TAB),
            [WorkspaceAction::TabClosed("a.md".to_owned())]
        );
    }

    #[test]
    fn explorer_click_opens_note_and_side_pane_follows_links() {
        let mut harness = harness(Workspace::new());
        harness.get_by_label("Open file Home.md").click();
        harness.step();
        assert_eq!(active(&harness).as_deref(), Some("Home.md"));
        assert!(
            harness
                .state()
                .actions
                .contains(&WorkspaceAction::OpenNote("Home.md".to_owned()))
        );

        harness.step();
        harness
            .get_by_label("Backlink from Ideas.md line 1")
            .click();
        harness.step();
        assert_eq!(active(&harness).as_deref(), Some("Ideas.md"));
        assert_eq!(harness.state().workspace.tabs.len(), 1);

        harness.step();
        harness.get_by_label("Navigate back").click();
        harness.step();
        assert_eq!(active(&harness).as_deref(), Some("Home.md"));
    }

    #[test]
    fn quick_switcher_opens_with_shortcut_and_enter_opens_match() {
        let mut harness = harness(Workspace::new());
        harness.key_press_modifiers(egui::Modifiers::COMMAND, egui::Key::O);
        harness.step();
        assert!(harness.state().workspace.quick_switcher.palette.is_open());
        harness.step();
        harness.step();
        harness.get_by_label("Quick switcher query").click();
        harness.step();
        harness
            .get_by_label("Quick switcher query")
            .type_text("alpha");
        harness.step();
        harness.step();
        assert_eq!(
            harness.state().workspace.quick_switcher.palette.query(),
            "alpha"
        );
        harness.get_by_label("Switch to Projects/Alpha.md");
        harness.key_press(egui::Key::Enter);
        harness.step();
        assert!(!harness.state().workspace.quick_switcher.palette.is_open());
        assert_eq!(active(&harness).as_deref(), Some("Projects/Alpha.md"));
    }

    #[test]
    fn command_palette_runs_command_and_escape_dismisses() {
        let mut workspace = Workspace::new();
        workspace.open_note("Home.md");
        let mut harness = harness(workspace);
        harness.key_press_modifiers(egui::Modifiers::COMMAND, egui::Key::P);
        harness.step();
        assert!(harness.state().workspace.command_palette.palette.is_open());
        harness.key_press(egui::Key::Escape);
        harness.step();
        assert!(!harness.state().workspace.command_palette.palette.is_open());

        harness.key_press_modifiers(egui::Modifiers::COMMAND, egui::Key::P);
        harness.step();
        harness.step();
        harness.step();
        harness.get_by_label("Command Close current tab").click();
        harness.step();
        assert!(!harness.state().workspace.command_palette.palette.is_open());
        assert!(harness.state().workspace.tabs.is_empty());
        assert!(
            harness
                .state()
                .actions
                .contains(&WorkspaceAction::TabClosed("Home.md".to_owned()))
        );
    }

    #[test]
    fn tab_close_button_closes_tab_and_activates_previous() {
        let mut workspace = Workspace::new();
        workspace.open_note("Home.md");
        workspace.tabs.open("Ideas.md");
        let mut harness = harness(workspace);
        harness.get_by_label("Tab Home.md");
        harness.get_by_label("Close tab Ideas.md").click();
        harness.step();
        assert_eq!(active(&harness).as_deref(), Some("Home.md"));
        assert!(
            harness
                .state()
                .actions
                .contains(&WorkspaceAction::TabClosed("Ideas.md".to_owned()))
        );
    }
}
